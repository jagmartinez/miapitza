import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { effectiveUnitCost } from '../utils/product-cost';
import { SettingService } from './setting.service';
import { zonedDateKey } from '../utils/timezone';

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

type QuantityByUnit = { unit: string; quantity: number };

function addQuantity(target: Map<string, number>, unit: string, quantity: number): void {
    target.set(unit, (target.get(unit) || 0) + quantity);
}

function quantityRows(target: Map<string, number>): QuantityByUnit[] {
    return Array.from(target, ([unit, quantity]) => ({ unit, quantity: Math.round(quantity * 1_000_000) / 1_000_000 }))
        .sort((a, b) => a.unit.localeCompare(b.unit));
}

function homogeneousTotal(rows: QuantityByUnit[]): number | null {
    return rows.length <= 1 ? (rows[0]?.quantity ?? 0) : null;
}

type FinishedProductionMetrics = {
    planned: number;
    produced: number;
    estimatedCost: number;
    realCost: number;
};

function productionRef(order: { id?: unknown; code?: unknown }): string {
    if (typeof order.code === 'string' && order.code.trim()) return order.code;
    if (order.id != null) return `#${String(order.id)}`;
    return 'sin identificador';
}

function requireFiniteNonNegative(value: unknown, field: string, ref: string): number {
    if (value == null) {
        throw new Error(`Producción ${ref}: ${field} no tiene un valor histórico. Reconcílie la orden antes de emitir reportes.`);
    }
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) {
        throw new Error(`Producción ${ref}: ${field} es inválido. Reconcílie la orden antes de emitir reportes.`);
    }
    return numberValue;
}

function requireFinishedMetrics(order: {
    id?: unknown;
    code?: unknown;
    plannedQuantity: unknown;
    producedQuantity: unknown;
    estimatedCost: unknown;
    realCost: unknown;
    finishedAt?: unknown;
}): FinishedProductionMetrics {
    const ref = productionRef(order);
    const planned = requireFiniteNonNegative(order.plannedQuantity, 'cantidad planificada', ref);
    const produced = requireFiniteNonNegative(order.producedQuantity, 'cantidad producida', ref);
    const estimatedCost = requireFiniteNonNegative(order.estimatedCost, 'costo estimado', ref);
    const realCost = requireFiniteNonNegative(order.realCost, 'costo real', ref);
    if (planned <= 0 || produced <= 0) {
        throw new Error(
            `Producción ${ref}: una orden FINALIZADA debe tener cantidades planificada y producida mayores que cero. ` +
            'Reconcílie la orden antes de emitir reportes.'
        );
    }
    if (!(order.finishedAt instanceof Date) || Number.isNaN(order.finishedAt.getTime())) {
        throw new Error(`Producción ${ref}: una orden FINALIZADA no tiene fecha de finalización válida.`);
    }
    return { planned, produced, estimatedCost, realCost };
}

function requireConsumedItemMetrics(item: {
    id?: unknown;
    consumedQuantity: unknown;
    unitCost: unknown;
    totalCost: unknown;
}, orderRef: string): { consumed: number; unitCost: number; totalCost: number } {
    const itemRef = item.id != null ? `, insumo #${String(item.id)}` : '';
    const consumed = requireFiniteNonNegative(item.consumedQuantity, `cantidad consumida${itemRef}`, orderRef);
    const unitCost = requireFiniteNonNegative(item.unitCost, `costo unitario${itemRef}`, orderRef);
    const totalCost = requireFiniteNonNegative(item.totalCost, `costo total${itemRef}`, orderRef);
    const expectedTotal = consumed * unitCost;
    const tolerance = Math.max(0.01, Math.abs(totalCost) * 0.000001);
    if (Math.abs(expectedTotal - totalCost) > tolerance) {
        throw new Error(
            `Producción ${orderRef}${itemRef}: el costo total no coincide con cantidad por costo unitario. ` +
            'Reconcílie la orden antes de emitir reportes.'
        );
    }
    return { consumed, unitCost, totalCost };
}

export class ProductionReportService {
    /** Producciones realizadas: listado + resumen por periodo. */
    static async getProductions(companyId: number, filters: BaseFilters) {
        const where: Prisma.ProductionOrderWhereInput = { companyId };
        if (filters.branchId) where.branchId = filters.branchId;
        if (filters.productId) where.productId = filters.productId;
        if (filters.status) {
            const allowed = new Set(['DRAFT', 'PENDING', 'IN_PROGRESS', 'FINISHED', 'CANCELLED']);
            if (!allowed.has(filters.status)) throw new Error('Estado de producción no válido');
            where.status = filters.status as Prisma.EnumProductionOrderStatusFilter['equals'];
        }
        const dw = dateWhere(filters);
        if (dw) where.date = dw;

        const orders = await prisma.productionOrder.findMany({
            where,
            include: {
                product: {
                    select: {
                        id: true, name: true, sku: true, type: true, unit: true,
                        baseUnit: { select: { abbreviation: true } }
                    }
                },
                warehouse: { select: { id: true, name: true } },
                user: { select: { id: true, name: true } }
            },
            orderBy: { date: 'desc' }
        });

        const plannedByUnit = new Map<string, number>();
        const producedByUnit = new Map<string, number>();
        const summary = orders.reduce(
            (acc, o) => {
                acc.count += 1;
                if (o.status === 'FINISHED') acc.finished += 1;
                if (o.status === 'CANCELLED') acc.cancelled += 1;
                // Cancelled orders have already been physically reversed. They
                // remain in the count/audit trail but cannot inflate quantities or
                // costs. Realized values only come from FINISHED orders.
                if (o.status !== 'CANCELLED') {
                    addQuantity(plannedByUnit, o.product.baseUnit?.abbreviation || o.product.unit, Number(o.plannedQuantity));
                    acc.totalEstimatedCost += Number(o.estimatedCost);
                }
                if (o.status === 'FINISHED') {
                    const metrics = requireFinishedMetrics(o);
                    addQuantity(producedByUnit, o.product.baseUnit?.abbreviation || o.product.unit, metrics.produced);
                    acc.totalRealCost += metrics.realCost;
                }
                return acc;
            },
            { count: 0, finished: 0, cancelled: 0, totalEstimatedCost: 0, totalRealCost: 0 }
        );

        const plannedQuantities = quantityRows(plannedByUnit);
        const producedQuantities = quantityRows(producedByUnit);

        return {
            summary: {
                ...summary,
                totalPlanned: homogeneousTotal(plannedQuantities),
                totalProduced: homogeneousTotal(producedQuantities),
                plannedQuantities,
                producedQuantities,
                mixedOutputUnits: plannedQuantities.length > 1 || producedQuantities.length > 1
            },
            items: orders
        };
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
                items: {
                    include: {
                        componentProduct: {
                            select: {
                                id: true, name: true, sku: true, type: true, unit: true,
                                baseUnit: { select: { abbreviation: true } }
                            }
                        }
                    }
                }
            }
        });

        const byComponent = new Map<number, { componentProductId: number; name: string; sku: string | null; unit: string; consumedQuantity: number; totalCost: number; orders: number }>();
        for (const o of orders) {
            requireFinishedMetrics(o);
            const ref = productionRef(o);
            for (const it of o.items) {
                const { consumed, totalCost } = requireConsumedItemMetrics(it, ref);
                if (consumed <= 0) continue;
                const key = it.componentProductId;
                const prev = byComponent.get(key) || {
                    componentProductId: key,
                    name: it.componentProduct.name,
                    sku: it.componentProduct.sku,
                    unit: it.unit || it.componentProduct.baseUnit?.abbreviation || it.componentProduct.unit,
                    consumedQuantity: 0,
                    totalCost: 0,
                    orders: 0
                };
                prev.consumedQuantity += consumed;
                prev.totalCost += totalCost;
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
            include: {
                product: {
                    select: {
                        id: true, name: true, sku: true, unit: true,
                        baseUnit: { select: { abbreviation: true } }
                    }
                }
            },
            orderBy: { finishedAt: 'desc' }
        });

        const items = orders.map((o) => {
            const { planned, produced, estimatedCost, realCost } = requireFinishedMetrics(o);
            const qtyDiff = produced - planned;
            const yieldPct = (produced / planned) * 100;
            const estimatedUnitCost = requireFiniteNonNegative(o.estimatedUnitCost, 'costo unitario estimado', productionRef(o));
            const realUnitCost = requireFiniteNonNegative(o.realUnitCost, 'costo unitario real', productionRef(o));
            return {
                id: o.id,
                code: o.code,
                product: o.product,
                unit: o.product.baseUnit?.abbreviation || o.product.unit,
                finishedAt: o.finishedAt,
                plannedQuantity: planned,
                producedQuantity: produced,
                quantityDiff: qtyDiff,
                yieldPct: Math.round(yieldPct * 100) / 100,
                estimatedCost,
                realCost,
                costVariance: realCost - estimatedCost,
                estimatedUnitCost,
                realUnitCost
            };
        });

        const plannedByUnit = new Map<string, number>();
        const producedByUnit = new Map<string, number>();
        const summary = items.reduce(
            (acc, i) => {
                acc.count += 1;
                addQuantity(plannedByUnit, i.unit, i.plannedQuantity);
                addQuantity(producedByUnit, i.unit, i.producedQuantity);
                acc.totalCostVariance += i.costVariance;
                acc.yieldPctSum += i.yieldPct;
                return acc;
            },
            { count: 0, totalCostVariance: 0, avgYieldPct: 0, yieldPctSum: 0 }
        );
        summary.avgYieldPct = summary.count > 0 ? Math.round((summary.yieldPctSum / summary.count) * 100) / 100 : 0;
        const plannedQuantities = quantityRows(plannedByUnit);
        const producedQuantities = quantityRows(producedByUnit);

        return {
            summary: {
                count: summary.count,
                totalCostVariance: summary.totalCostVariance,
                avgYieldPct: summary.avgYieldPct,
                totalPlanned: homogeneousTotal(plannedQuantities),
                totalProduced: homogeneousTotal(producedQuantities),
                plannedQuantities,
                producedQuantities,
                mixedOutputUnits: plannedQuantities.length > 1 || producedQuantities.length > 1
            },
            items
        };
    }

    /** Kardex de productos producidos: movimientos con referencia PROD-*. */
    static async getProducedKardex(companyId: number, filters: BaseFilters & { warehouseId?: number }) {
        const where: Prisma.InventoryMovementWhereInput = {
            companyId,
            reference: { startsWith: 'PROD-' }
        };
        if (filters.productId) where.productId = filters.productId;
        if (filters.warehouseId) where.warehouseId = filters.warehouseId;
        if (filters.branchId) where.warehouse = { OR: [{ branchId: filters.branchId }, { branchId: null }] };
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
        const productionOrderIds = [...new Set(movements.flatMap((movement) => {
            const match = movement.reference?.match(/^PROD-(\d+)$/);
            return match ? [Number(match[1])] : [];
        }))];
        const sourceOrders = productionOrderIds.length > 0
            ? await prisma.productionOrder.findMany({
                where: { companyId, id: { in: productionOrderIds } },
                select: { id: true, productId: true }
            })
            : [];
        const outputByOrder = new Map(sourceOrders.map((order) => [order.id, order.productId]));

        // References PROD-N are shared by input consumption, output creation and
        // cancellation. This endpoint is specifically the produced-product
        // kardex, so retain only movements whose product is that order's output.
        const items = movements.filter((movement) => {
            const match = movement.reference?.match(/^PROD-(\d+)$/);
            return !!match && outputByOrder.get(Number(match[1])) === movement.productId;
        });
        return { items };
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

        const sourceOrderIds = [...new Set(order.items.flatMap((item) => {
            if (!Array.isArray(item.consumedLayers)) return [];
            return item.consumedLayers.flatMap((raw) => {
                const sourceRef = (raw as Record<string, unknown>).sourceRef;
                const match = typeof sourceRef === 'string' ? sourceRef.match(/^PROD-(\d+)$/) : null;
                return match ? [Number(match[1])] : [];
            });
        }))];
        const sourceProductions = sourceOrderIds.length > 0
            ? await prisma.productionOrder.findMany({
                where: { companyId, id: { in: sourceOrderIds } },
                select: { id: true, code: true, productId: true, producedQuantity: true, realUnitCost: true, finishedAt: true }
            })
            : [];
        const sourceById = new Map(sourceProductions.map((source) => [source.id, source]));

        const inputs = order.items.map((it) => {
                const itemSourceIds = Array.isArray(it.consumedLayers)
                    ? it.consumedLayers.flatMap((raw) => {
                        const sourceRef = (raw as Record<string, unknown>).sourceRef;
                        const match = typeof sourceRef === 'string' ? sourceRef.match(/^PROD-(\d+)$/) : null;
                        return match ? [Number(match[1])] : [];
                    })
                    : [];
                const subOrders = [...new Set(itemSourceIds)]
                    .map((sourceId) => sourceById.get(sourceId))
                    .filter((source): source is NonNullable<typeof source> =>
                        !!source && source.productId === it.componentProductId
                    );
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
            });

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
                const cost = effectiveUnitCost(p.currentAverageCost, p.cost);
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
        const timeZone = await SettingService.getTimezone(companyId);
        const orderWhere: Prisma.ProductionOrderWhereInput = { companyId };
        if (filters.branchId) orderWhere.branchId = filters.branchId;
        const dw = dateWhere(filters);
        if (dw) orderWhere.date = dw;

        const orderInclude = {
            product: { select: { id: true, name: true, sku: true, type: true, unit: true, baseUnit: { select: { abbreviation: true } } } },
            warehouse: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
            user: { select: { id: true, name: true } },
            items: {
                include: {
                    componentProduct: {
                        select: { id: true, name: true, sku: true, unit: true, type: true, baseUnit: { select: { abbreviation: true } } }
                    },
                    unitOfMeasure: { select: { abbreviation: true } }
                }
            }
        } satisfies Prisma.ProductionOrderInclude;

        // Planned/order-state metrics follow the scheduled date. Realized metrics
        // follow finishedAt and only include FINISHED orders. Keeping both cohorts
        // separate prevents cancellations and cross-period completions from
        // contaminating actual production and cost figures.
        const orders = await prisma.productionOrder.findMany({
            where: orderWhere,
            include: orderInclude,
            orderBy: { date: 'desc' }
        });

        const finishedWhere: Prisma.ProductionOrderWhereInput = { companyId, status: 'FINISHED' };
        if (filters.branchId) finishedWhere.branchId = filters.branchId;
        if (dw) finishedWhere.finishedAt = dw;
        const finishedOrders = await prisma.productionOrder.findMany({
            where: finishedWhere,
            include: orderInclude,
            orderBy: { finishedAt: 'desc' }
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

        const dayMap = new Map<string, { date: string; orders: number; realCost: number; estimatedCost: number }>();
        const producedMap = new Map<number, { productId: number; name: string; sku: string | null; type: string; unit: string; orders: number; produced: number; planned: number; realCost: number; estimatedCost: number }>();
        const inputMap = new Map<number, { componentProductId: number; name: string; sku: string | null; unit: string; consumedQuantity: number; totalCost: number }>();
        const branchMap = new Map<number, { branchId: number; name: string; orders: number; realCost: number }>();
        const operatorMap = new Map<number, { userId: number; name: string; orders: number; realCost: number }>();
        const plannedByUnit = new Map<string, number>();
        const producedByUnit = new Map<string, number>();

        let yieldPctSum = 0;
        let yieldOrderCount = 0;

        for (const o of orders) {
            kpis.total += 1;

            switch (o.status) {
                case 'DRAFT': kpis.draft += 1; break;
                case 'PENDING': kpis.pending += 1; break;
                case 'IN_PROGRESS': kpis.inProgress += 1; break;
                case 'FINISHED': kpis.finished += 1; break;
                case 'CANCELLED': kpis.cancelled += 1; break;
            }

        }

        for (const o of finishedOrders) {
                const metrics = requireFinishedMetrics(o);
                const outputUnit = o.product.baseUnit?.abbreviation || o.product.unit;
                addQuantity(plannedByUnit, outputUnit, metrics.planned);
                addQuantity(producedByUnit, outputUnit, metrics.produced);
                kpis.totalEstimatedCost += metrics.estimatedCost;
                kpis.totalRealCost += metrics.realCost;
                yieldPctSum += (metrics.produced / metrics.planned) * 100;
                yieldOrderCount += 1;

                const key = zonedDateKey(o.finishedAt as Date, timeZone);
                const day = dayMap.get(key) || { date: key, orders: 0, realCost: 0, estimatedCost: 0 };
                day.orders += 1;
                day.realCost += metrics.realCost;
                day.estimatedCost += metrics.estimatedCost;
                dayMap.set(key, day);

                const pp = producedMap.get(o.productId) || {
                    productId: o.productId,
                    name: o.product.name,
                    sku: o.product.sku,
                    type: o.product.type,
                    unit: o.product.baseUnit?.abbreviation || o.product.unit,
                    orders: 0,
                    produced: 0,
                    planned: 0,
                    realCost: 0,
                    estimatedCost: 0
                };
                pp.orders += 1;
                pp.produced += metrics.produced;
                pp.planned += metrics.planned;
                pp.realCost += metrics.realCost;
                pp.estimatedCost += metrics.estimatedCost;
                producedMap.set(o.productId, pp);

                const bp = branchMap.get(o.branchId) || {
                    branchId: o.branchId,
                    name: o.branch?.name ?? ('Sucursal ' + o.branchId),
                    orders: 0,
                    realCost: 0
                };
                bp.orders += 1;
                bp.realCost += metrics.realCost;
                branchMap.set(o.branchId, bp);

                if (o.userId != null && o.user) {
                    const op = operatorMap.get(o.userId) || {
                        userId: o.userId,
                        name: o.user.name,
                        orders: 0,
                        realCost: 0
                    };
                    op.orders += 1;
                    op.realCost += metrics.realCost;
                    operatorMap.set(o.userId, op);
                }

                for (const it of o.items) {
                    const { consumed, totalCost } = requireConsumedItemMetrics(it, productionRef(o));
                    if (consumed <= 0) continue;
                    const ip = inputMap.get(it.componentProductId) || {
                        componentProductId: it.componentProductId,
                        name: it.componentProduct.name,
                        sku: it.componentProduct.sku,
                        unit: it.unitOfMeasure?.abbreviation || it.unit || it.componentProduct.baseUnit?.abbreviation || it.componentProduct.unit,
                        consumedQuantity: 0,
                        totalCost: 0
                    };
                    ip.consumedQuantity += consumed;
                    ip.totalCost += totalCost;
                    inputMap.set(it.componentProductId, ip);
                }
        }

        kpis.costVariance = Math.round((kpis.totalRealCost - kpis.totalEstimatedCost) * 100) / 100;
        kpis.avgYieldPct = yieldOrderCount > 0 ? Math.round((yieldPctSum / yieldOrderCount) * 100) / 100 : 0;

        const activeOrders = kpis.draft + kpis.pending + kpis.inProgress;
        const completionRate = kpis.total > 0 ? Math.round((kpis.finished / kpis.total) * 10000) / 100 : 0;
        const cancelRate = kpis.total > 0 ? Math.round((kpis.cancelled / kpis.total) * 10000) / 100 : 0;
        const avgRealOrderCost = finishedOrders.length > 0 ? Math.round((kpis.totalRealCost / finishedOrders.length) * 100) / 100 : 0;
        const costVariancePct = kpis.totalEstimatedCost > 0 ? Math.round((kpis.costVariance / kpis.totalEstimatedCost) * 10000) / 100 : 0;

        const plannedQuantities = quantityRows(plannedByUnit);
        const producedQuantities = quantityRows(producedByUnit);
        const kpisExtended = {
            ...kpis,
            totalPlanned: homogeneousTotal(plannedQuantities),
            totalProduced: homogeneousTotal(producedQuantities),
            plannedQuantities,
            producedQuantities,
            mixedOutputUnits: plannedQuantities.length > 1 || producedQuantities.length > 1,
            activeOrders,
            completionRate,
            cancelRate,
            realizedOrders: finishedOrders.length,
            avgRealOrderCost,
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
                unit: p.unit,
                orders: p.orders,
                produced: p.produced,
                realCost: p.realCost,
                estimatedCost: p.estimatedCost,
                costVariance: Math.round((p.realCost - p.estimatedCost) * 100) / 100,
                yieldPct: p.planned > 0 ? Math.round((p.produced / p.planned) * 10000) / 100 : 0
            }));
        const topConsumed = Array.from(inputMap.values()).sort((a, b) => b.totalCost - a.totalCost).slice(0, 8);

        const branchComparison = Array.from(branchMap.values())
            .sort((a, b) => b.realCost - a.realCost)
            .map((b) => ({
                branchId: b.branchId,
                name: b.name,
                orders: b.orders,
                realCost: b.realCost
            }));

        const topOperators = Array.from(operatorMap.values())
            .sort((a, b) => b.orders - a.orders || b.realCost - a.realCost)
            .slice(0, 8)
            .map((o) => ({
                userId: o.userId,
                name: o.name,
                orders: o.orders,
                realCost: o.realCost
            }));

        let previous: {
            total: number;
            finished: number;
            totalProduced: number | null;
            producedQuantities: QuantityByUnit[];
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

            const [prevOrders, prevFinishedOrders] = await Promise.all([prisma.productionOrder.findMany({
                where: prevWhere,
                select: { status: true }
            }), prisma.productionOrder.findMany({
                where: { companyId, ...(filters.branchId ? { branchId: filters.branchId } : {}), status: 'FINISHED', finishedAt: { gte: prevFrom, lte: prevTo } },
                select: {
                    id: true,
                    code: true,
                    plannedQuantity: true,
                    producedQuantity: true,
                    estimatedCost: true,
                    realCost: true,
                    finishedAt: true,
                    product: { select: { unit: true, baseUnit: { select: { abbreviation: true } } } }
                }
            })]);

            const prevAgg = prevOrders.reduce(
                (acc, o) => {
                    acc.total += 1;
                    if (o.status === 'FINISHED') {
                        acc.finished += 1;
                    }
                    return acc;
                },
                { total: 0, finished: 0, totalProduced: 0, totalEstimatedCost: 0, totalRealCost: 0, finishedPlanned: 0, finishedProduced: 0 }
            );
            let previousYieldPctSum = 0;
            let previousYieldOrderCount = 0;
            const previousProducedByUnit = new Map<string, number>();
            for (const o of prevFinishedOrders) {
                const metrics = requireFinishedMetrics(o);
                addQuantity(
                    previousProducedByUnit,
                    o.product.baseUnit?.abbreviation || o.product.unit,
                    metrics.produced
                );
                prevAgg.totalEstimatedCost += metrics.estimatedCost;
                prevAgg.totalRealCost += metrics.realCost;
                previousYieldPctSum += (metrics.produced / metrics.planned) * 100;
                previousYieldOrderCount += 1;
            }
            const previousProducedQuantities = quantityRows(previousProducedByUnit);

            previous = {
                total: prevAgg.total,
                finished: prevAgg.finished,
                totalProduced: homogeneousTotal(previousProducedQuantities),
                producedQuantities: previousProducedQuantities,
                totalRealCost: prevAgg.totalRealCost,
                costVariance: Math.round((prevAgg.totalRealCost - prevAgg.totalEstimatedCost) * 100) / 100,
                avgYieldPct: previousYieldOrderCount > 0 ? Math.round((previousYieldPctSum / previousYieldOrderCount) * 100) / 100 : 0
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
