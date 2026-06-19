import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

interface BaseFilters {
    branchId?: number;
    dateFrom?: Date;
    dateTo?: Date;
    productId?: number;
    status?: string;
}

function dateWhere(filters: BaseFilters): Prisma.DateTimeFilter | undefined {
    if (!filters.dateFrom && !filters.dateTo) return undefined;
    const f: Prisma.DateTimeFilter = {};
    if (filters.dateFrom) f.gte = filters.dateFrom;
    if (filters.dateTo) f.lte = filters.dateTo;
    return f;
}

export class ProductionReportService {
    /** Producciones realizadas: listado + resumen por periodo. */
    static async getProductions(companyId: number, filters: BaseFilters) {
        const where: Prisma.ProductionOrderWhereInput = { companyId };
        if (filters.branchId) where.branchId = filters.branchId;
        if (filters.productId) where.productId = filters.productId;
        if (filters.status) where.status = filters.status as Prisma.EnumProductionOrderStatusFilter['equals'];
        const dw = dateWhere(filters);
        if (dw) where.date = dw;

        const orders = await prisma.productionOrder.findMany({
            where,
            include: {
                product: { select: { id: true, name: true, sku: true, type: true } },
                warehouse: { select: { id: true, name: true } },
                user: { select: { id: true, name: true } }
            },
            orderBy: { date: 'desc' }
        });

        const summary = orders.reduce(
            (acc, o) => {
                acc.count += 1;
                acc.totalPlanned += Number(o.plannedQuantity);
                acc.totalProduced += Number(o.producedQuantity);
                acc.totalEstimatedCost += Number(o.estimatedCost);
                acc.totalRealCost += Number(o.realCost);
                if (o.status === 'FINISHED') acc.finished += 1;
                if (o.status === 'CANCELLED') acc.cancelled += 1;
                return acc;
            },
            { count: 0, finished: 0, cancelled: 0, totalPlanned: 0, totalProduced: 0, totalEstimatedCost: 0, totalRealCost: 0 }
        );

        return { summary, items: orders };
    }

    /** Consumo de insumos por producción (agregado por insumo, sobre órdenes finalizadas). */
    static async getInputConsumption(companyId: number, filters: BaseFilters) {
        const where: Prisma.ProductionOrderWhereInput = { companyId, status: 'FINISHED' };
        if (filters.branchId) where.branchId = filters.branchId;
        if (filters.productId) where.productId = filters.productId;
        const dw = dateWhere(filters);
        if (dw) where.finishedAt = dw;

        const orders = await prisma.productionOrder.findMany({
            where,
            include: {
                items: { include: { componentProduct: { select: { id: true, name: true, sku: true, type: true, unit: true } } } }
            }
        });

        const byComponent = new Map<number, { componentProductId: number; name: string; sku: string | null; unit: string; consumedQuantity: number; totalCost: number; orders: number }>();
        for (const o of orders) {
            for (const it of o.items) {
                const consumed = Number(it.consumedQuantity);
                if (consumed <= 0) continue;
                const key = it.componentProductId;
                const prev = byComponent.get(key) || {
                    componentProductId: key,
                    name: it.componentProduct.name,
                    sku: it.componentProduct.sku,
                    unit: it.componentProduct.unit,
                    consumedQuantity: 0,
                    totalCost: 0,
                    orders: 0
                };
                prev.consumedQuantity += consumed;
                prev.totalCost += Number(it.totalCost);
                prev.orders += 1;
                byComponent.set(key, prev);
            }
        }

        const items = Array.from(byComponent.values()).sort((a, b) => b.totalCost - a.totalCost);
        const totalCost = items.reduce((s, i) => s + i.totalCost, 0);
        return { summary: { components: items.length, totalCost }, items };
    }

    /** Diferencias entre cantidad planificada y real + variación de costo (rendimiento/merma). */
    static async getPlanVsReal(companyId: number, filters: BaseFilters) {
        const where: Prisma.ProductionOrderWhereInput = { companyId, status: 'FINISHED' };
        if (filters.branchId) where.branchId = filters.branchId;
        if (filters.productId) where.productId = filters.productId;
        const dw = dateWhere(filters);
        if (dw) where.finishedAt = dw;

        const orders = await prisma.productionOrder.findMany({
            where,
            include: { product: { select: { id: true, name: true, sku: true } } },
            orderBy: { finishedAt: 'desc' }
        });

        const items = orders.map((o) => {
            const planned = Number(o.plannedQuantity);
            const produced = Number(o.producedQuantity);
            const qtyDiff = produced - planned;
            const yieldPct = planned > 0 ? (produced / planned) * 100 : 0;
            const estimatedCost = Number(o.estimatedCost);
            const realCost = Number(o.realCost);
            return {
                id: o.id,
                code: o.code,
                product: o.product,
                finishedAt: o.finishedAt,
                plannedQuantity: planned,
                producedQuantity: produced,
                quantityDiff: qtyDiff,
                yieldPct: Math.round(yieldPct * 100) / 100,
                estimatedCost,
                realCost,
                costVariance: realCost - estimatedCost,
                estimatedUnitCost: Number(o.estimatedUnitCost),
                realUnitCost: Number(o.realUnitCost)
            };
        });

        const summary = items.reduce(
            (acc, i) => {
                acc.count += 1;
                acc.totalPlanned += i.plannedQuantity;
                acc.totalProduced += i.producedQuantity;
                acc.totalCostVariance += i.costVariance;
                return acc;
            },
            { count: 0, totalPlanned: 0, totalProduced: 0, totalCostVariance: 0, avgYieldPct: 0 }
        );
        summary.avgYieldPct = summary.totalPlanned > 0 ? Math.round((summary.totalProduced / summary.totalPlanned) * 10000) / 100 : 0;

        return { summary, items };
    }

    /** Kardex de productos producidos: movimientos con referencia PROD-*. */
    static async getProducedKardex(companyId: number, filters: BaseFilters & { warehouseId?: number }) {
        const where: Prisma.InventoryMovementWhereInput = {
            companyId,
            reference: { startsWith: 'PROD-' }
        };
        if (filters.productId) where.productId = filters.productId;
        if (filters.warehouseId) where.warehouseId = filters.warehouseId;
        const dw = dateWhere(filters);
        if (dw) where.createdAt = dw;

        const movements = await prisma.inventoryMovement.findMany({
            where,
            include: {
                product: { select: { id: true, name: true, sku: true, type: true } },
                warehouse: { select: { id: true, name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        return { items: movements };
    }

    /**
     * Trazabilidad de un producto terminado hacia sus insumos para una orden de
     * producción concreta. Incluye, por cada insumo que a su vez es producido
     * internamente, las órdenes de producción que lo generaron (un nivel hacia atrás).
     */
    static async getTraceability(companyId: number, orderId: number) {
        const order = await prisma.productionOrder.findFirst({
            where: { id: orderId, companyId },
            include: {
                product: { select: { id: true, name: true, sku: true, type: true } },
                warehouse: { select: { id: true, name: true } },
                user: { select: { id: true, name: true } },
                items: { include: { componentProduct: { select: { id: true, name: true, sku: true, type: true } } } }
            }
        });
        if (!order) throw new Error('Orden de producción no encontrada');

        const inputs = await Promise.all(
            order.items.map(async (it) => {
                // sub-productions that generated this input (intermediates)
                const subOrders = await prisma.productionOrder.findMany({
                    where: { companyId, productId: it.componentProductId, status: 'FINISHED' },
                    select: { id: true, code: true, producedQuantity: true, realUnitCost: true, finishedAt: true },
                    orderBy: { finishedAt: 'desc' },
                    take: 5
                });
                return {
                    componentProductId: it.componentProductId,
                    componentProduct: it.componentProduct,
                    consumedQuantity: Number(it.consumedQuantity),
                    unit: it.unit,
                    unitCost: Number(it.unitCost),
                    totalCost: Number(it.totalCost),
                    isProducedInternally: it.componentProduct.type === 'INTERMEDIATE' && subOrders.length > 0,
                    sourceProductions: subOrders
                };
            })
        );

        return { order, inputs };
    }

    /**
     * Rentabilidad del producto terminado: compara el costo (promedio ponderado /
     * último costo real de producción) contra el precio de venta del producto.
     */
    static async getProfitability(companyId: number, filters: BaseFilters) {
        const where: Prisma.ProductWhereInput = {
            companyId,
            active: true,
            type: { in: ['PRODUCT_FOR_SALE', 'BOTH', 'INTERMEDIATE'] }
        };
        if (filters.productId) where.id = filters.productId;

        const products = await prisma.product.findMany({
            where,
            select: { id: true, name: true, sku: true, type: true, price: true, currentAverageCost: true, cost: true }
        });

        const items = await Promise.all(
            products.map(async (p) => {
                const lastProd = await prisma.productionOrder.findFirst({
                    where: { companyId, productId: p.id, status: 'FINISHED' },
                    orderBy: { finishedAt: 'desc' },
                    select: { realUnitCost: true, finishedAt: true }
                });
                const cost = Number(p.currentAverageCost || p.cost || 0);
                const price = p.price != null ? Number(p.price) : null;
                const margin = price != null ? price - cost : null;
                const marginPct = price != null && price > 0 ? Math.round(((price - cost) / price) * 10000) / 100 : null;
                return {
                    productId: p.id,
                    name: p.name,
                    sku: p.sku,
                    type: p.type,
                    averageCost: cost,
                    lastProductionUnitCost: lastProd ? Number(lastProd.realUnitCost) : null,
                    salePrice: price,
                    margin,
                    marginPct
                };
            })
        );

        return { summary: { products: items.length }, items };
    }

    /**
     * Panel de control de producción: KPIs, serie temporal, top de productos
     * fabricados, top de insumos consumidos, desglose por estado y órdenes
     * recientes. Todo en una sola consulta para alimentar el dashboard.
     */
    static async getDashboard(companyId: number, filters: BaseFilters) {
        const orderWhere: Prisma.ProductionOrderWhereInput = { companyId };
        if (filters.branchId) orderWhere.branchId = filters.branchId;
        const dw = dateWhere(filters);
        if (dw) orderWhere.date = dw;

        const orders = await prisma.productionOrder.findMany({
            where: orderWhere,
            include: {
                product: { select: { id: true, name: true, sku: true, type: true } },
                warehouse: { select: { id: true, name: true } },
                branch: { select: { id: true, name: true } },
                user: { select: { id: true, name: true } },
                items: { include: { componentProduct: { select: { id: true, name: true, sku: true, unit: true, type: true } } } }
            },
            orderBy: { date: 'desc' }
        });

        const kpis = {
            total: 0,
            draft: 0,
            pending: 0,
            inProgress: 0,
            finished: 0,
            cancelled: 0,
            totalPlanned: 0,
            totalProduced: 0,
            totalEstimatedCost: 0,
            totalRealCost: 0,
            costVariance: 0,
            avgYieldPct: 0
        };

        const dayMap = new Map<string, { date: string; orders: number; produced: number; realCost: number; estimatedCost: number }>();
        const producedMap = new Map<number, { productId: number; name: string; sku: string | null; type: string; orders: number; produced: number; planned: number; realCost: number; estimatedCost: number }>();
        const inputMap = new Map<number, { componentProductId: number; name: string; sku: string | null; unit: string; consumedQuantity: number; totalCost: number }>();
        const branchMap = new Map<number, { branchId: number; name: string; orders: number; produced: number; planned: number; realCost: number }>();
        const operatorMap = new Map<number, { userId: number; name: string; orders: number; produced: number; realCost: number }>();

        let finishedPlanned = 0;
        let finishedProduced = 0;

        for (const o of orders) {
            kpis.total += 1;
            kpis.totalPlanned += Number(o.plannedQuantity);
            kpis.totalProduced += Number(o.producedQuantity);
            kpis.totalEstimatedCost += Number(o.estimatedCost);
            kpis.totalRealCost += Number(o.realCost);

            switch (o.status) {
                case 'DRAFT': kpis.draft += 1; break;
                case 'PENDING': kpis.pending += 1; break;
                case 'IN_PROGRESS': kpis.inProgress += 1; break;
                case 'FINISHED': kpis.finished += 1; break;
                case 'CANCELLED': kpis.cancelled += 1; break;
            }

            if (o.status === 'FINISHED') {
                finishedPlanned += Number(o.plannedQuantity);
                finishedProduced += Number(o.producedQuantity);

                const effDate = (o.finishedAt ?? o.date);
                const key = effDate.toISOString().slice(0, 10);
                const day = dayMap.get(key) || { date: key, orders: 0, produced: 0, realCost: 0, estimatedCost: 0 };
                day.orders += 1;
                day.produced += Number(o.producedQuantity);
                day.realCost += Number(o.realCost);
                day.estimatedCost += Number(o.estimatedCost);
                dayMap.set(key, day);

                const pp = producedMap.get(o.productId) || {
                    productId: o.productId,
                    name: o.product.name,
                    sku: o.product.sku,
                    type: o.product.type,
                    orders: 0,
                    produced: 0,
                    planned: 0,
                    realCost: 0,
                    estimatedCost: 0
                };
                pp.orders += 1;
                pp.produced += Number(o.producedQuantity);
                pp.planned += Number(o.plannedQuantity);
                pp.realCost += Number(o.realCost);
                pp.estimatedCost += Number(o.estimatedCost);
                producedMap.set(o.productId, pp);

                const bp = branchMap.get(o.branchId) || {
                    branchId: o.branchId,
                    name: o.branch?.name ?? ('Sucursal ' + o.branchId),
                    orders: 0,
                    produced: 0,
                    planned: 0,
                    realCost: 0
                };
                bp.orders += 1;
                bp.produced += Number(o.producedQuantity);
                bp.planned += Number(o.plannedQuantity);
                bp.realCost += Number(o.realCost);
                branchMap.set(o.branchId, bp);

                if (o.userId != null && o.user) {
                    const op = operatorMap.get(o.userId) || {
                        userId: o.userId,
                        name: o.user.name,
                        orders: 0,
                        produced: 0,
                        realCost: 0
                    };
                    op.orders += 1;
                    op.produced += Number(o.producedQuantity);
                    op.realCost += Number(o.realCost);
                    operatorMap.set(o.userId, op);
                }

                for (const it of o.items) {
                    const consumed = Number(it.consumedQuantity);
                    if (consumed <= 0) continue;
                    const ip = inputMap.get(it.componentProductId) || {
                        componentProductId: it.componentProductId,
                        name: it.componentProduct.name,
                        sku: it.componentProduct.sku,
                        unit: it.componentProduct.unit,
                        consumedQuantity: 0,
                        totalCost: 0
                    };
                    ip.consumedQuantity += consumed;
                    ip.totalCost += Number(it.totalCost);
                    inputMap.set(it.componentProductId, ip);
                }
            }
        }

        kpis.costVariance = Math.round((kpis.totalRealCost - kpis.totalEstimatedCost) * 100) / 100;
        kpis.avgYieldPct = finishedPlanned > 0 ? Math.round((finishedProduced / finishedPlanned) * 10000) / 100 : 0;

        const activeOrders = kpis.draft + kpis.pending + kpis.inProgress;
        const completionRate = kpis.total > 0 ? Math.round((kpis.finished / kpis.total) * 10000) / 100 : 0;
        const cancelRate = kpis.total > 0 ? Math.round((kpis.cancelled / kpis.total) * 10000) / 100 : 0;
        const avgRealUnitCost = kpis.totalProduced > 0 ? Math.round((kpis.totalRealCost / kpis.totalProduced) * 100) / 100 : 0;
        const costVariancePct = kpis.totalEstimatedCost > 0 ? Math.round((kpis.costVariance / kpis.totalEstimatedCost) * 10000) / 100 : 0;

        const kpisExtended = {
            ...kpis,
            activeOrders,
            completionRate,
            cancelRate,
            avgRealUnitCost,
            costVariancePct
        };

        const timeSeries = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
        const topProduced = Array.from(producedMap.values())
            .sort((a, b) => b.produced - a.produced)
            .slice(0, 8)
            .map((p) => ({
                productId: p.productId,
                name: p.name,
                sku: p.sku,
                type: p.type,
                orders: p.orders,
                produced: p.produced,
                realCost: p.realCost,
                estimatedCost: p.estimatedCost,
                costVariance: Math.round((p.realCost - p.estimatedCost) * 100) / 100,
                yieldPct: p.planned > 0 ? Math.round((p.produced / p.planned) * 10000) / 100 : 0
            }));
        const topConsumed = Array.from(inputMap.values()).sort((a, b) => b.totalCost - a.totalCost).slice(0, 8);

        const branchComparison = Array.from(branchMap.values())
            .sort((a, b) => b.produced - a.produced)
            .map((b) => ({
                branchId: b.branchId,
                name: b.name,
                orders: b.orders,
                produced: b.produced,
                realCost: b.realCost,
                yieldPct: b.planned > 0 ? Math.round((b.produced / b.planned) * 10000) / 100 : 0
            }));

        const topOperators = Array.from(operatorMap.values())
            .sort((a, b) => b.produced - a.produced)
            .slice(0, 8)
            .map((o) => ({
                userId: o.userId,
                name: o.name,
                orders: o.orders,
                produced: o.produced,
                realCost: o.realCost
            }));

        let previous: {
            total: number;
            finished: number;
            totalProduced: number;
            totalRealCost: number;
            costVariance: number;
            avgYieldPct: number;
        } | null = null;

        if (filters.dateFrom && filters.dateTo) {
            const lengthMs = filters.dateTo.getTime() - filters.dateFrom.getTime();
            const prevTo = new Date(filters.dateFrom.getTime() - 1);
            const prevFrom = new Date(prevTo.getTime() - lengthMs);

            const prevWhere: Prisma.ProductionOrderWhereInput = {
                companyId,
                date: { gte: prevFrom, lte: prevTo }
            };
            if (filters.branchId) prevWhere.branchId = filters.branchId;

            const prevOrders = await prisma.productionOrder.findMany({
                where: prevWhere,
                select: { status: true, plannedQuantity: true, producedQuantity: true, estimatedCost: true, realCost: true }
            });

            const prevAgg = prevOrders.reduce(
                (acc, o) => {
                    acc.total += 1;
                    acc.totalProduced += Number(o.producedQuantity);
                    acc.totalEstimatedCost += Number(o.estimatedCost);
                    acc.totalRealCost += Number(o.realCost);
                    if (o.status === 'FINISHED') {
                        acc.finished += 1;
                        acc.finishedPlanned += Number(o.plannedQuantity);
                        acc.finishedProduced += Number(o.producedQuantity);
                    }
                    return acc;
                },
                { total: 0, finished: 0, totalProduced: 0, totalEstimatedCost: 0, totalRealCost: 0, finishedPlanned: 0, finishedProduced: 0 }
            );

            previous = {
                total: prevAgg.total,
                finished: prevAgg.finished,
                totalProduced: prevAgg.totalProduced,
                totalRealCost: prevAgg.totalRealCost,
                costVariance: Math.round((prevAgg.totalRealCost - prevAgg.totalEstimatedCost) * 100) / 100,
                avgYieldPct: prevAgg.finishedPlanned > 0 ? Math.round((prevAgg.finishedProduced / prevAgg.finishedPlanned) * 10000) / 100 : 0
            };
        }

        const statusBreakdown = [
            { status: 'DRAFT', count: kpis.draft },
            { status: 'PENDING', count: kpis.pending },
            { status: 'IN_PROGRESS', count: kpis.inProgress },
            { status: 'FINISHED', count: kpis.finished },
            { status: 'CANCELLED', count: kpis.cancelled }
        ];

        const recentOrders = orders.slice(0, 8).map((o) => ({
            id: o.id,
            code: o.code,
            product: o.product,
            status: o.status,
            plannedQuantity: Number(o.plannedQuantity),
            producedQuantity: Number(o.producedQuantity),
            realCost: Number(o.realCost),
            estimatedCost: Number(o.estimatedCost),
            date: o.date,
            finishedAt: o.finishedAt
        }));

        const [activeRecipes, producibleProducts] = await Promise.all([
            prisma.productionRecipe.count({ where: { companyId, status: 'ACTIVE' } }),
            prisma.product.count({ where: { companyId, active: true, type: { in: ['INTERMEDIATE', 'PRODUCT_FOR_SALE', 'BOTH'] } } })
        ]);

        return {
            kpis: kpisExtended,
            previous,
            statusBreakdown,
            timeSeries,
            topProduced,
            topConsumed,
            branchComparison,
            topOperators,
            recentOrders,
            catalog: { activeRecipes, producibleProducts }
        };
    }
}
