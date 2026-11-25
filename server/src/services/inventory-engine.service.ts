import type { Prisma } from '@prisma/client';
import { CostingService } from './costing.service';
import { resolveEffectiveUnitCost } from '../utils/product-cost';

/**
 * Single inventory engine (#5). Centralizes the stock + movement + FIFO-batch
 * mutation that every inventory flow (manual movements, transfers, order
 * consumption, waste, catering, purchase receipt, production) previously
 * duplicated.
 *
 * Design goals:
 *  - Preserve the OBSERVABLE WEIGHTED_AVERAGE behavior (quantities, unitCost,
 *    totalCost, balanceQty, balanceCost) of the legacy per-service code.
 *  - Add real per-(warehouse, product) FIFO cost layers (#3): every IN opens an
 *    `InventoryBatch`; every OUT consumes layers oldest-first to derive the COGS.
 *  - Run entirely inside the caller's transaction so stock, movement and batch
 *    writes commit/rollback atomically.
 */

type Tx = Prisma.TransactionClient;

export type InventoryMovementType = 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER';
export type BatchSourceType = 'PURCHASE' | 'PRODUCTION' | 'ADJUSTMENT' | 'TRANSFER' | 'OPENING';

export interface ApplyMovementParams {
    type: InventoryMovementType;
    companyId: number;
    warehouseId: number;
    productId: number;
    userId: number;
    /** ALWAYS in the product base unit and ALWAYS positive. */
    quantity: number;
    /**
     * Explicit unit cost (already in base unit). For IN / positive ADJUSTMENT it
     * values the entry (purchase = costPerBase, production = realUnitCost). For
     * OUT it forces a bespoke valuation the engine would otherwise derive itself.
     * When omitted: IN falls back to currentAverageCost; OUT is valued by FIFO
     * (when the company is FIFO) or by CostingService.getOutflowUnitCost.
     */
    unitCost?: number;
    reason?: string;
    reference?: string;
    originalQuantity?: number | null;
    originalUnit?: string | null;
    conversionFactor?: number | null;
    /** Batch source label for the opened FIFO layer (IN side only). */
    sourceType?: BatchSourceType;
    /**
     * For an exact reversal, consume only the still-open layer(s) created by
     * this source reference. If those layers no longer contain the requested
     * quantity, reject instead of consuming unrelated stock.
     */
    consumeSourceRef?: string;
    /** Restrict an exact reversal to layers opened by one inbound movement. */
    consumeSourceMovementId?: number;
    transferGroupId?: string | null;
    origin?: 'MANUAL' | 'WASTE' | 'TRANSFER' | 'REVERSAL';
    reversalOfId?: number;
    reversalGroupId?: string;
    reversalKey?: string;
    /** Allow the resulting balance to go negative (skip the OUT stock check). */
    allowNegative?: boolean;
    /**
     * Inbound/outbound direction. Derived from `type` by default (IN/ADJUSTMENT ->
     * IN, OUT -> OUT). REQUIRED for TRANSFER, which is posted as two movements: an
     * OUT in the source warehouse and an IN in the destination, sharing one
     * transferGroupId. Pass 'OUT' to model a negative ADJUSTMENT.
     */
    direction?: 'IN' | 'OUT';
    /** Optional product name to enrich the insufficient-stock error message. */
    productName?: string;
    /** FIFO portions to recreate on an inbound transfer without averaging layers. */
    inboundLayers?: Array<{
        quantity: number;
        unitCost: number;
        sourceRef?: string | null;
        sourceType?: BatchSourceType;
        createdAt?: Date;
    }>;
    /** Value an exact OUT reversal from the consumed source layers on every costing method. */
    valueFromConsumedLayers?: boolean;
}

export interface ApplyMovementResult {
    movementId: number;
    unitCost: number;
    totalCost: number;
    balanceQty: number;
    balanceCost: number;
    consumedLayers?: Array<{
        quantity: number;
        unitCost: number;
        sourceRef?: string | null;
        sourceType?: BatchSourceType;
        createdAt?: Date;
    }>;
}

const EPS = 1e-9;

export class InventoryEngineService {
    /** Resolve the inbound/outbound direction for a movement type. */
    private static resolveDirection(
        type: InventoryMovementType,
        direction?: 'IN' | 'OUT'
    ): 'IN' | 'OUT' {
        if (direction) return direction;
        if (type === 'OUT') return 'OUT';
        // IN / ADJUSTMENT default to inbound, mirroring the historical
        // "ADJUSTMENT adds" behavior of InventoryMovementService.create.
        if (type === 'TRANSFER') {
            throw new Error('TRANSFER requiere una dirección explícita (IN/OUT)');
        }
        return 'IN';
    }

    /**
     * Apply a single stock movement within `tx`. Performs: row lock -> re-read ->
     * quantity/validation -> costing -> FIFO batch maintenance -> stock update ->
     * InventoryMovement insert. Returns the valued result.
     */
    static async applyMovement(tx: Tx, params: ApplyMovementParams): Promise<ApplyMovementResult> {
        const { type, companyId, warehouseId, productId, userId } = params;
        const quantity = Number(params.quantity);
        if (!Number.isFinite(quantity) || !(quantity > 0)) {
            throw new Error('La cantidad del movimiento debe ser mayor a 0');
        }
        if (params.unitCost != null && (!Number.isFinite(Number(params.unitCost)) || Number(params.unitCost) < 0)) {
            throw new Error('El costo unitario del movimiento debe ser finito y mayor o igual a 0');
        }

        const direction = this.resolveDirection(type, params.direction);

        // The engine is a shared write boundary used by purchases, production,
        // transfers and waste. Validate both foreign resources here so a caller
        // cannot create or mutate a Stock row that mixes tenants.
        // Serialize movements with warehouse scope changes/deletion. Transfers
        // acquire both warehouse rows in deterministic order before entering the
        // engine, so re-locking one row here is safe and prevents TOCTOU scope
        // changes for every other inventory writer.
        await tx.$queryRaw`SELECT id FROM \`Warehouse\` WHERE id = ${warehouseId} AND companyId = ${companyId} FOR UPDATE`;
        // Product.currentAverageCost is company-wide while stock/layers are per
        // warehouse. Lock the product before touching any warehouse layer so two
        // concurrent FIFO movements in different warehouses cannot publish stale,
        // last-writer-wins averages. Multi-product callers must acquire product
        // locks in ascending id order (purchase/production flows do so).
        await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${productId} AND companyId = ${companyId} FOR UPDATE`;
        const [warehouse, product] = await Promise.all([
            tx.warehouse.findFirst({ where: { id: warehouseId, companyId }, select: { id: true } }),
            tx.product.findFirst({
                where: { id: productId, companyId },
                select: {
                    currentAverageCost: true,
                    averageCostKnown: true,
                    cost: true,
                    referenceCostKnown: true
                }
            })
        ]);
        if (!warehouse) throw new Error('Almacén no encontrado para la empresa');
        if (!product) throw new Error('Producto no encontrado para la empresa');

        // 1. Locate (or create) the Stock row, lock it FOR UPDATE and re-read the
        //    locked quantity — same serialization pattern as order.service.updateStatus.
        let stock = await tx.stock.findUnique({
            where: { warehouseId_productId: { warehouseId, productId } },
            select: { id: true, quantity: true }
        });
        if (!stock) {
            stock = await tx.stock.create({
                data: { warehouseId, productId, companyId, quantity: 0 },
                select: { id: true, quantity: true }
            });
        }
        await tx.$queryRaw`SELECT id FROM \`Stock\` WHERE id = ${stock.id} AND companyId = ${companyId} FOR UPDATE`;
        const lockedStock = await tx.stock.findUnique({
            where: { id: stock.id },
            select: { quantity: true }
        });
        const currentQty = Number(lockedStock?.quantity ?? stock.quantity);

        // Costing context: the product's moving-average cost (reference for the
        // valued balance and the IN fallback) and the company's costing method.
        const costResolution = resolveEffectiveUnitCost(
            product?.currentAverageCost,
            product?.cost,
            {
                averageCostKnown: product?.averageCostKnown,
                referenceCostKnown: product?.referenceCostKnown
            }
        );
        const avgCost = costResolution.value;

        const company = await tx.company.findUnique({
            where: { id: companyId },
            select: { costingMethod: true }
        });
        const isFifo = (company?.costingMethod || 'WEIGHTED_AVERAGE') === 'FIFO';

        if (direction === 'IN' && params.unitCost == null && !params.inboundLayers?.length && !costResolution.known) {
            throw new Error(
                `PRODUCT_COST_MISSING: el producto ${productId} no tiene costo promedio ni costo de referencia confirmado`
            );
        }
        if (direction === 'OUT' && !isFifo && params.unitCost == null && !costResolution.known) {
            throw new Error(
                `PRODUCT_COST_MISSING: el producto ${productId} no tiene costo promedio ni costo de referencia confirmado`
            );
        }

        // 2. New balance + OUT stock guard.
        const newQty = direction === 'IN' ? currentQty + quantity : currentQty - quantity;
        if (direction === 'OUT' && !params.allowNegative && newQty < -EPS) {
            throw new Error(
                `Stock insuficiente para ${params.productName ?? `el producto ${productId}`}. ` +
                `Requerido: ${quantity}, Disponible: ${currentQty}`
            );
        }

        // 3/4. Valuation + FIFO batch maintenance.
        // The "previously valued balance" per warehouse is the basis for the
        // accumulated balanceCost: qty * avg under WEIGHTED_AVERAGE, or the sum of
        // the remaining FIFO layers under FIFO.
        let unitCost: number;
        let totalCost: number;
        let balanceCost: number;
        const consumedLayers: NonNullable<ApplyMovementResult['consumedLayers']> = [];
        const openedBatchIds: number[] = [];

        if (direction === 'IN') {
            // Load layers only when needed to value the FIFO balance.
            const layerTotals = isFifo
                ? await this.remainingLayerTotals(tx, companyId, warehouseId, productId)
                : null;
            if (layerTotals && Math.abs(layerTotals.quantity - currentQty) > EPS) {
                throw new Error(
                    `Inventario FIFO inconsistente para el producto ${productId} en almacén ${warehouseId}: ` +
                    `stock ${currentQty}, capas ${layerTotals.quantity}. Reconcílie el inventario antes de continuar.`
                );
            }
            const prevValued = layerTotals ? layerTotals.value : currentQty * avgCost;

            if (params.inboundLayers?.length) {
                const layerQty = params.inboundLayers.reduce((sum, layer) => sum + layer.quantity, 0);
                if (Math.abs(layerQty - quantity) > EPS) {
                    throw new Error('Las capas de entrada no cuadran con la cantidad del movimiento');
                }
                const layerValue = params.inboundLayers.reduce((sum, layer) => sum + layer.quantity * layer.unitCost, 0);
                // A WA transfer/reversal can have FIFO provenance whose layer
                // value differs from its financial ledger value. Preserve both:
                // layers recreate provenance, explicit unitCost reconciles money.
                unitCost = params.unitCost != null ? Number(params.unitCost) : layerValue / quantity;
                totalCost = quantity * unitCost;
            } else {
                unitCost = params.unitCost != null ? Number(params.unitCost) : avgCost;
                totalCost = quantity * unitCost;
            }
            balanceCost = prevValued + totalCost;

            // Open a FIFO cost layer for this entry.
            const layersToCreate = params.inboundLayers ?? [{ quantity, unitCost, sourceRef: params.reference ?? null }];
            for (const layer of layersToCreate) {
                const opened = await tx.inventoryBatch.create({
                    data: {
                    companyId,
                    warehouseId,
                    productId,
                    unitCost: layer.unitCost,
                    originalQty: layer.quantity,
                    remainingQty: layer.quantity,
                    sourceType: params.sourceType ?? layer.sourceType ?? 'ADJUSTMENT',
                    sourceRef: layer.sourceRef ?? params.reference ?? null,
                    ...(layer.createdAt ? { createdAt: layer.createdAt } : {})
                    },
                    select: { id: true }
                });
                openedBatchIds.push(opened.id);
            }
        } else {
            // OUT: load the layers (oldest first), lock them, and consume them so
            // FIFO stays consistent regardless of the active costing method.
            const allLayers = await tx.inventoryBatch.findMany({
                where: { companyId, warehouseId, productId, remainingQty: { gt: 0 } },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                select: {
                    id: true,
                    unitCost: true,
                    remainingQty: true,
                    sourceRef: true,
                    sourceType: true,
                    sourceMovementId: true,
                    createdAt: true
                }
            });
            if (allLayers.length > 0) {
                // Lock the candidate layers to avoid concurrent double-consumption.
                await tx.$queryRaw`SELECT id FROM \`InventoryBatch\` WHERE companyId = ${companyId} AND warehouseId = ${warehouseId} AND productId = ${productId} AND remainingQty > 0 ORDER BY createdAt, id FOR UPDATE`;
            }
            const layers = params.consumeSourceMovementId != null
                ? allLayers.filter((layer) => layer.sourceMovementId === params.consumeSourceMovementId)
                : params.consumeSourceRef
                    ? allLayers.filter((layer) => layer.sourceRef === params.consumeSourceRef)
                    : allLayers;
            const allLayerQuantity = allLayers.reduce((sum, layer) => sum + Number(layer.remainingQty), 0);
            if (isFifo && Math.abs(allLayerQuantity - currentQty) > EPS) {
                throw new Error(
                    `Inventario FIFO inconsistente para el producto ${productId} en almacén ${warehouseId}: ` +
                    `stock ${currentQty}, capas ${allLayerQuantity}. Reconcílie el inventario antes de continuar.`
                );
            }
            const prevValued = isFifo
                ? allLayers.reduce((s, b) => s + Number(b.remainingQty) * Number(b.unitCost), 0)
                : currentQty * avgCost;

            let remaining = quantity;
            let fifoCogs = 0;
            for (const layer of layers) {
                if (remaining <= EPS) break;
                const available = Number(layer.remainingQty);
                const take = Math.min(available, remaining);
                if (take <= 0) continue;
                fifoCogs += take * Number(layer.unitCost);
                consumedLayers.push({
                    quantity: take,
                    unitCost: Number(layer.unitCost),
                    sourceRef: layer.sourceRef,
                    sourceType: layer.sourceType as BatchSourceType,
                    createdAt: layer.createdAt
                });
                remaining -= take;
                await tx.inventoryBatch.update({
                    where: { id: layer.id },
                    data: { remainingQty: available - take }
                });
            }
            // Exact reversals must never consume another purchase/production
            // layer. A shortfall means this output was already used.
            if (remaining > EPS && (params.consumeSourceRef || params.consumeSourceMovementId != null)) {
                throw new Error(
                    `No hay cantidad suficiente en las capas del movimiento ${params.consumeSourceMovementId ?? params.consumeSourceRef} para una reversa exacta. ` +
                    `Requerido: ${quantity}, Disponible en lote: ${quantity - remaining}`
                );
            }

            // Weighted-average tenants may still have legacy stock without layers.
            // FIFO is fail-closed: every unit must have explicit provenance.
            if (remaining > EPS) {
                if (isFifo) {
                    throw new Error(
                        `Capas FIFO insuficientes para el producto ${productId}. ` +
                        `Faltan ${remaining} unidades por reconciliar.`
                    );
                }
                fifoCogs += remaining * avgCost;
                consumedLayers.push({ quantity: remaining, unitCost: avgCost, sourceRef: null });
                remaining = 0;
            }

            if (params.unitCost != null) {
                // Bespoke valuation supplied by the caller (e.g. a reversal).
                unitCost = Number(params.unitCost);
                totalCost = quantity * unitCost;
            } else if (isFifo || params.valueFromConsumedLayers) {
                totalCost = fifoCogs;
                unitCost = quantity > 0 ? totalCost / quantity : 0;
            } else {
                // WEIGHTED_AVERAGE: keep using the shared outflow contract so the
                // numeric result is identical to the legacy per-service code.
                unitCost = await CostingService.getOutflowUnitCost(tx, productId, companyId);
                totalCost = quantity * unitCost;
            }
            balanceCost = prevValued - totalCost;
        }

        // 5/6. Persist the new stock balance and the movement record.
        await tx.stock.update({
            where: { id: stock.id },
            data: { quantity: newQty }
        });

        const movement = await tx.inventoryMovement.create({
            data: {
                companyId,
                warehouseId,
                productId,
                userId,
                type,
                transferGroupId: params.transferGroupId ?? null,
                direction,
                origin: params.origin ?? null,
                quantity,
                reason: params.reason ?? null,
                reference: params.reference ?? null,
                originalQuantity: params.originalQuantity ?? null,
                originalUnit: params.originalUnit ?? null,
                conversionFactor: params.conversionFactor ?? null,
                unitCost,
                totalCost,
                balanceQty: newQty,
                balanceCost,
                reversalOfId: params.reversalOfId ?? null,
                reversalGroupId: params.reversalGroupId ?? null,
                reversalKey: params.reversalKey ?? null,
                ...(direction === 'OUT' && consumedLayers.length > 0
                    ? {
                        consumedLayers: consumedLayers.map((layer) => ({
                            quantity: layer.quantity,
                            unitCost: layer.unitCost,
                            sourceRef: layer.sourceRef ?? null,
                            sourceType: layer.sourceType ?? 'ADJUSTMENT',
                            createdAt: layer.createdAt?.toISOString() ?? null
                        })) as Prisma.InputJsonValue
                    }
                    : {})
            },
            select: { id: true }
        });

        if (openedBatchIds.length > 0) {
            await tx.inventoryBatch.updateMany({
                where: { id: { in: openedBatchIds } },
                data: { sourceMovementId: movement.id }
            });
        }

        // FIFO display/recipe cost is the weighted average of remaining layers.
        // Refresh on OUT only: receipt/production IN paths recompute via
        // CostingService with a correct previousAvgCost snapshot. Syncing on IN
        // here would overwrite that snapshot before history is written.
        if (isFifo && direction === 'OUT') {
            await CostingService.syncFifoCurrentAverageCost(tx, productId, companyId);
        }

        return {
            movementId: movement.id,
            unitCost,
            totalCost,
            balanceQty: newQty,
            balanceCost,
            consumedLayers: direction === 'OUT' ? consumedLayers : undefined
        };
    }

    /** Sum the valued (remainingQty * unitCost) of the remaining FIFO layers. */
    private static async remainingLayerTotals(
        tx: Tx,
        companyId: number,
        warehouseId: number,
        productId: number
    ): Promise<{ quantity: number; value: number }> {
        const layers = await tx.inventoryBatch.findMany({
            where: { companyId, warehouseId, productId, remainingQty: { gt: 0 } },
            select: { unitCost: true, remainingQty: true }
        });
        return layers.reduce((totals, batch) => ({
            quantity: totals.quantity + Number(batch.remainingQty),
            value: totals.value + Number(batch.remainingQty) * Number(batch.unitCost)
        }), { quantity: 0, value: 0 });
    }
}
