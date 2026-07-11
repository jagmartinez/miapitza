import type { Prisma } from '@prisma/client';
import { CostingService } from './costing.service';

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
    transferGroupId?: string | null;
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
}

export interface ApplyMovementResult {
    movementId: number;
    unitCost: number;
    totalCost: number;
    balanceQty: number;
    balanceCost: number;
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
        if (!(quantity > 0)) {
            throw new Error('La cantidad del movimiento debe ser mayor a 0');
        }

        const direction = this.resolveDirection(type, params.direction);

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
        const product = await tx.product.findFirst({
            where: { id: productId, companyId },
            select: { currentAverageCost: true, cost: true }
        });
        const avgCost = Number(product?.currentAverageCost || product?.cost || 0);

        const company = await tx.company.findUnique({
            where: { id: companyId },
            select: { costingMethod: true }
        });
        const isFifo = (company?.costingMethod || 'WEIGHTED_AVERAGE') === 'FIFO';

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

        if (direction === 'IN') {
            // Load layers only when needed to value the FIFO balance.
            const prevValued = isFifo
                ? await this.sumRemainingLayers(tx, companyId, warehouseId, productId)
                : currentQty * avgCost;

            unitCost = params.unitCost != null ? Number(params.unitCost) : avgCost;
            totalCost = quantity * unitCost;
            balanceCost = prevValued + totalCost;

            // Open a FIFO cost layer for this entry.
            await tx.inventoryBatch.create({
                data: {
                    companyId,
                    warehouseId,
                    productId,
                    unitCost,
                    originalQty: quantity,
                    remainingQty: quantity,
                    sourceType: params.sourceType ?? 'ADJUSTMENT',
                    sourceRef: params.reference ?? null
                }
            });
        } else {
            // OUT: load the layers (oldest first), lock them, and consume them so
            // FIFO stays consistent regardless of the active costing method.
            const allLayers = await tx.inventoryBatch.findMany({
                where: { companyId, warehouseId, productId, remainingQty: { gt: 0 } },
                orderBy: { createdAt: 'asc' },
                select: { id: true, unitCost: true, remainingQty: true, sourceRef: true }
            });
            if (allLayers.length > 0) {
                // Lock the candidate layers to avoid concurrent double-consumption.
                await tx.$queryRaw`SELECT id FROM \`InventoryBatch\` WHERE companyId = ${companyId} AND warehouseId = ${warehouseId} AND productId = ${productId} AND remainingQty > 0 FOR UPDATE`;
            }
            const layers = params.consumeSourceRef
                ? allLayers.filter((layer) => layer.sourceRef === params.consumeSourceRef)
                : allLayers;
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
                remaining -= take;
                await tx.inventoryBatch.update({
                    where: { id: layer.id },
                    data: { remainingQty: available - take }
                });
            }
            // Exact reversals must never consume another purchase/production
            // layer. A shortfall means this output was already used.
            if (remaining > EPS && params.consumeSourceRef) {
                throw new Error(
                    `No hay cantidad suficiente en el lote ${params.consumeSourceRef} para una reversa exacta. ` +
                    `Requerido: ${quantity}, Disponible en lote: ${quantity - remaining}`
                );
            }

            // Graceful degradation for ordinary legacy stock without layers.
            if (remaining > EPS) {
                fifoCogs += remaining * avgCost;
                remaining = 0;
            }

            if (params.unitCost != null) {
                // Bespoke valuation supplied by the caller (e.g. a reversal).
                unitCost = Number(params.unitCost);
                totalCost = quantity * unitCost;
            } else if (isFifo) {
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
                quantity,
                reason: params.reason ?? null,
                reference: params.reference ?? null,
                originalQuantity: params.originalQuantity ?? null,
                originalUnit: params.originalUnit ?? null,
                conversionFactor: params.conversionFactor ?? null,
                unitCost,
                totalCost,
                balanceQty: newQty,
                balanceCost
            },
            select: { id: true }
        });

        return {
            movementId: movement.id,
            unitCost,
            totalCost,
            balanceQty: newQty,
            balanceCost
        };
    }

    /** Sum the valued (remainingQty * unitCost) of the remaining FIFO layers. */
    private static async sumRemainingLayers(
        tx: Tx,
        companyId: number,
        warehouseId: number,
        productId: number
    ): Promise<number> {
        const layers = await tx.inventoryBatch.findMany({
            where: { companyId, warehouseId, productId, remainingQty: { gt: 0 } },
            select: { unitCost: true, remainingQty: true }
        });
        return layers.reduce((s, b) => s + Number(b.remainingQty) * Number(b.unitCost), 0);
    }
}
