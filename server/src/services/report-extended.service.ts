import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';
import { effectiveUnitCost } from '../utils/product-cost';
import { SettingService } from './setting.service';
import {
    getZonedMonthBounds,
    parseZonedDateStart,
    zonedDateKey,
    zonedHour,
    zonedMonthKey,
    zonedWeekday
} from '../utils/timezone';

type RecipeLine = {
    quantity: Prisma.Decimal | number | string;
    unit?: string | null;
    product: { id: number; name: string; unit: string; currentAverageCost?: unknown; cost?: unknown };
};

type OrderItemWithRecipes = {
    quantity: number;
    subtotal?: Prisma.Decimal | number | string;
    menuItem?: {
        recipes?: RecipeLine[] | null;
    } | null;
};

const UNCATEGORIZED_CATEGORY = 'Sin categoría';

export class ReportExtendedService {
    /** Credit notes are negative sales events dated by issuedAt, never by the
     * original order's closedAt. This shared loader keeps every sales rollup on
     * the same temporal contract. */
    private static async loadFiscalCredits(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number; salesChannel?: string;
        userId?: number;
    }) {
        return prisma.fiscalCreditNote.findMany({
            where: {
                companyId,
                ...(filters?.branchId ? { branchId: filters.branchId } : {}),
                ...(filters?.salesChannel || filters?.userId ? {
                    order: {
                        ...(filters?.salesChannel ? {
                            salesChannel: filters.salesChannel as Prisma.OrderWhereInput['salesChannel']
                        } : {}),
                        ...(filters?.userId ? { userId: filters.userId } : {})
                    }
                } : {}),
                ...(filters?.dateFrom || filters?.dateTo ? {
                    issuedAt: {
                        ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                        ...(filters?.dateTo ? { lte: filters.dateTo } : {})
                    }
                } : {})
            },
            select: {
                id: true,
                issuedAt: true,
                total: true,
                tax: true,
                tipAmount: true,
                order: {
                    select: {
                        userId: true, branchId: true, salesChannel: true,
                        user: { select: { name: true, role: { select: { name: true } } } },
                        branch: { select: { name: true } },
                        company: { select: { name: true } }
                    }
                },
                refunds: { select: { amount: true, payment: { select: { paymentMethod: { select: { name: true } } } } } },
                lines: {
                    select: {
                        quantity: true, grossSubtotal: true, subtotal: true,
                        orderItem: {
                            select: {
                                menuItemId: true,
                                menuItem: {
                                    select: {
                                        name: true,
                                        categoryId: true,
                                        category: { select: { name: true } },
                                        brand: { select: { name: true } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
    }
    private static async recipeQuantityInBase(companyId: number, recipe: {
        quantity: Prisma.Decimal | number | string;
        unit?: string | null;
        product: { id: number; name: string; unit: string };
    }): Promise<number> {
        const recipeUnit = recipe.unit || recipe.product.unit;
        try {
            return (await UnitConversionService.convert(
                recipe.product.id, companyId, Number(recipe.quantity), recipeUnit
            )).baseQuantity;
        } catch (error) {
            throw new Error(
                `Reporte no calculado: receta de "${recipe.product.name}" usa la unidad "${recipeUnit}" sin conversión válida: ${(error as Error).message}`
            );
        }
    }

    /**
     * Net consumption cost per order from immutable ORD-{id} OUT/IN movements
     * (same semantics as ReportService.getCostReport). Map key = orderId.
     */
    private static async loadOrderNetLedgerCogs(
        companyId: number,
        orderIds: number[]
    ): Promise<Map<number, number>> {
        const netByOrderId = new Map<number, number>();
        const incompleteOrderIds = new Set<number>();
        if (orderIds.length === 0) return netByOrderId;

        const orderRefs = orderIds.map((id) => `ORD-${id}`);
        const movements = await prisma.inventoryMovement.findMany({
            where: {
                companyId,
                reference: { in: orderRefs },
                type: { in: ['OUT', 'IN'] }
            },
            select: { reference: true, type: true, totalCost: true }
        });

        for (const movement of movements) {
            if (!movement.reference?.startsWith('ORD-')) continue;
            const orderId = Number(movement.reference.slice(4));
            if (!Number.isFinite(orderId)) continue;
            const movementCost = movement.totalCost == null ? null : Number(movement.totalCost);
            if (movementCost == null || !Number.isFinite(movementCost) || movementCost < 0) {
                incompleteOrderIds.add(orderId);
                continue;
            }
            const signed = movement.type === 'OUT'
                ? movementCost
                : -movementCost;
            netByOrderId.set(orderId, (netByOrderId.get(orderId) || 0) + signed);
        }
        for (const orderId of incompleteOrderIds) netByOrderId.delete(orderId);
        return netByOrderId;
    }

    /** Inventory cost events for a report window. Historical movements for the
     * sold orders are also loaded only to decide whether recipe fallback is
     * allowed; their cost is never shifted into the current window. */
    private static async loadTemporalOrderLedgerCogs(
        companyId: number,
        soldOrderIds: number[],
        filters?: { dateFrom?: Date; dateTo?: Date; branchId?: number }
    ): Promise<{ periodByOrderId: Map<number, number>; hasAnyOrderIds: Set<number> }> {
        const soldRefs = soldOrderIds.map((id) => `ORD-${id}`);
        const window = filters?.dateFrom || filters?.dateTo ? {
            ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters?.dateTo ? { lte: filters.dateTo } : {})
        } : undefined;
        const movements = await prisma.inventoryMovement.findMany({
            where: {
                companyId,
                type: { in: ['OUT', 'IN'] },
                reference: { startsWith: 'ORD-' },
                ...(window && soldRefs.length > 0
                    ? { OR: [{ createdAt: window }, { reference: { in: soldRefs } }] }
                    : window ? { createdAt: window } : {})
            },
            select: { id: true, reference: true, type: true, totalCost: true, createdAt: true }
        });
        const movementOrderIds = [...new Set(movements.flatMap((movement) => {
            const match = /^ORD-(\d+)$/.exec(movement.reference || '');
            return match ? [Number(match[1])] : [];
        }))];
        const allowedOrderIds = filters?.branchId && movementOrderIds.length > 0
            ? new Set((await prisma.order.findMany({
                where: { companyId, branchId: filters.branchId, id: { in: movementOrderIds } },
                select: { id: true }
            })).map((order) => order.id))
            : null;
        const periodByOrderId = new Map<number, number>();
        const hasAnyOrderIds = new Set<number>();
        for (const movement of movements) {
            const match = /^ORD-(\d+)$/.exec(movement.reference || '');
            if (!match) continue;
            const orderId = Number(match[1]);
            if (allowedOrderIds && !allowedOrderIds.has(orderId)) continue;
            hasAnyOrderIds.add(orderId);
            const inWindow = !window
                || ((!filters?.dateFrom || movement.createdAt >= filters.dateFrom)
                    && (!filters?.dateTo || movement.createdAt <= filters.dateTo));
            if (!inWindow) continue;
            const value = movement.totalCost == null ? null : Number(movement.totalCost);
            if (value == null || !Number.isFinite(value) || value < 0) {
                throw new Error(`El movimiento ORD ${movement.id} no tiene costo histÃ³rico Ã­ntegro; requiere remediaciÃ³n antes de reportar`);
            }
            const signed = movement.type === 'OUT' ? value : -value;
            periodByOrderId.set(orderId, (periodByOrderId.get(orderId) || 0) + signed);
        }
        return { periodByOrderId, hasAnyOrderIds };
    }

    /** Recipe × live WAC estimate for one order line (fallback only). */
    private static async estimateLineRecipeCogs(
        companyId: number,
        item: OrderItemWithRecipes
    ): Promise<number> {
        let cogs = 0;
        for (const recipe of item.menuItem?.recipes || []) {
            const qtyInBase = await this.recipeQuantityInBase(companyId, recipe);
            const unitCost = effectiveUnitCost(recipe.product.currentAverageCost, recipe.product.cost);
            cogs += qtyInBase * item.quantity * unitCost;
        }
        return cogs;
    }

    /**
     * Per-line COGS for an order: prefer ORD-* ledger total when present.
     * Ledger is order-grain only (ingredient OUT/IN under ORD-{id}), so line
     * dimensions allocate that net cost by recipe-estimate share within the
     * order; if recipe estimates are all zero, allocate by line revenue share.
     * No ledger → each line uses recipe × live WAC.
     */
    private static async lineCogsPreferringLedger(
        companyId: number,
        orderId: number,
        items: OrderItemWithRecipes[],
        ledgerByOrderId: Map<number, number>
    ): Promise<number[]> {
        const recipeByLine = await Promise.all(
            items.map((item) => this.estimateLineRecipeCogs(companyId, item))
        );

        if (!ledgerByOrderId.has(orderId)) {
            return recipeByLine;
        }

        const ledgerTotal = ledgerByOrderId.get(orderId) || 0;
        const recipeTotal = recipeByLine.reduce((sum, value) => sum + value, 0);
        if (recipeTotal > 0) {
            return recipeByLine.map((lineRecipe) => ledgerTotal * (lineRecipe / recipeTotal));
        }

        const revenueByLine = items.map((item) => Number(item.subtotal ?? 0));
        const revenueTotal = revenueByLine.reduce((sum, value) => sum + value, 0);
        if (revenueTotal > 0) {
            return revenueByLine.map((revenue) => ledgerTotal * (revenue / revenueTotal));
        }

        // No allocation key: attribute full order ledger to the first line only.
        return items.map((_, index) => (index === 0 ? ledgerTotal : 0));
    }

    // ── PURCHASES: By Day ──
    static async getPurchasesByDay(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number; supplierId?: number;
        categoryId?: number; productId?: number;
    }) {
        const poWhere = this.buildPurchaseWhere(companyId, filters);
        const [orders, timeZone] = await Promise.all([
            prisma.purchaseOrder.findMany({
                where: { ...poWhere, status: 'RECEIVED' },
                include: {
                    supplier: { select: { name: true } },
                    items: {
                        include: { product: { select: { name: true, sku: true, category: { select: { name: true } } } } }
                    }
                },
                orderBy: { date: 'asc' }
            }),
            SettingService.getTimezone(companyId)
        ]);

        const byDay: Record<string, { date: string; totalAmount: number; orderCount: number; itemCount: number }> = {};
        for (const po of orders) {
            const day = zonedDateKey(po.date, timeZone);
            if (!byDay[day]) byDay[day] = { date: day, totalAmount: 0, orderCount: 0, itemCount: 0 };
            byDay[day].totalAmount += Number(po.total);
            byDay[day].orderCount += 1;
            byDay[day].itemCount += po.items.length;
        }

        const items = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
        const totalAmount = items.reduce((s, i) => s + i.totalAmount, 0);

        return {
            items,
            summary: {
                totalDays: items.length,
                totalAmount: Math.round(totalAmount * 100) / 100,
                totalOrders: orders.length,
                avgPerDay: items.length > 0 ? Math.round(totalAmount / items.length * 100) / 100 : 0
            }
        };
    }

    // ── PURCHASES: By Month ──
    static async getPurchasesByMonth(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number; supplierId?: number;
    }) {
        const poWhere = this.buildPurchaseWhere(companyId, filters);
        const [orders, timeZone] = await Promise.all([
            prisma.purchaseOrder.findMany({
                where: { ...poWhere, status: 'RECEIVED' },
                select: { date: true, total: true },
                orderBy: { date: 'asc' }
            }),
            SettingService.getTimezone(companyId)
        ]);

        const byMonth: Record<string, { month: string; totalAmount: number; orderCount: number }> = {};
        for (const po of orders) {
            const m = zonedMonthKey(po.date, timeZone);
            if (!byMonth[m]) byMonth[m] = { month: m, totalAmount: 0, orderCount: 0 };
            byMonth[m].totalAmount += Number(po.total);
            byMonth[m].orderCount += 1;
        }

        const items = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
        return {
            items,
            summary: {
                totalMonths: items.length,
                totalAmount: Math.round(items.reduce((s, i) => s + i.totalAmount, 0) * 100) / 100,
                totalOrders: orders.length
            }
        };
    }

    // ── PURCHASES: Price Comparison by Supplier ──
    static async getPriceComparison(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; productId?: number; categoryId?: number;
    }) {
        const poWhere = this.buildPurchaseWhere(companyId, filters);
        const orders = await prisma.purchaseOrder.findMany({
            where: { ...poWhere, status: 'RECEIVED' },
            include: {
                supplier: { select: { id: true, name: true } },
                items: {
                    where: filters?.productId ? { productId: filters.productId } : undefined,
                    include: {
                        product: {
                            select: { id: true, name: true, sku: true, categoryId: true,
                                category: { select: { name: true } } }
                        }
                    }
                }
            }
        });

        const matrix: Record<string, Record<string, { avgCost: number; minCost: number; maxCost: number; totalQty: number; entries: number }>> = {};
        let excludedLegacyLines = 0;
        let excludedLegacyAmount = 0;

        for (const po of orders) {
            for (const item of po.items) {
                if (filters?.categoryId && item.product.categoryId !== filters.categoryId) continue;
                if (item.baseCost == null || item.baseQuantity == null) {
                    excludedLegacyLines += 1;
                    excludedLegacyAmount += Number(item.subtotal);
                    continue;
                }
                const productKey = `${item.product.id}|${item.product.name}|${item.product.sku || ''}|${item.product.category?.name || ''}`;
                const supplierKey = `${po.supplier.id}|${po.supplier.name}`;
                if (!matrix[productKey]) matrix[productKey] = {};
                if (!matrix[productKey][supplierKey]) {
                    matrix[productKey][supplierKey] = { avgCost: 0, minCost: Infinity, maxCost: 0, totalQty: 0, entries: 0 };
                }
                // Compare supplier prices per BASE unit so purchases in different
                // purchase units are ranked consistently.
                const unitCost = Number(item.baseCost);
                const qty = Number(item.baseQuantity);
                const entry = matrix[productKey][supplierKey];
                entry.minCost = Math.min(entry.minCost, unitCost);
                entry.maxCost = Math.max(entry.maxCost, unitCost);
                entry.totalQty += qty;
                entry.avgCost = (entry.avgCost * entry.entries + unitCost) / (entry.entries + 1);
                entry.entries += 1;
            }
        }

        const items: Array<{
            productName: string; sku: string | null; categoryName: string | null;
            supplierName: string; avgCost: number; minCost: number; maxCost: number;
            priceVariation: number; totalQuantity: number;
        }> = [];

        for (const [productKey, suppliers] of Object.entries(matrix)) {
            const [, productName, sku, categoryName] = productKey.split('|');
            for (const [supplierKey, data] of Object.entries(suppliers)) {
                const [, supplierName] = supplierKey.split('|');
                items.push({
                    productName,
                    sku: sku || null,
                    categoryName: categoryName || null,
                    supplierName,
                    avgCost: Math.round(data.avgCost * 100) / 100,
                    minCost: data.minCost === Infinity ? 0 : Math.round(data.minCost * 100) / 100,
                    maxCost: Math.round(data.maxCost * 100) / 100,
                    priceVariation: data.minCost < Infinity && data.minCost > 0
                        ? Math.round((data.maxCost - data.minCost) / data.minCost * 10000) / 100
                        : 0,
                    totalQuantity: Math.round(data.totalQty * 100) / 100,
                });
            }
        }

        return {
            items: items.sort((a, b) => a.productName.localeCompare(b.productName)),
            summary: {
                totalProducts: Object.keys(matrix).length,
                totalComparisons: items.length,
                avgVariation: items.length > 0
                    ? Math.round(items.reduce((s, i) => s + i.priceVariation, 0) / items.length * 100) / 100
                    : 0,
                excludedLegacyLines,
                excludedLegacyAmount: Math.round(excludedLegacyAmount * 100) / 100
            }
        };
    }

    // ── PURCHASES: Most Purchased Products ──
    static async getMostPurchasedProducts(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number; limit?: number;
    }) {
        const poWhere = this.buildPurchaseWhere(companyId, filters);
        const orders = await prisma.purchaseOrder.findMany({
            where: { ...poWhere, status: 'RECEIVED' },
            include: {
                items: {
                    include: {
                        product: {
                            select: { id: true, name: true, sku: true, unit: true,
                                baseUnit: { select: { abbreviation: true } },
                                category: { select: { name: true } } }
                        }
                    }
                }
            }
        });

        const productMap: Record<number, {
            productName: string; sku: string | null; unit: string;
            categoryName: string | null; totalQuantity: number; totalCost: number; orderCount: number;
        }> = {};
        let totalSpent = 0;
        let normalizedSpent = 0;
        let excludedLegacyLines = 0;
        let excludedLegacyAmount = 0;

        for (const po of orders) {
            for (const item of po.items) {
                const subtotal = Number(item.subtotal);
                totalSpent += subtotal;
                if (item.baseQuantity == null || item.baseCost == null) {
                    excludedLegacyLines += 1;
                    excludedLegacyAmount += subtotal;
                    continue;
                }
                if (!productMap[item.productId]) {
                    productMap[item.productId] = {
                        productName: item.product.name,
                        sku: item.product.sku,
                        unit: item.product.baseUnit?.abbreviation || item.product.unit,
                        categoryName: item.product.category?.name || null,
                        totalQuantity: 0, totalCost: 0, orderCount: 0
                    };
                }
                // Accumulate volume in BASE units; subtotal is the unit-independent
                // monetary total, so avgUnitCost ends up expressed per base unit.
                productMap[item.productId].totalQuantity += Number(item.baseQuantity);
                productMap[item.productId].totalCost += subtotal;
                normalizedSpent += subtotal;
                productMap[item.productId].orderCount += 1;
            }
        }

        const items = Object.values(productMap)
            .sort((a, b) => b.totalQuantity - a.totalQuantity)
            .slice(0, filters?.limit || 20)
            .map(p => ({
                ...p,
                totalQuantity: Math.round(p.totalQuantity * 100) / 100,
                totalCost: Math.round(p.totalCost * 100) / 100,
                avgUnitCost: p.totalQuantity > 0 ? Math.round(p.totalCost / p.totalQuantity * 100) / 100 : 0
            }));

        return {
            items,
            summary: {
                totalProducts: items.length,
                totalSpent: Math.round(totalSpent * 100) / 100,
                normalizedSpent: Math.round(normalizedSpent * 100) / 100,
                excludedLegacyLines,
                excludedLegacyAmount: Math.round(excludedLegacyAmount * 100) / 100
            }
        };
    }

    // ── PURCHASES: By Supplier ──
    static async getPurchasesBySupplier(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number;
    }) {
        const poWhere = this.buildPurchaseWhere(companyId, filters);
        const orders = await prisma.purchaseOrder.findMany({
            where: { ...poWhere, status: 'RECEIVED' },
            include: { supplier: { select: { id: true, name: true } } }
        });

        const supplierMap: Record<number, {
            supplierName: string; totalAmount: number; orderCount: number;
        }> = {};

        for (const po of orders) {
            if (!supplierMap[po.supplierId]) {
                supplierMap[po.supplierId] = { supplierName: po.supplier.name, totalAmount: 0, orderCount: 0 };
            }
            supplierMap[po.supplierId].totalAmount += Number(po.total);
            supplierMap[po.supplierId].orderCount += 1;
        }

        const items = Object.values(supplierMap)
            .sort((a, b) => b.totalAmount - a.totalAmount)
            .map(s => ({
                ...s,
                totalAmount: Math.round(s.totalAmount * 100) / 100,
                avgPerOrder: s.orderCount > 0 ? Math.round(s.totalAmount / s.orderCount * 100) / 100 : 0
            }));

        const grandTotal = items.reduce((s, i) => s + i.totalAmount, 0);
        return {
            items: items.map(i => ({
                ...i,
                percentOfTotal: grandTotal > 0 ? Math.round(i.totalAmount / grandTotal * 10000) / 100 : 0
            })),
            summary: {
                totalSuppliers: items.length,
                totalAmount: Math.round(grandTotal * 100) / 100,
                topSupplier: items[0]?.supplierName || 'N/A'
            }
        };
    }

    // ── SALES: By Category with Percentage ──
    static async getSalesByCategory(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number; categoryId?: number; categoryIds?: number[];
    }) {
        // Avoid an unbounded scan of all paid orders: default to the current month
        // when no date window is supplied, consistent with other report defaults.
        let effectiveFilters = filters;
        if (!filters?.dateFrom && !filters?.dateTo) {
            const timeZone = await SettingService.getTimezone(companyId);
            const month = getZonedMonthBounds(timeZone);
            effectiveFilters = { ...filters, dateFrom: month.start, dateTo: month.endInclusive };
        }
        const orderWhere = this.buildOrderWhere(companyId, effectiveFilters);
        const [orders, credits] = await Promise.all([
            prisma.order.findMany({
                where: orderWhere,
                include: {
                    items: {
                        include: {
                            menuItem: { select: { categoryId: true, category: { select: { id: true, name: true } } } }
                        }
                    }
                }
            }),
            this.loadFiscalCredits(companyId, effectiveFilters)
        ]);

        const catMap: Record<string, { categoryName: string; totalSales: number; itemCount: number; unitsSold: number }> = {};
        let grandTotal = 0;
        const selectedCategoryIds = filters?.categoryIds?.length
            ? new Set(filters.categoryIds)
            : filters?.categoryId ? new Set([filters.categoryId]) : null;

        for (const order of orders) {
            for (const item of order.items) {
                if (selectedCategoryIds && (!item.menuItem?.categoryId || !selectedCategoryIds.has(item.menuItem.categoryId))) continue;
                const catName = item.menuItem?.category?.name || UNCATEGORIZED_CATEGORY;
                if (!catMap[catName]) catMap[catName] = { categoryName: catName, totalSales: 0, itemCount: 0, unitsSold: 0 };
                catMap[catName].totalSales += Number(item.subtotal);
                catMap[catName].itemCount += 1;
                catMap[catName].unitsSold += item.quantity;
                grandTotal += Number(item.subtotal);
            }
        }
        for (const credit of credits) {
            for (const line of credit.lines) {
                const menuItem = line.orderItem.menuItem;
                if (selectedCategoryIds && (!menuItem.categoryId || !selectedCategoryIds.has(menuItem.categoryId))) continue;
                const catName = menuItem.category?.name || UNCATEGORIZED_CATEGORY;
                if (!catMap[catName]) catMap[catName] = { categoryName: catName, totalSales: 0, itemCount: 0, unitsSold: 0 };
                catMap[catName].totalSales -= Number(line.grossSubtotal);
                catMap[catName].unitsSold -= line.quantity;
                grandTotal -= Number(line.grossSubtotal);
            }
        }

        const items = Object.values(catMap)
            .sort((a, b) => b.totalSales - a.totalSales)
            .map(c => ({
                ...c,
                totalSales: Math.round(c.totalSales * 100) / 100,
                percentOfTotal: grandTotal > 0 ? Math.round(c.totalSales / grandTotal * 10000) / 100 : 0
            }));

        return {
            items,
            summary: {
                totalCategories: items.length,
                totalSales: Math.round(grandTotal * 100) / 100,
                topCategory: items[0]?.categoryName || 'N/A'
            }
        };
    }

    // ── SALES: by Brand (empresa/marca) ──
    static async getSalesByProduct(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number; categoryId?: number; categoryIds?: number[]; productId?: number;
    }) {
        let effectiveFilters = filters;
        if (!filters?.dateFrom && !filters?.dateTo) {
            const timeZone = await SettingService.getTimezone(companyId);
            const month = getZonedMonthBounds(timeZone);
            effectiveFilters = { ...filters, dateFrom: month.start, dateTo: month.endInclusive };
        }
        const orderWhere = this.buildOrderWhere(companyId, effectiveFilters);
        const selectedCategoryIds = effectiveFilters?.categoryIds?.length
            ? effectiveFilters.categoryIds
            : effectiveFilters?.categoryId ? [effectiveFilters.categoryId] : [];
        const [orderItems, credits] = await Promise.all([
            prisma.orderItem.findMany({
                where: {
                    order: orderWhere,
                    ...(selectedCategoryIds.length > 0 ? { menuItem: { categoryId: { in: selectedCategoryIds } } } : {}),
                    ...(effectiveFilters?.productId ? { menuItemId: effectiveFilters.productId } : {}),
                },
                select: {
                    orderId: true, menuItemId: true, quantity: true, subtotal: true,
                    menuItem: { select: { name: true, category: { select: { name: true } } } },
                },
            }),
            this.loadFiscalCredits(companyId, effectiveFilters)
        ]);
        const products = new Map<number, { productId: number; productName: string; categoryName: string; unitsSold: number; lineCount: number; totalSales: number; orderIds: Set<number> }>();
        const allOrderIds = new Set<number>();
        for (const item of orderItems) {
            if (!item.menuItemId || !item.menuItem) continue;
            allOrderIds.add(item.orderId);
            const current = products.get(item.menuItemId) || {
                productId: item.menuItemId,
                productName: item.menuItem.name,
                categoryName: item.menuItem.category?.name || UNCATEGORIZED_CATEGORY,
                unitsSold: 0, lineCount: 0, totalSales: 0, orderIds: new Set<number>(),
            };
            current.unitsSold += Number(item.quantity) || 0;
            current.lineCount += 1;
            current.totalSales += Number(item.subtotal) || 0;
            current.orderIds.add(item.orderId);
            products.set(item.menuItemId, current);
        }
        for (const credit of credits) {
            for (const line of credit.lines) {
                const menuItem = line.orderItem.menuItem;
                const menuItemId = line.orderItem.menuItemId;
                if (selectedCategoryIds.length > 0 && (!menuItem.categoryId || !selectedCategoryIds.includes(menuItem.categoryId))) continue;
                if (effectiveFilters?.productId && menuItemId !== effectiveFilters.productId) continue;
                const current = products.get(menuItemId) || {
                    productId: menuItemId,
                    productName: menuItem.name,
                    categoryName: menuItem.category?.name || UNCATEGORIZED_CATEGORY,
                    unitsSold: 0, lineCount: 0, totalSales: 0, orderIds: new Set<number>()
                };
                current.unitsSold -= line.quantity;
                current.totalSales -= Number(line.grossSubtotal);
                products.set(menuItemId, current);
            }
        }
        const items = [...products.values()].map(({ orderIds, ...item }) => ({
            ...item,
            orderCount: orderIds.size,
            averageUnitPrice: item.unitsSold > 0 ? Math.round(item.totalSales / item.unitsSold * 100) / 100 : 0,
            totalSales: Math.round(item.totalSales * 100) / 100,
        })).sort((a, b) => b.totalSales - a.totalSales);
        const totalSales = items.reduce((sum, item) => sum + item.totalSales, 0);
        return {
            items,
            summary: {
                totalProducts: items.length,
                totalUnits: items.reduce((sum, item) => sum + item.unitsSold, 0),
                totalOrders: allOrderIds.size,
                totalSales: Math.round(totalSales * 100) / 100,
                topProduct: items[0]?.productName || 'N/A',
            },
        };
    }

    static async getSalesByBrand(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number;
    }) {
        let effectiveFilters = filters;
        if (!filters?.dateFrom && !filters?.dateTo) {
            const timeZone = await SettingService.getTimezone(companyId);
            const month = getZonedMonthBounds(timeZone);
            effectiveFilters = { ...filters, dateFrom: month.start, dateTo: month.endInclusive };
        }
        const orderWhere = this.buildOrderWhere(companyId, effectiveFilters);
        const [orders, credits] = await Promise.all([
            prisma.order.findMany({
                where: orderWhere,
                include: {
                    items: {
                        include: {
                            menuItem: { select: { brand: { select: { id: true, name: true } } } }
                        }
                    }
                }
            }),
            this.loadFiscalCredits(companyId, effectiveFilters)
        ]);

        const brandMap: Record<string, { brandName: string; totalSales: number; itemCount: number; unitsSold: number }> = {};
        let grandTotal = 0;

        for (const order of orders) {
            for (const item of order.items) {
                const brandName = item.menuItem?.brand?.name || 'Sin Marca (Común)';
                if (!brandMap[brandName]) brandMap[brandName] = { brandName, totalSales: 0, itemCount: 0, unitsSold: 0 };
                brandMap[brandName].totalSales += Number(item.subtotal);
                brandMap[brandName].itemCount += 1;
                brandMap[brandName].unitsSold += item.quantity;
                grandTotal += Number(item.subtotal);
            }
        }
        for (const credit of credits) {
            for (const line of credit.lines) {
                const brandName = line.orderItem.menuItem.brand?.name || 'Sin Marca (ComÃºn)';
                if (!brandMap[brandName]) brandMap[brandName] = { brandName, totalSales: 0, itemCount: 0, unitsSold: 0 };
                brandMap[brandName].totalSales -= Number(line.grossSubtotal);
                brandMap[brandName].unitsSold -= line.quantity;
                grandTotal -= Number(line.grossSubtotal);
            }
        }

        const items = Object.values(brandMap)
            .sort((a, b) => b.totalSales - a.totalSales)
            .map(c => ({
                ...c,
                totalSales: Math.round(c.totalSales * 100) / 100,
                percentOfTotal: grandTotal > 0 ? Math.round(c.totalSales / grandTotal * 10000) / 100 : 0
            }));

        return {
            items,
            summary: {
                totalBrands: items.length,
                totalSales: Math.round(grandTotal * 100) / 100,
                topBrand: items[0]?.brandName || 'N/A'
            }
        };
    }

    // ── SALES: Daily ──
    static async getSalesDaily(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number; salesChannel?: string;
    }) {
        const timeZone = await SettingService.getTimezone(companyId);
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const [orders, credits] = await Promise.all([
            prisma.order.findMany({
                where: orderWhere,
                select: { closedAt: true, total: true, discount: true, id: true, salesChannel: true },
                orderBy: { closedAt: 'asc' }
            }),
            this.loadFiscalCredits(companyId, filters)
        ]);

        const byDay: Record<string, { date: string; totalSales: number; orderCount: number; avgTicket: number; totalDiscount: number }> = {};

        for (const order of orders) {
            const day = zonedDateKey(order.closedAt as Date, timeZone);
            if (!byDay[day]) byDay[day] = { date: day, totalSales: 0, orderCount: 0, avgTicket: 0, totalDiscount: 0 };
            byDay[day].totalSales += Number(order.total);
            byDay[day].orderCount += 1;
            byDay[day].totalDiscount += Number(order.discount);
        }
        for (const credit of credits) {
            const day = zonedDateKey(credit.issuedAt, timeZone);
            if (!byDay[day]) byDay[day] = { date: day, totalSales: 0, orderCount: 0, avgTicket: 0, totalDiscount: 0 };
            byDay[day].totalSales -= Number(credit.total);
        }

        const items = Object.values(byDay)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(d => ({
                ...d,
                totalSales: Math.round(d.totalSales * 100) / 100,
                totalDiscount: Math.round(d.totalDiscount * 100) / 100,
                avgTicket: d.orderCount > 0 ? Math.round(d.totalSales / d.orderCount * 100) / 100 : 0
            }));

        const totalSales = items.reduce((s, i) => s + i.totalSales, 0);
        return {
            items,
            summary: {
                totalDays: items.length,
                totalSales: Math.round(totalSales * 100) / 100,
                totalOrders: orders.length,
                avgDailySales: items.length > 0 ? Math.round(totalSales / items.length * 100) / 100 : 0,
                avgTicket: orders.length > 0 ? Math.round(totalSales / orders.length * 100) / 100 : 0
            }
        };
    }

    // ── SALES: Monthly ──
    static async getSalesMonthly(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number;
    }) {
        const timeZone = await SettingService.getTimezone(companyId);
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const [orders, credits] = await Promise.all([
            prisma.order.findMany({ where: orderWhere, select: { closedAt: true, total: true, id: true } }),
            this.loadFiscalCredits(companyId, filters)
        ]);

        const byMonth: Record<string, { month: string; totalSales: number; orderCount: number }> = {};
        for (const o of orders) {
            const m = zonedMonthKey(o.closedAt as Date, timeZone);
            if (!byMonth[m]) byMonth[m] = { month: m, totalSales: 0, orderCount: 0 };
            byMonth[m].totalSales += Number(o.total);
            byMonth[m].orderCount += 1;
        }
        for (const credit of credits) {
            const month = zonedMonthKey(credit.issuedAt, timeZone);
            if (!byMonth[month]) byMonth[month] = { month, totalSales: 0, orderCount: 0 };
            byMonth[month].totalSales -= Number(credit.total);
        }

        const items = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
        // Calculate month-over-month variation
        const withVariation = items.map((item, idx) => {
            const prev = idx > 0 ? items[idx - 1] : null;
            const variation = prev && prev.totalSales > 0
                ? Math.round((item.totalSales - prev.totalSales) / prev.totalSales * 10000) / 100
                : 0;
            return {
                ...item,
                totalSales: Math.round(item.totalSales * 100) / 100,
                avgTicket: item.orderCount > 0 ? Math.round(item.totalSales / item.orderCount * 100) / 100 : 0,
                variationPct: variation
            };
        });

        return {
            items: withVariation,
            summary: {
                totalMonths: items.length,
                totalSales: Math.round(items.reduce((s, i) => s + i.totalSales, 0) * 100) / 100,
                totalOrders: orders.length
            }
        };
    }

    // ── SALES: By Payment Method ──
    static async getSalesByPaymentMethod(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number;
    }) {
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const [orders, credits] = await Promise.all([
            prisma.order.findMany({
                where: orderWhere,
                include: {
                    // Preserve the immutable gross receipt and subtract fiscal
                    // refunds below. A final note reverses the original payment,
                    // so filtering only ACTIVE rows would publish a negative-only result.
                    payments: { include: { paymentMethod: { select: { name: true } } } }
                }
            }),
            this.loadFiscalCredits(companyId, filters)
        ]);

        const methodMap: Record<string, { methodName: string; totalAmount: number; transactionCount: number }> = {};
        let grandTotal = 0;

        for (const order of orders) {
            for (const payment of order.payments) {
                const name = payment.paymentMethod?.name || 'Otro';
                if (!methodMap[name]) methodMap[name] = { methodName: name, totalAmount: 0, transactionCount: 0 };
                methodMap[name].totalAmount += Number(payment.amount);
                methodMap[name].transactionCount += 1;
                grandTotal += Number(payment.amount);
            }
        }
        for (const credit of credits) {
            for (const refund of credit.refunds) {
                const name = refund.payment.paymentMethod?.name || 'Otro';
                if (!methodMap[name]) methodMap[name] = { methodName: name, totalAmount: 0, transactionCount: 0 };
                methodMap[name].totalAmount -= Number(refund.amount);
                grandTotal -= Number(refund.amount);
            }
        }

        const items = Object.values(methodMap)
            .sort((a, b) => b.totalAmount - a.totalAmount)
            .map(m => ({
                ...m,
                totalAmount: Math.round(m.totalAmount * 100) / 100,
                percentOfTotal: grandTotal > 0 ? Math.round(m.totalAmount / grandTotal * 10000) / 100 : 0
            }));

        return {
            items,
            summary: {
                totalMethods: items.length,
                totalAmount: Math.round(grandTotal * 100) / 100,
                dominantMethod: items[0]?.methodName || 'N/A'
            }
        };
    }

    // ── SALES: By User (Waiter/Cashier) ──
    static async getSalesByWaiter(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number;
    }) {
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const [orders, credits] = await Promise.all([
            prisma.order.findMany({
                where: orderWhere,
                include: {
                    user: { select: { id: true, name: true, role: { select: { name: true } } } },
                    branch: { select: { name: true } },
                    company: { select: { name: true } }
                }
            }),
            this.loadFiscalCredits(companyId, filters)
        ]);

        // Group by user AND branch so each row makes the branch/company explicit
        // (a cashier/waiter rotates across branches over time).
        const userMap: Record<string, {
            userName: string; roleName: string; branchName: string; companyName: string;
            totalSales: number; orderCount: number;
        }> = {};

        for (const order of orders) {
            const key = `${order.userId}-${order.branchId}`;
            if (!userMap[key]) {
                userMap[key] = {
                    userName: order.user?.name || 'Unknown',
                    roleName: order.user?.role?.name || 'N/A',
                    branchName: order.branch?.name || 'N/A',
                    companyName: order.company?.name || 'N/A',
                    totalSales: 0, orderCount: 0
                };
            }
            userMap[key].totalSales += Number(order.total);
            userMap[key].orderCount += 1;
        }
        for (const credit of credits) {
            const order = credit.order;
            const key = `${order.userId}-${order.branchId}`;
            if (!userMap[key]) {
                userMap[key] = {
                    userName: order.user?.name || 'Unknown',
                    roleName: order.user?.role?.name || 'N/A',
                    branchName: order.branch?.name || 'N/A',
                    companyName: order.company?.name || 'N/A',
                    totalSales: 0, orderCount: 0
                };
            }
            userMap[key].totalSales -= Number(credit.total);
        }

        const items = Object.values(userMap)
            .sort((a, b) => b.totalSales - a.totalSales)
            .map(u => ({
                ...u,
                totalSales: Math.round(u.totalSales * 100) / 100,
                avgTicket: u.orderCount > 0 ? Math.round(u.totalSales / u.orderCount * 100) / 100 : 0
            }));

        return {
            items,
            summary: {
                totalUsers: items.length,
                totalSales: Math.round(items.reduce((s, i) => s + i.totalSales, 0) * 100) / 100,
                topWaiter: items[0]?.userName || 'N/A'
            }
        };
    }

    // ── SALES: By Channel (Restaurant/Delivery/PedidosYa) ──
    static async getSalesByChannel(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number;
    }) {
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const [orders, credits] = await Promise.all([
            prisma.order.findMany({
                where: orderWhere,
                select: {
                id: true, total: true, salesChannel: true, channelCommission: true, channelMarkup: true,
                items: {
                    select: {
                        quantity: true, subtotal: true,
                        menuItem: {
                            select: {
                                recipes: {
                                    select: {
                                        quantity: true,
                                        unit: true,
                                        product: { select: { id: true, name: true, unit: true, currentAverageCost: true, cost: true } }
                                    }
                                }
                            }
                        }
                    }
                }
                }
            }),
            this.loadFiscalCredits(companyId, filters)
        ]);

        const temporalLedger = await this.loadTemporalOrderLedgerCogs(
            companyId,
            orders.map((order) => order.id),
            filters
        );

        const channelLabels: Record<string, string> = {
            RESTAURANT: 'Restaurante',
            DELIVERY: 'Delivery Propio',
            PEDIDOSYA: 'PedidosYa'
        };

        const channelMap: Record<string, {
            channel: string; channelName: string; grossSales: number; commission: number;
            netIncome: number; estimatedCOGS: number; orderCount: number;
        }> = {};

        for (const order of orders) {
            const ch = order.salesChannel || 'RESTAURANT';
            if (!channelMap[ch]) {
                channelMap[ch] = {
                    channel: ch, channelName: channelLabels[ch] || ch,
                    grossSales: 0, commission: 0, netIncome: 0, estimatedCOGS: 0, orderCount: 0
                };
            }
            const gross = Number(order.total);
            const comm = Number(order.channelCommission || 0);
            channelMap[ch].grossSales += gross;
            channelMap[ch].commission += comm;
            channelMap[ch].netIncome += gross - comm;
            channelMap[ch].orderCount += 1;

            // Order-grain channel rollup: full ORD-* net when present, else recipe×WAC.
            if (!temporalLedger.hasAnyOrderIds.has(order.id)) {
                for (const item of order.items) {
                    channelMap[ch].estimatedCOGS += await this.estimateLineRecipeCogs(companyId, item);
                }
            }
        }
        for (const credit of credits) {
            const channel = credit.order.salesChannel || 'RESTAURANT';
            if (!channelMap[channel]) {
                channelMap[channel] = {
                    channel, channelName: channelLabels[channel] || channel,
                    grossSales: 0, commission: 0, netIncome: 0, estimatedCOGS: 0, orderCount: 0
                };
            }
            channelMap[channel].grossSales -= Number(credit.total);
            channelMap[channel].netIncome -= Number(credit.total);
            // Keep the original channel commission as accrued. Credit notes do
            // not persist whether the external marketplace returned any fee;
            // inferring a proportional commission refund would invent policy.
        }
        const knownChannels = new Map(orders.map((order) => [order.id, order.salesChannel || 'RESTAURANT']));
        const unknownCostOrderIds = [...temporalLedger.periodByOrderId.keys()].filter((id) => !knownChannels.has(id));
        if (unknownCostOrderIds.length > 0) {
            const historicalOrders = await prisma.order.findMany({
                where: {
                    companyId,
                    id: { in: unknownCostOrderIds },
                    ...(filters?.branchId ? { branchId: filters.branchId } : {})
                },
                select: { id: true, salesChannel: true }
            });
            for (const order of historicalOrders) knownChannels.set(order.id, order.salesChannel || 'RESTAURANT');
        }
        for (const [orderId, cost] of temporalLedger.periodByOrderId) {
            const channel = knownChannels.get(orderId);
            if (!channel) continue;
            if (!channelMap[channel]) {
                channelMap[channel] = {
                    channel, channelName: channelLabels[channel] || channel,
                    grossSales: 0, commission: 0, netIncome: 0, estimatedCOGS: 0, orderCount: 0
                };
            }
            channelMap[channel].estimatedCOGS += cost;
        }

        const items = Object.values(channelMap).map(c => {
            const margin = c.netIncome - c.estimatedCOGS;
            return {
                ...c,
                grossSales: Math.round(c.grossSales * 100) / 100,
                commission: Math.round(c.commission * 100) / 100,
                netIncome: Math.round(c.netIncome * 100) / 100,
                estimatedCOGS: Math.round(c.estimatedCOGS * 100) / 100,
                margin: Math.round(margin * 100) / 100,
                marginPct: c.netIncome > 0 ? Math.round(margin / c.netIncome * 10000) / 100 : 0
            };
        });

        const totalGross = items.reduce((s, i) => s + i.grossSales, 0);
        return {
            items: items.map(i => ({ ...i, percentOfTotal: totalGross > 0 ? Math.round(i.grossSales / totalGross * 10000) / 100 : 0 })),
            summary: {
                totalChannels: items.length,
                totalGrossSales: Math.round(totalGross * 100) / 100,
                totalCommissions: Math.round(items.reduce((s, i) => s + i.commission, 0) * 100) / 100,
                totalNetIncome: Math.round(items.reduce((s, i) => s + i.netIncome, 0) * 100) / 100
            }
        };
    }

    // ── SALES: By Hour (Peak Hours) ──
    static async getSalesByHour(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number;
    }) {
        const timeZone = await SettingService.getTimezone(companyId);
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const [orders, credits] = await Promise.all([
            prisma.order.findMany({
                where: orderWhere,
                select: { closedAt: true, total: true, id: true }
            }),
            this.loadFiscalCredits(companyId, filters)
        ]);

        const hourMap: Record<number, { hour: number; totalSales: number; orderCount: number }> = {};
        for (let h = 0; h < 24; h++) hourMap[h] = { hour: h, totalSales: 0, orderCount: 0 };

        for (const order of orders) {
            const hour = zonedHour(order.closedAt as Date, timeZone);
            hourMap[hour].totalSales += Number(order.total);
            hourMap[hour].orderCount += 1;
        }
        for (const credit of credits) {
            const hour = zonedHour(credit.issuedAt, timeZone);
            hourMap[hour].totalSales -= Number(credit.total);
        }

        const items = Object.values(hourMap)
            .filter(h => h.orderCount > 0 || Math.abs(h.totalSales) > 1e-9)
            .map(h => ({
                ...h,
                hourLabel: `${String(h.hour).padStart(2, '0')}:00`,
                totalSales: Math.round(h.totalSales * 100) / 100,
                avgTicket: h.orderCount > 0 ? Math.round(h.totalSales / h.orderCount * 100) / 100 : 0
            }));

        const peakHour = items.reduce((max, h) => h.totalSales > max.totalSales ? h : max, items[0] || { hourLabel: 'N/A', totalSales: 0 });

        return {
            items,
            summary: {
                peakHour: peakHour?.hourLabel || 'N/A',
                peakSales: Math.round((peakHour?.totalSales || 0) * 100) / 100,
                totalOrders: orders.length
            }
        };
    }

    // ── COSTS: Food Cost by Category ──
    static async getFoodCostByCategory(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number;
    }) {
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const grossOrders = await prisma.order.findMany({
            where: orderWhere,
            include: {
                items: {
                    include: {
                        menuItem: {
                            select: {
                                categoryId: true,
                                category: { select: { name: true } },
                                recipes: {
                                    select: {
                                        quantity: true,
                                        unit: true,
                                        product: { select: { id: true, name: true, unit: true, currentAverageCost: true, cost: true } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        const temporalLedger = await this.loadTemporalOrderLedgerCogs(
            companyId,
            grossOrders.map((order) => order.id),
            filters
        );
        const grossOrderIds = new Set(grossOrders.map((order) => order.id));
        const extraOrderIds = [...temporalLedger.periodByOrderId.keys()]
            .filter((orderId) => !grossOrderIds.has(orderId));
        const counterflowOrders = extraOrderIds.length > 0
            ? await prisma.order.findMany({
                where: { companyId, id: { in: extraOrderIds } },
                include: {
                    items: {
                        include: {
                            menuItem: {
                                select: {
                                    categoryId: true,
                                    category: { select: { name: true } },
                                    recipes: {
                                        select: {
                                            quantity: true,
                                            unit: true,
                                            product: { select: { id: true, name: true, unit: true, currentAverageCost: true, cost: true } }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            })
            : [];
        const credits = await this.loadFiscalCredits(companyId, filters);

        const catMap: Record<string, { categoryName: string; revenue: number; cogs: number }> = {};

        for (const order of grossOrders) {
            for (const item of order.items) {
                const catName = item.menuItem?.category?.name || UNCATEGORIZED_CATEGORY;
                if (!catMap[catName]) catMap[catName] = { categoryName: catName, revenue: 0, cogs: 0 };
                catMap[catName].revenue += Number(item.subtotal);
            }
        }
        for (const credit of credits) {
            for (const line of credit.lines) {
                const catName = line.orderItem.menuItem?.category?.name || UNCATEGORIZED_CATEGORY;
                if (!catMap[catName]) catMap[catName] = { categoryName: catName, revenue: 0, cogs: 0 };
                catMap[catName].revenue -= Number(line.subtotal);
            }
        }

        for (const order of [...grossOrders, ...counterflowOrders]) {
            const hasPeriodLedger = temporalLedger.periodByOrderId.has(order.id);
            const allowRecipeFallback = grossOrderIds.has(order.id)
                && !temporalLedger.hasAnyOrderIds.has(order.id);
            if (!hasPeriodLedger && !allowRecipeFallback) continue;
            // ORD-* is order-grain; allocate to categories via recipe (or revenue) share.
            const lineCogs = await this.lineCogsPreferringLedger(
                companyId,
                order.id,
                order.items,
                hasPeriodLedger ? temporalLedger.periodByOrderId : new Map<number, number>()
            );
            for (const [index, item] of order.items.entries()) {
                const catName = item.menuItem?.category?.name || UNCATEGORIZED_CATEGORY;
                if (!catMap[catName]) catMap[catName] = { categoryName: catName, revenue: 0, cogs: 0 };
                catMap[catName].cogs += lineCogs[index] || 0;
            }
        }

        const items = Object.values(catMap)
            .map(c => ({
                ...c,
                revenue: Math.round(c.revenue * 100) / 100,
                cogs: Math.round(c.cogs * 100) / 100,
                grossMargin: Math.round((c.revenue - c.cogs) * 100) / 100,
                foodCostPct: c.revenue > 0 ? Math.round(c.cogs / c.revenue * 10000) / 100 : 0,
                marginPct: c.revenue > 0 ? Math.round((c.revenue - c.cogs) / c.revenue * 10000) / 100 : 0
            }))
            .sort((a, b) => b.revenue - a.revenue);

        const totalRevenue = items.reduce((s, i) => s + i.revenue, 0);
        const totalCOGS = items.reduce((s, i) => s + i.cogs, 0);

        return {
            items,
            summary: {
                totalRevenue: Math.round(totalRevenue * 100) / 100,
                totalCOGS: Math.round(totalCOGS * 100) / 100,
                overallFoodCost: totalRevenue > 0 ? Math.round(totalCOGS / totalRevenue * 10000) / 100 : 0,
                overallMargin: totalRevenue > 0 ? Math.round((totalRevenue - totalCOGS) / totalRevenue * 10000) / 100 : 0
            }
        };
    }

    // ── COSTS: Margin by Product (Most Profitable) ──
    static async getMarginByProduct(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number; categoryId?: number; categoryIds?: number[];
    }) {
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const grossOrders = await prisma.order.findMany({
            where: orderWhere,
            include: {
                items: {
                    include: {
                        menuItem: {
                            select: {
                                id: true, name: true, categoryId: true,
                                category: { select: { name: true } },
                                recipes: {
                                    select: {
                                        quantity: true,
                                        unit: true,
                                        product: { select: { id: true, name: true, unit: true, currentAverageCost: true, cost: true } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        const temporalLedger = await this.loadTemporalOrderLedgerCogs(
            companyId,
            grossOrders.map((order) => order.id),
            filters
        );
        const grossOrderIds = new Set(grossOrders.map((order) => order.id));
        const extraOrderIds = [...temporalLedger.periodByOrderId.keys()]
            .filter((orderId) => !grossOrderIds.has(orderId));
        const counterflowOrders = extraOrderIds.length > 0
            ? await prisma.order.findMany({
                where: { companyId, id: { in: extraOrderIds } },
                include: {
                    items: {
                        include: {
                            menuItem: {
                                select: {
                                    id: true, name: true, categoryId: true,
                                    category: { select: { name: true } },
                                    recipes: {
                                        select: {
                                            quantity: true,
                                            unit: true,
                                            product: { select: { id: true, name: true, unit: true, currentAverageCost: true, cost: true } }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            })
            : [];
        const credits = await this.loadFiscalCredits(companyId, filters);

        const prodMap: Record<number, {
            menuItemName: string; categoryName: string | null; revenue: number; cogs: number; unitsSold: number;
        }> = {};
        const selectedCategoryIds = filters?.categoryIds?.length
            ? new Set(filters.categoryIds)
            : filters?.categoryId ? new Set([filters.categoryId]) : null;

        const ensureProduct = (menuItemId: number, menuItemName: string, categoryName: string | null) => {
            if (!prodMap[menuItemId]) {
                prodMap[menuItemId] = {
                    menuItemName,
                    categoryName,
                    revenue: 0,
                    cogs: 0,
                    unitsSold: 0
                };
            }
            return prodMap[menuItemId];
        };

        for (const order of grossOrders) {
            for (const item of order.items) {
                if (!item.menuItem) continue;
                if (selectedCategoryIds && (!item.menuItem.categoryId || !selectedCategoryIds.has(item.menuItem.categoryId))) continue;
                const product = ensureProduct(item.menuItem.id, item.menuItem.name, item.menuItem.category?.name || null);
                product.revenue += Number(item.subtotal);
                product.unitsSold += item.quantity;
            }
        }
        for (const credit of credits) {
            for (const line of credit.lines) {
                const menuItem = line.orderItem.menuItem;
                if (!menuItem) continue;
                if (selectedCategoryIds && (!menuItem.categoryId || !selectedCategoryIds.has(menuItem.categoryId))) continue;
                const product = ensureProduct(line.orderItem.menuItemId, menuItem.name, menuItem.category?.name || null);
                product.revenue -= Number(line.subtotal);
                product.unitsSold -= line.quantity;
            }
        }

        for (const order of [...grossOrders, ...counterflowOrders]) {
            const hasPeriodLedger = temporalLedger.periodByOrderId.has(order.id);
            const allowRecipeFallback = grossOrderIds.has(order.id)
                && !temporalLedger.hasAnyOrderIds.has(order.id);
            if (!hasPeriodLedger && !allowRecipeFallback) continue;
            // Same ORD-* preference + within-order allocation as food-cost-by-category.
            // Category filters only affect which lines are published — allocation still
            // uses the full order so ledger totals stay consistent with getCostReport.
            const lineCogs = await this.lineCogsPreferringLedger(
                companyId,
                order.id,
                order.items,
                hasPeriodLedger ? temporalLedger.periodByOrderId : new Map<number, number>()
            );
            for (const [index, item] of order.items.entries()) {
                if (!item.menuItem) continue;
                if (selectedCategoryIds && (!item.menuItem.categoryId || !selectedCategoryIds.has(item.menuItem.categoryId))) continue;
                ensureProduct(
                    item.menuItem.id,
                    item.menuItem.name,
                    item.menuItem.category?.name || null
                ).cogs += lineCogs[index] || 0;
            }
        }

        const items = Object.values(prodMap)
            .map(p => ({
                ...p,
                revenue: Math.round(p.revenue * 100) / 100,
                cogs: Math.round(p.cogs * 100) / 100,
                margin: Math.round((p.revenue - p.cogs) * 100) / 100,
                marginPct: p.revenue > 0 ? Math.round((p.revenue - p.cogs) / p.revenue * 10000) / 100 : 0,
                foodCostPct: p.revenue > 0 ? Math.round(p.cogs / p.revenue * 10000) / 100 : 0
            }))
            .sort((a, b) => b.margin - a.margin);

        return {
            items,
            summary: {
                totalProducts: items.length,
                totalRevenue: Math.round(items.reduce((s, i) => s + i.revenue, 0) * 100) / 100,
                totalMargin: Math.round(items.reduce((s, i) => s + i.margin, 0) * 100) / 100,
                mostProfitable: items[0]?.menuItemName || 'N/A'
            }
        };
    }

    // ── AUDIT: Activity Log ──
    static async getAuditReport(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; userId?: number; entityType?: string;
        action?: string; limit?: number;
    }) {
        const where: Prisma.AuditLogWhereInput = {
            companyId,
            ...(filters?.userId ? { userId: filters.userId } : {}),
            ...(filters?.entityType ? { entityType: filters.entityType } : {}),
            ...(filters?.action ? { action: filters.action } : {}),
            ...(filters?.dateFrom || filters?.dateTo ? {
                createdAt: {
                    ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                    ...(filters?.dateTo ? { lte: filters.dateTo } : {}),
                }
            } : {}),
        };

        const logs = await prisma.auditLog.findMany({
            where,
            include: {
                user: { select: { name: true, role: { select: { name: true } } } }
            },
            orderBy: { createdAt: 'desc' },
            take: filters?.limit || 500
        });

        const items = logs.map(l => ({
            id: l.id,
            date: l.createdAt,
            userName: l.user?.name || 'System',
            roleName: l.user?.role?.name || 'N/A',
            entityType: l.entityType,
            entityId: l.entityId,
            action: l.action,
            details: l.details ? JSON.stringify(l.details) : null
        }));

        const actionCounts: Record<string, number> = {};
        for (const l of logs) {
            actionCounts[l.action] = (actionCounts[l.action] || 0) + 1;
        }

        return {
            items,
            summary: {
                totalEvents: items.length,
                uniqueUsers: new Set(logs.map(l => l.userId)).size,
                actionBreakdown: actionCounts
            }
        };
    }

    // ── DECISION: Strongest/Weakest Days ──
    static async getDayAnalysis(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number;
    }) {
        const timeZone = await SettingService.getTimezone(companyId);
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const [orders, credits] = await Promise.all([
            prisma.order.findMany({
                where: orderWhere,
                select: { closedAt: true, total: true, id: true }
            }),
            this.loadFiscalCredits(companyId, filters)
        ]);

        const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const dayMap: Record<number, { dayName: string; totalSales: number; orderCount: number; weekCount: number }> = {};
        for (let i = 0; i < 7; i++) dayMap[i] = { dayName: dayNames[i], totalSales: 0, orderCount: 0, weekCount: 0 };

        const datesTracked = new Set<string>();
        for (const order of orders) {
            const closedAt = order.closedAt as Date;
            const dayOfWeek = zonedWeekday(closedAt, timeZone);
            const localDate = zonedDateKey(closedAt, timeZone);
            if (!datesTracked.has(localDate)) {
                datesTracked.add(localDate);
                dayMap[dayOfWeek].weekCount += 1;
            }
            dayMap[dayOfWeek].totalSales += Number(order.total);
            dayMap[dayOfWeek].orderCount += 1;
        }
        for (const credit of credits) {
            const dayOfWeek = zonedWeekday(credit.issuedAt, timeZone);
            const localDate = zonedDateKey(credit.issuedAt, timeZone);
            if (!datesTracked.has(localDate)) {
                datesTracked.add(localDate);
                dayMap[dayOfWeek].weekCount += 1;
            }
            dayMap[dayOfWeek].totalSales -= Number(credit.total);
        }

        const items = Object.values(dayMap)
            .filter(d => d.orderCount > 0 || Math.abs(d.totalSales) > 1e-9)
            .map(d => ({
                ...d,
                totalSales: Math.round(d.totalSales * 100) / 100,
                avgDailySales: d.weekCount > 0 ? Math.round(d.totalSales / d.weekCount * 100) / 100 : 0,
                avgTicket: d.orderCount > 0 ? Math.round(d.totalSales / d.orderCount * 100) / 100 : 0,
            }))
            .sort((a, b) => b.avgDailySales - a.avgDailySales);

        return {
            items: items.map((d, idx) => ({ ...d, rank: idx + 1 })),
            summary: {
                strongestDay: items[0]?.dayName || 'N/A',
                weakestDay: items[items.length - 1]?.dayName || 'N/A',
                totalOrders: orders.length
            }
        };
    }

    // ── DECISION: Month vs Month Comparison ──
    static async getMonthComparison(companyId: number, filters?: {
        branchId?: number; monthA?: string; monthB?: string;
    }) {
        const timeZone = await SettingService.getTimezone(companyId);
        const now = new Date();
        const monthBStr = filters?.monthB || zonedMonthKey(now, timeZone);
        const [monthBYear, monthBNumber] = monthBStr.split('-').map(Number);
        const previous = new Date(Date.UTC(monthBYear, monthBNumber - 2, 1));
        const defaultMonthA = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
        const monthAStr = filters?.monthA || defaultMonthA;

        const buildBounds = (monthStr: string) => {
            const from = parseZonedDateStart(`${monthStr}-01`, timeZone);
            const [year, month] = monthStr.split('-').map(Number);
            const nextMonth = new Date(Date.UTC(year, month, 1));
            const nextMonthKey = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}`;
            const to = new Date(parseZonedDateStart(`${nextMonthKey}-01`, timeZone).getTime() - 1);
            return { from, to };
        };
        const boundsA = buildBounds(monthAStr);
        const boundsB = buildBounds(monthBStr);

        const [ordersA, ordersB, creditsA, creditsB] = await Promise.all([
            prisma.order.findMany({
                where: this.buildOrderWhere(companyId, { branchId: filters?.branchId, dateFrom: boundsA.from, dateTo: boundsA.to }),
                select: { total: true }
            }),
            prisma.order.findMany({
                where: this.buildOrderWhere(companyId, { branchId: filters?.branchId, dateFrom: boundsB.from, dateTo: boundsB.to }),
                select: { total: true }
            }),
            this.loadFiscalCredits(companyId, { branchId: filters?.branchId, dateFrom: boundsA.from, dateTo: boundsA.to }),
            this.loadFiscalCredits(companyId, { branchId: filters?.branchId, dateFrom: boundsB.from, dateTo: boundsB.to })
        ]);

        const salesA = ordersA.reduce((s, o) => s + Number(o.total), 0)
            - creditsA.reduce((s, note) => s + Number(note.total), 0);
        const salesB = ordersB.reduce((s, o) => s + Number(o.total), 0)
            - creditsB.reduce((s, note) => s + Number(note.total), 0);
        const variation = salesA > 0 ? Math.round((salesB - salesA) / salesA * 10000) / 100 : 0;

        return {
            items: [
                { month: monthAStr, label: 'Mes Anterior', totalSales: Math.round(salesA * 100) / 100, orderCount: ordersA.length },
                { month: monthBStr, label: 'Mes Actual', totalSales: Math.round(salesB * 100) / 100, orderCount: ordersB.length },
            ],
            summary: {
                salesMonthA: Math.round(salesA * 100) / 100,
                salesMonthB: Math.round(salesB * 100) / 100,
                absoluteVariation: Math.round((salesB - salesA) * 100) / 100,
                percentVariation: variation
            }
        };
    }

    // ── Helpers ──
    private static buildPurchaseWhere(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number; supplierId?: number;
        status?: string; categoryId?: number; productId?: number;
    }): Prisma.PurchaseOrderWhereInput {
        return {
            companyId,
            ...(filters?.branchId ? { branchId: filters.branchId } : {}),
            ...(filters?.supplierId ? { supplierId: filters.supplierId } : {}),
            ...(filters?.status ? { status: filters.status as Prisma.PurchaseOrderWhereInput['status'] } : {}),
            ...(filters?.dateFrom || filters?.dateTo ? {
                date: {
                    ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                    ...(filters?.dateTo ? { lte: filters.dateTo } : {}),
                }
            } : {}),
        };
    }

    private static buildOrderWhere(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number; salesChannel?: string;
        userId?: number; categoryId?: number;
    }): Prisma.OrderWhereInput {
        return {
            companyId,
            // Fiscal credits are separate negative events. Retain the original
            // closed ticket as gross even when its final note changes the
            // operational/payment state to CANCELLED/UNPAID.
            OR: [
                { financialStatus: 'PAID', status: { not: 'CANCELLED' } },
                { status: 'CANCELLED', invoiceFiscalStatus: 'CREDITED' }
            ],
            closedAt: { not: null },
            ...(filters?.branchId ? { branchId: filters.branchId } : {}),
            ...(filters?.salesChannel ? { salesChannel: filters.salesChannel as Prisma.OrderWhereInput['salesChannel'] } : {}),
            ...(filters?.userId ? { userId: filters.userId } : {}),
            ...(filters?.dateFrom || filters?.dateTo ? {
                closedAt: {
                    not: null,
                    ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                    ...(filters?.dateTo ? { lte: filters.dateTo } : {}),
                }
            } : {}),
        };
    }
}
