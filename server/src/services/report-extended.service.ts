import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export class ReportExtendedService {
    // ── PURCHASES: By Day ──
    static async getPurchasesByDay(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number; supplierId?: number;
        categoryId?: number; productId?: number;
    }) {
        const poWhere = this.buildPurchaseWhere(companyId, filters);
        const orders = await prisma.purchaseOrder.findMany({
            where: poWhere,
            include: {
                supplier: { select: { name: true } },
                items: {
                    include: { product: { select: { name: true, sku: true, category: { select: { name: true } } } } }
                }
            },
            orderBy: { date: 'asc' }
        });

        const byDay: Record<string, { date: string; totalAmount: number; orderCount: number; itemCount: number }> = {};
        for (const po of orders) {
            const day = po.date.toISOString().split('T')[0];
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
        const orders = await prisma.purchaseOrder.findMany({
            where: poWhere,
            select: { date: true, total: true },
            orderBy: { date: 'asc' }
        });

        const byMonth: Record<string, { month: string; totalAmount: number; orderCount: number }> = {};
        for (const po of orders) {
            const m = po.date.toISOString().substring(0, 7);
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

        for (const po of orders) {
            for (const item of po.items) {
                if (filters?.categoryId && item.product.categoryId !== filters.categoryId) continue;
                const productKey = `${item.product.id}|${item.product.name}|${item.product.sku || ''}|${item.product.category?.name || ''}`;
                const supplierKey = `${po.supplier.id}|${po.supplier.name}`;
                if (!matrix[productKey]) matrix[productKey] = {};
                if (!matrix[productKey][supplierKey]) {
                    matrix[productKey][supplierKey] = { avgCost: 0, minCost: Infinity, maxCost: 0, totalQty: 0, entries: 0 };
                }
                const unitCost = Number(item.cost);
                const qty = Number(item.quantity);
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
                    : 0
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

        for (const po of orders) {
            for (const item of po.items) {
                if (!productMap[item.productId]) {
                    productMap[item.productId] = {
                        productName: item.product.name,
                        sku: item.product.sku,
                        unit: item.product.unit,
                        categoryName: item.product.category?.name || null,
                        totalQuantity: 0, totalCost: 0, orderCount: 0
                    };
                }
                productMap[item.productId].totalQuantity += Number(item.quantity);
                productMap[item.productId].totalCost += Number(item.subtotal);
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
                totalSpent: Math.round(items.reduce((s, i) => s + i.totalCost, 0) * 100) / 100
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
        dateFrom?: Date; dateTo?: Date; branchId?: number;
    }) {
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const orders = await prisma.order.findMany({
            where: orderWhere,
            include: {
                items: {
                    include: {
                        menuItem: { select: { category: { select: { id: true, name: true } } } }
                    }
                }
            }
        });

        const catMap: Record<string, { categoryName: string; totalSales: number; itemCount: number; unitsSold: number }> = {};
        let grandTotal = 0;

        for (const order of orders) {
            for (const item of order.items) {
                const catName = item.menuItem?.category?.name || 'Sin Categoría';
                if (!catMap[catName]) catMap[catName] = { categoryName: catName, totalSales: 0, itemCount: 0, unitsSold: 0 };
                catMap[catName].totalSales += Number(item.subtotal);
                catMap[catName].itemCount += 1;
                catMap[catName].unitsSold += item.quantity;
                grandTotal += Number(item.subtotal);
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

    // ── SALES: Daily ──
    static async getSalesDaily(companyId: number, filters?: {
        dateFrom?: Date; dateTo?: Date; branchId?: number; salesChannel?: string;
    }) {
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const orders = await prisma.order.findMany({
            where: orderWhere,
            select: { createdAt: true, total: true, discount: true, id: true, salesChannel: true },
            orderBy: { createdAt: 'asc' }
        });

        const byDay: Record<string, { date: string; totalSales: number; orderCount: number; avgTicket: number; totalDiscount: number }> = {};

        for (const order of orders) {
            const day = order.createdAt.toISOString().split('T')[0];
            if (!byDay[day]) byDay[day] = { date: day, totalSales: 0, orderCount: 0, avgTicket: 0, totalDiscount: 0 };
            byDay[day].totalSales += Number(order.total);
            byDay[day].orderCount += 1;
            byDay[day].totalDiscount += Number(order.discount);
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
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const orders = await prisma.order.findMany({
            where: orderWhere,
            select: { createdAt: true, total: true, id: true }
        });

        const byMonth: Record<string, { month: string; totalSales: number; orderCount: number }> = {};
        for (const o of orders) {
            const m = o.createdAt.toISOString().substring(0, 7);
            if (!byMonth[m]) byMonth[m] = { month: m, totalSales: 0, orderCount: 0 };
            byMonth[m].totalSales += Number(o.total);
            byMonth[m].orderCount += 1;
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
        const orders = await prisma.order.findMany({
            where: orderWhere,
            include: {
                payments: { include: { paymentMethod: { select: { name: true } } } }
            }
        });

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
        const orders = await prisma.order.findMany({
            where: orderWhere,
            include: {
                user: { select: { id: true, name: true, role: { select: { name: true } } } }
            }
        });

        const userMap: Record<number, {
            userName: string; roleName: string; totalSales: number; orderCount: number;
        }> = {};

        for (const order of orders) {
            if (!userMap[order.userId]) {
                userMap[order.userId] = {
                    userName: order.user?.name || 'Unknown',
                    roleName: order.user?.role?.name || 'N/A',
                    totalSales: 0, orderCount: 0
                };
            }
            userMap[order.userId].totalSales += Number(order.total);
            userMap[order.userId].orderCount += 1;
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
        const orders = await prisma.order.findMany({
            where: orderWhere,
            select: {
                total: true, salesChannel: true, channelCommission: true, channelMarkup: true,
                items: {
                    select: {
                        quantity: true, subtotal: true,
                        menuItem: {
                            select: {
                                recipes: { select: { quantity: true, product: { select: { currentAverageCost: true } } } }
                            }
                        }
                    }
                }
            }
        });

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

            for (const item of order.items) {
                for (const recipe of (item.menuItem?.recipes || [])) {
                    channelMap[ch].estimatedCOGS += Number(recipe.quantity) * item.quantity * Number(recipe.product.currentAverageCost);
                }
            }
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
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const orders = await prisma.order.findMany({
            where: orderWhere,
            select: { createdAt: true, total: true, id: true }
        });

        const hourMap: Record<number, { hour: number; totalSales: number; orderCount: number }> = {};
        for (let h = 0; h < 24; h++) hourMap[h] = { hour: h, totalSales: 0, orderCount: 0 };

        for (const order of orders) {
            const hour = new Date(order.createdAt).getHours();
            hourMap[hour].totalSales += Number(order.total);
            hourMap[hour].orderCount += 1;
        }

        const items = Object.values(hourMap)
            .filter(h => h.orderCount > 0)
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
        const orders = await prisma.order.findMany({
            where: orderWhere,
            include: {
                items: {
                    include: {
                        menuItem: {
                            select: {
                                categoryId: true,
                                category: { select: { name: true } },
                                recipes: {
                                    select: { quantity: true, product: { select: { currentAverageCost: true } } }
                                }
                            }
                        }
                    }
                }
            }
        });

        const catMap: Record<string, { categoryName: string; revenue: number; cogs: number }> = {};

        for (const order of orders) {
            for (const item of order.items) {
                const catName = item.menuItem?.category?.name || 'Sin Categoría';
                if (!catMap[catName]) catMap[catName] = { categoryName: catName, revenue: 0, cogs: 0 };
                catMap[catName].revenue += Number(item.subtotal);
                for (const recipe of (item.menuItem?.recipes || [])) {
                    catMap[catName].cogs += Number(recipe.quantity) * item.quantity * Number(recipe.product.currentAverageCost);
                }
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
        dateFrom?: Date; dateTo?: Date; branchId?: number; categoryId?: number;
    }) {
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const orders = await prisma.order.findMany({
            where: orderWhere,
            include: {
                items: {
                    include: {
                        menuItem: {
                            select: {
                                id: true, name: true, categoryId: true,
                                category: { select: { name: true } },
                                recipes: {
                                    select: { quantity: true, product: { select: { currentAverageCost: true } } }
                                }
                            }
                        }
                    }
                }
            }
        });

        const prodMap: Record<number, {
            menuItemName: string; categoryName: string | null; revenue: number; cogs: number; unitsSold: number;
        }> = {};

        for (const order of orders) {
            for (const item of order.items) {
                if (!item.menuItem) continue;
                if (filters?.categoryId && item.menuItem.categoryId !== filters.categoryId) continue;
                const id = item.menuItem.id;
                if (!prodMap[id]) {
                    prodMap[id] = {
                        menuItemName: item.menuItem.name,
                        categoryName: item.menuItem.category?.name || null,
                        revenue: 0, cogs: 0, unitsSold: 0
                    };
                }
                prodMap[id].revenue += Number(item.subtotal);
                prodMap[id].unitsSold += item.quantity;
                for (const recipe of (item.menuItem.recipes || [])) {
                    prodMap[id].cogs += Number(recipe.quantity) * item.quantity * Number(recipe.product.currentAverageCost);
                }
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
        const orderWhere = this.buildOrderWhere(companyId, filters);
        const orders = await prisma.order.findMany({
            where: orderWhere,
            select: { createdAt: true, total: true, id: true }
        });

        const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const dayMap: Record<number, { dayName: string; totalSales: number; orderCount: number; weekCount: number }> = {};
        for (let i = 0; i < 7; i++) dayMap[i] = { dayName: dayNames[i], totalSales: 0, orderCount: 0, weekCount: 0 };

        const weeksTracked = new Set<string>();
        for (const order of orders) {
            const d = new Date(order.createdAt);
            const dayOfWeek = d.getDay();
            const weekKey = `${d.getFullYear()}-W${Math.ceil((d.getDate() + 6 - dayOfWeek) / 7)}-${dayOfWeek}`;
            if (!weeksTracked.has(weekKey)) {
                weeksTracked.add(weekKey);
                dayMap[dayOfWeek].weekCount += 1;
            }
            dayMap[dayOfWeek].totalSales += Number(order.total);
            dayMap[dayOfWeek].orderCount += 1;
        }

        const items = Object.values(dayMap)
            .filter(d => d.orderCount > 0)
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
        const now = new Date();
        const monthBStr = filters?.monthB || now.toISOString().substring(0, 7);
        const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const monthAStr = filters?.monthA || prevDate.toISOString().substring(0, 7);

        const buildWhere = (monthStr: string): Prisma.OrderWhereInput => {
            const [year, month] = monthStr.split('-').map(Number);
            const from = new Date(year, month - 1, 1);
            const to = new Date(year, month, 0, 23, 59, 59, 999);
            return {
                companyId,
                status: 'PAID',
                ...(filters?.branchId ? { branchId: filters.branchId } : {}),
                createdAt: { gte: from, lte: to }
            };
        };

        const [ordersA, ordersB] = await Promise.all([
            prisma.order.findMany({ where: buildWhere(monthAStr), select: { total: true } }),
            prisma.order.findMany({ where: buildWhere(monthBStr), select: { total: true } })
        ]);

        const salesA = ordersA.reduce((s, o) => s + Number(o.total), 0);
        const salesB = ordersB.reduce((s, o) => s + Number(o.total), 0);
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
            ...(filters?.status ? { status: filters.status as any } : {}),
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
            status: 'PAID',
            ...(filters?.branchId ? { branchId: filters.branchId } : {}),
            ...(filters?.salesChannel ? { salesChannel: filters.salesChannel as any } : {}),
            ...(filters?.userId ? { userId: filters.userId } : {}),
            ...(filters?.dateFrom || filters?.dateTo ? {
                createdAt: {
                    ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                    ...(filters?.dateTo ? { lte: filters.dateTo } : {}),
                }
            } : {}),
        };
    }
}
