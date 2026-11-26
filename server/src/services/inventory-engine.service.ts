import { Prisma } from '@prisma/client';
import { CostingService } from './costing.service';
import { resolveEffectiveUnitCost } from '../utils/product-cost';
import { ProductionRecipeService } from './production-recipe.service';

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
    /**
     * IN only: value restored ABOVE this movement's totalCost (layers re-valued
     * at the real cost that trued up a covered negative balance). Posted as a
     * separate COST_TRUE_UP row (positive = COGS reduction) so the movement
     * itself keeps the value it reverses. Requires a non-negative balance.
     */
    restoredValueAdjustment?: number;
    /**
     * IN only (sale returns): open deficit slices of the returned sale that
     * this inbound takes OUT of the deficit queue (consumed first, quantity
     * reduced, not marked as covered). The caller places their provisional
     * layers at the tail of `inboundLayers` so the trimmed value matches.
     */
    returnedOpenSlices?: Array<{ id: number; quantity: number }>;
    /**
     * OUT only (inbound reversals): when this movement re-creates a deficit,
     * re-open the slices those inbound movements had covered (LIFO) instead
     * of appending a new slice.
     */
    reopenCoveredByMovementIds?: number[];
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
    /**
     * Cost true-up posted when this inbound covered a negative (unbacked)
     * balance whose provisional valuation differed from the inbound cost.
     */
    costTrueUp?: { movementId: number; amount: number; coveredQty: number };
}

const EPS = 1e-9;
/** Smallest cost difference representable in Decimal(18, 6). */
const COST_EPS = 0.0000005;
/** Movement origin of the zero-quantity cost true-up rows (see applyMovement). */
export const COST_TRUE_UP_ORIGIN = 'COST_TRUE_UP';
/**
 * Reason prefix of the true-up rows that price units sold on a negative balance
 * at their real covering cost. Those rows carry that real unit cost in
 * `unitCost` (quantity stays 0) so a later return of such a sale can restore
 * the units at the cost they were actually charged at.
 */
export const COST_TRUE_UP_COVERAGE_REASON = 'Ajuste de costo por cobertura de saldo negativo';

/** One row of the deficit-slice ledger (see InventoryDeficitSlice). */
export type DeficitSliceRow = {
    id: number;
    saleMovementId: number | null;
    quantity: number;
    provisionalUnitCost: number;
    coveringMovementId: number | null;
    coveredValue: number;
};

type SliceCoveragePlan = {
    companyId: number;
    warehouseId: number;
    productId: number;
    takes: Array<{ row: DeficitSliceRow; take: number; returned: boolean }>;
    provisionalValue: number;
    returnedQty: number;
    returnedValue: number;
};

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
     * Canonical lock order for every inventory writer:
     *   Warehouse (ascending id) -> Product (ascending id) -> Stock (engine).
     * Multi-product / multi-warehouse callers must call this BEFORE their first
     * applyMovement so that later per-movement re-locks are no-ops and no flow
     * can hold a Product lock while waiting on a Warehouse lock.
     */
    static async lockInventoryScope(
        tx: Tx,
        companyId: number,
        warehouseIds: Iterable<number>,
        productIds: Iterable<number>,
        warehouseMode: 'SHARE' | 'UPDATE' = 'SHARE'
    ): Promise<void> {
        const sortedWarehouses = [...new Set(warehouseIds)].sort((a, b) => a - b);
        for (const warehouseId of sortedWarehouses) {
            if (warehouseMode === 'UPDATE') {
                await tx.$queryRaw`SELECT id FROM \`Warehouse\` WHERE id = ${warehouseId} AND companyId = ${companyId} FOR UPDATE`;
            } else {
                await tx.$queryRaw`SELECT id FROM \`Warehouse\` WHERE id = ${warehouseId} AND companyId = ${companyId} LOCK IN SHARE MODE`;
            }
        }
        const sortedProducts = [...new Set(productIds)].sort((a, b) => a - b);
        for (const productId of sortedProducts) {
            await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${productId} AND companyId = ${companyId} FOR UPDATE`;
        }
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
        // FOR SHARE is enough to block warehouse scope changes/deletion (which
        // take FOR UPDATE) while letting movements of different products in the
        // same warehouse proceed concurrently; per-product correctness comes from
        // the Product and Stock row locks below. Callers that already hold the
        // row FOR UPDATE keep their exclusive lock.
        //
        // Every value that is later written back ABSOLUTELY (stock quantity,
        // negative-balance cost, layer remainingQty) or that drives the
        // valuation (costing method, average cost) is taken from the LOCKING
        // reads themselves. Under REPEATABLE READ a plain read after a lock
        // returns the transaction snapshot (taken at its first non-locking
        // read), so two concurrent movements could otherwise lose an update.
        const warehouseRows = await tx.$queryRaw<Array<{ id: number; costingMethod?: string | null }>>`SELECT id, costingMethod FROM \`Warehouse\` WHERE id = ${warehouseId} AND companyId = ${companyId} LOCK IN SHARE MODE`;
        // Product.currentAverageCost is company-wide while stock/layers are per
        // warehouse. Lock the product before touching any warehouse layer so two
        // concurrent FIFO movements in different warehouses cannot publish stale,
        // last-writer-wins averages. Multi-product callers must acquire product
        // locks in ascending id order (purchase/production flows do so).
        const productRows = await tx.$queryRaw<Array<{
            id: number;
            currentAverageCost: unknown;
            averageCostKnown: unknown;
            cost: unknown;
            referenceCostKnown: unknown;
        }>>`SELECT id, currentAverageCost, averageCostKnown, cost, referenceCostKnown FROM \`Product\` WHERE id = ${productId} AND companyId = ${companyId} FOR UPDATE`;
        const lockedWarehouse = Array.isArray(warehouseRows) ? warehouseRows[0] : undefined;
        const lockedProduct = Array.isArray(productRows) ? productRows[0] : undefined;
        // Test doubles (and only they) return no rows: fall back to plain reads.
        const [warehouse, product] = await Promise.all([
            lockedWarehouse
                ? Promise.resolve({ id: lockedWarehouse.id })
                : tx.warehouse.findFirst({ where: { id: warehouseId, companyId }, select: { id: true } }),
            lockedProduct
                ? Promise.resolve({
                    currentAverageCost: lockedProduct.currentAverageCost as Prisma.Decimal | number | null,
                    averageCostKnown: this.sqlBoolean(lockedProduct.averageCostKnown),
                    cost: lockedProduct.cost as Prisma.Decimal | number | null,
                    referenceCostKnown: this.sqlBoolean(lockedProduct.referenceCostKnown)
                })
                : tx.product.findFirst({
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
        const stockRows = await tx.$queryRaw<Array<{ quantity: unknown; negativeBalanceCost: unknown }>>`SELECT quantity, negativeBalanceCost FROM \`Stock\` WHERE id = ${stock.id} AND companyId = ${companyId} FOR UPDATE`;
        const lockedStock = (Array.isArray(stockRows) ? stockRows[0] : undefined)
            ?? await tx.stock.findUnique({
                where: { id: stock.id },
                select: { quantity: true, negativeBalanceCost: true }
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

        // The warehouse carries a copy of the company costing method, switched
        // under the warehouse X lock (CostingService.updateCostingMethod); the
        // FOR SHARE read above therefore sees the method in force.
        const isFifo = (lockedWarehouse?.costingMethod
            ?? await this.readCostingMethod(tx, companyId)) === 'FIFO';

        // Negative-balance bookkeeping (D1). Stock.negativeBalanceCost holds the
        // provisional value already charged to COGS for the units sold without
        // stock (allowNegative). Rows/test doubles without the column fall back
        // to the historical valuation (deficit x current average).
        const currentDeficitQty = Math.max(0, -currentQty);
        const storedDeficitCost = (lockedStock as { negativeBalanceCost?: unknown } | null)?.negativeBalanceCost;
        const currentDeficitCost = currentDeficitQty <= EPS
            ? 0
            : storedDeficitCost != null && Number.isFinite(Number(storedDeficitCost))
                ? Math.max(0, Number(storedDeficitCost))
                : currentDeficitQty * avgCost;
        let nextDeficitCost: number | null = null;

        // Provisional cost for an authorized negative OUT whose cost is unknown:
        // recipe-derived cost for intermediates, then the reference/average cost.
        // The inbound that later covers the deficit posts a COST_TRUE_UP row.
        let provisionalCost: number | null = null;
        const resolveProvisionalCost = async (): Promise<number> => {
            if (provisionalCost != null) return provisionalCost;
            let value = 0;
            try {
                value = Number(await ProductionRecipeService.resolveProductUnitCost(productId, companyId, tx));
            } catch {
                value = 0;
            }
            if (!(Number.isFinite(value) && value > 0)) value = costResolution.value;
            provisionalCost = Number.isFinite(value) && value > 0 ? value : 0;
            return provisionalCost;
        };

        if (direction === 'IN' && params.unitCost == null && !params.inboundLayers?.length && !costResolution.known) {
            throw new Error(
                `PRODUCT_COST_MISSING: el producto ${productId} no tiene costo promedio ni costo de referencia confirmado`
            );
        }
        if (direction === 'OUT' && !isFifo && params.unitCost == null && !costResolution.known && !params.allowNegative) {
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
        // Zero-quantity COST_TRUE_UP rows to post after the movement, in order.
        const trueUps: Array<{
            amount: number;
            coveredQty: number;
            provisionalValue: number;
            actualValue: number;
            reason?: string;
        }> = [];
        // Deficit-slice work applied once the movement id is known.
        let coveragePlan: SliceCoveragePlan | null = null;
        let coverageUnitActual = 0;
        let deficitSliceIncrease: { quantity: number; rate: number } | null = null;

        if (direction === 'IN') {
            // Load layers only when needed to value the FIFO balance.
            const layerTotals = isFifo
                ? await this.remainingLayerTotals(tx, companyId, warehouseId, productId)
                : null;
            // A sale may have driven the balance negative (allowNegative). The
            // unbacked deficit has no layer, so the invariant is layers ==
            // max(0, stock).
            if (layerTotals && Math.abs(layerTotals.quantity - Math.max(0, currentQty)) > EPS) {
                throw new Error(
                    `Inventario FIFO inconsistente para el producto ${productId} en almacén ${warehouseId}: ` +
                    `stock ${currentQty}, capas ${layerTotals.quantity}. Reconcílie el inventario antes de continuar.`
                );
            }
            // A negative balance carries the provisional value booked by the
            // sales that created it (not today's average) on both methods.
            const prevValued = layerTotals
                ? layerTotals.value - currentDeficitCost
                : currentQty > 0 ? currentQty * avgCost : -currentDeficitCost;

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
            let layersToCreate: NonNullable<ApplyMovementParams['inboundLayers']> =
                params.inboundLayers ?? [{ quantity, unitCost, sourceRef: params.reference ?? null }];
            // An inbound first covers any negative (unbacked) balance left by a
            // sale; only the remainder above zero becomes a cost layer. Trim
            // from the tail so an exact reversal drops the unbacked portion.
            const deficit = currentQty < -EPS ? -currentQty : 0;
            if (deficit > 0) {
                let toTrim = deficit;
                let trimmedValue = 0;
                const trimmed = [...layersToCreate];
                for (let i = trimmed.length - 1; i >= 0 && toTrim > EPS; i -= 1) {
                    const take = Math.min(trimmed[i].quantity, toTrim);
                    toTrim -= take;
                    trimmedValue += take * trimmed[i].unitCost;
                    const left = trimmed[i].quantity - take;
                    if (left > EPS) trimmed[i] = { ...trimmed[i], quantity: left };
                    else trimmed.splice(i, 1);
                }
                layersToCreate = trimmed;

                // Cost true-up (D1b): the covered units were already charged to
                // COGS at the provisional cost of the deficit slices they cover
                // (oldest first). Their real cost is this inbound's (FIFO and
                // layer-valued returns: the trimmed layer value; WA: the ledger
                // unit cost). Post the difference so COGS and the ledger agree.
                const coveredQty = Math.min(quantity, deficit);
                const fullyCovered = coveredQty >= deficit - EPS;
                coveragePlan = await this.planSliceCoverage(tx, {
                    companyId, warehouseId, productId,
                    coveredQty, deficit, deficitCost: currentDeficitCost,
                    returnedOpenSlices: params.returnedOpenSlices
                });
                const provisionalValue = coveragePlan.provisionalValue;
                const layerValued = isFifo || params.returnedOpenSlices != null || params.restoredValueAdjustment != null;
                const actualValue = layerValued ? trimmedValue : coveredQty * unitCost;
                nextDeficitCost = fullyCovered ? 0 : Math.max(0, currentDeficitCost - provisionalValue);
                // Returned slices leave the queue at their provisional value
                // (their layers sit at the tail at that cost); the rest of the
                // actual value belongs to the slices really covered.
                const coveredSliceQty = coveredQty - coveragePlan.returnedQty;
                coverageUnitActual = coveredSliceQty > EPS
                    ? Math.max(0, actualValue - coveragePlan.returnedValue) / coveredSliceQty
                    : 0;
                const amount = actualValue - provisionalValue;
                if (Math.abs(amount) > COST_EPS) {
                    trueUps.push({ amount, coveredQty, provisionalValue, actualValue });
                }
            }
            const restored = Number(params.restoredValueAdjustment ?? 0);
            if (Number.isFinite(restored) && Math.abs(restored) > COST_EPS) {
                // Layers were re-valued above the movement value: the balance
                // gains `restored` and COGS drops by the same amount.
                trueUps.push({
                    amount: -restored,
                    coveredQty: 0,
                    provisionalValue: totalCost,
                    actualValue: totalCost + restored,
                    reason: `Reversa de ajuste de costo por saldo negativo cubierto: valor restaurado ${(totalCost + restored).toFixed(6)} ` +
                        `- valor del movimiento ${totalCost.toFixed(6)}`
                });
            }
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
            // Locking read: remainingQty is written back absolutely below.
            const allLayers = await this.lockRemainingLayers(tx, companyId, warehouseId, productId);
            const layers = params.consumeSourceMovementId != null
                ? allLayers.filter((layer) => layer.sourceMovementId === params.consumeSourceMovementId)
                : params.consumeSourceRef
                    ? allLayers.filter((layer) => layer.sourceRef === params.consumeSourceRef)
                    : allLayers;
            const allLayerQuantity = allLayers.reduce((sum, layer) => sum + Number(layer.remainingQty), 0);
            if (isFifo && Math.abs(allLayerQuantity - Math.max(0, currentQty)) > EPS) {
                throw new Error(
                    `Inventario FIFO inconsistente para el producto ${productId} en almacén ${warehouseId}: ` +
                    `stock ${currentQty}, capas ${allLayerQuantity}. Reconcílie el inventario antes de continuar.`
                );
            }
            const prevValued = isFifo
                ? allLayers.reduce((s, b) => s + Number(b.remainingQty) * Number(b.unitCost), 0) - currentDeficitCost
                : currentQty > 0 ? currentQty * avgCost : -currentDeficitCost;

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
            // An authorized negative balance (sale of an already-sold order) is
            // valued at the product's current effective cost or, when that is
            // unknown (never-costed intermediate), at a provisional recipe /
            // reference cost. There is no layer to consume; the next inbound
            // covers the deficit first and posts a cost true-up.
            let uncoveredRate: number | null = null;
            if (remaining > EPS) {
                if (isFifo && !params.allowNegative) {
                    throw new Error(
                        `Capas FIFO insuficientes para el producto ${productId}. ` +
                        `Faltan ${remaining} unidades por reconciliar.`
                    );
                }
                uncoveredRate = costResolution.known
                    ? avgCost
                    : params.allowNegative ? await resolveProvisionalCost() : avgCost;
                fifoCogs += remaining * uncoveredRate;
                consumedLayers.push({ quantity: remaining, unitCost: uncoveredRate, sourceRef: null });
                remaining = 0;
            }

            if (params.unitCost != null) {
                // Bespoke valuation supplied by the caller (e.g. a reversal).
                unitCost = Number(params.unitCost);
                totalCost = quantity * unitCost;
            } else if (isFifo || params.valueFromConsumedLayers) {
                totalCost = fifoCogs;
                unitCost = quantity > 0 ? totalCost / quantity : 0;
            } else if (!costResolution.known && params.allowNegative) {
                // WEIGHTED_AVERAGE without a confirmed cost on an authorized
                // negative sale: provisional cost instead of PRODUCT_COST_MISSING.
                unitCost = await resolveProvisionalCost();
                totalCost = quantity * unitCost;
            } else {
                // WEIGHTED_AVERAGE: keep using the shared outflow contract so the
                // numeric result is identical to the legacy per-service code.
                unitCost = await CostingService.getOutflowUnitCost(tx, productId, companyId);
                totalCost = quantity * unitCost;
            }
            balanceCost = prevValued - totalCost;

            // Track the provisional value of the units that went unbacked.
            const deficitIncrease = Math.max(0, -newQty) - currentDeficitQty;
            if (deficitIncrease > EPS) {
                const rate = params.unitCost != null || (!isFifo && !params.valueFromConsumedLayers) || uncoveredRate == null
                    ? unitCost
                    : uncoveredRate;
                nextDeficitCost = currentDeficitCost + deficitIncrease * rate;
                deficitSliceIncrease = { quantity: deficitIncrease, rate };
            }
        }

        // Running balance of the true-up rows (each restates by -amount). Under
        // FIFO the movement row shows the final balance (remaining layers minus
        // the open deficit), as the true-up rows do.
        const finalBalanceCost = trueUps.reduce((sum, row) => sum - row.amount, balanceCost);
        const movementBalanceCost = isFifo ? finalBalanceCost : balanceCost;

        // 5/6. Persist the new stock balance and the movement record.
        await tx.stock.update({
            where: { id: stock.id },
            data: {
                quantity: newQty,
                ...(nextDeficitCost != null ? { negativeBalanceCost: nextDeficitCost } : {})
            }
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
                balanceCost: movementBalanceCost,
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

        // Deficit-slice ledger: record which slices this inbound covered (or
        // took out of the queue for a return), or the slice(s) an OUT opened.
        if (coveragePlan) {
            await this.applySliceCoverage(tx, coveragePlan, movement.id, coverageUnitActual);
        }
        if (deficitSliceIncrease) {
            await this.openDeficitSlices(tx, {
                companyId, warehouseId, productId,
                movementId: movement.id,
                quantity: deficitSliceIncrease.quantity,
                rate: deficitSliceIncrease.rate,
                reopenCoveredByMovementIds: params.reopenCoveredByMovementIds
            });
        }

        // D1b cost true-up: zero-quantity ADJUSTMENT rows with origin
        // COST_TRUE_UP and totalCost = |delta| (kardex/report readers expect a
        // non-negative totalCost); direction carries the sign: OUT = extra COGS
        // (inbound cost above the provisional cost), IN = COGS reduction. Each
        // row restates the running balance by -delta.
        let costTrueUp: ApplyMovementResult['costTrueUp'];
        let running = balanceCost;
        for (const row of trueUps) {
            running -= row.amount;
            const trueUpMovementId = await this.postCostTrueUp(tx, {
                companyId,
                warehouseId,
                productId,
                userId,
                amount: row.amount,
                reason: row.reason ?? (
                    `${COST_TRUE_UP_COVERAGE_REASON} (${row.coveredQty} u.): ` +
                    `costo real ${row.actualValue.toFixed(6)} - provisional ${row.provisionalValue.toFixed(6)} ` +
                    `(mov. ${movement.id})`
                ),
                reference: params.reference ?? `MOV-${movement.id}`,
                // Coverage rows record the real unit cost of the covered units.
                unitCost: row.reason == null && row.coveredQty > EPS ? row.actualValue / row.coveredQty : 0,
                balanceQty: newQty,
                balanceCost: isFifo ? finalBalanceCost : running
            });
            costTrueUp = costTrueUp ?? { movementId: trueUpMovementId, amount: row.amount, coveredQty: row.coveredQty };
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
            balanceCost: movementBalanceCost,
            consumedLayers: direction === 'OUT' ? consumedLayers : undefined,
            ...(costTrueUp ? { costTrueUp } : {})
        };
    }

    /**
     * Zero-quantity COST_TRUE_UP row. `amount` > 0 = extra COGS (direction
     * OUT), < 0 = COGS reduction (direction IN). Never part of a transfer
     * group: transfer reversal loads exactly the two legs by transferGroupId.
     */
    private static async postCostTrueUp(tx: Tx, row: {
        companyId: number;
        warehouseId: number;
        productId: number;
        userId: number;
        amount: number;
        reason: string;
        reference: string;
        unitCost: number;
        balanceQty: number;
        balanceCost: number;
    }): Promise<number> {
        const created = await tx.inventoryMovement.create({
            data: {
                companyId: row.companyId,
                warehouseId: row.warehouseId,
                productId: row.productId,
                userId: row.userId,
                type: 'ADJUSTMENT',
                transferGroupId: null,
                direction: row.amount > 0 ? 'OUT' : 'IN',
                origin: COST_TRUE_UP_ORIGIN,
                quantity: 0,
                reason: row.reason,
                reference: row.reference,
                unitCost: Number.isFinite(row.unitCost) && row.unitCost > 0 ? row.unitCost : 0,
                totalCost: Math.abs(row.amount),
                balanceQty: row.balanceQty,
                balanceCost: row.balanceCost
            },
            select: { id: true }
        });
        return created.id;
    }

    /**
     * Takes back out the part of a reversed inbound that had covered a negative
     * balance (the "trimmed" units that never opened a layer of their own).
     *
     *  - Units still backed by OTHER layers (stock > 0 now) are consumed and
     *    valued from those layers; the difference against the reversed
     *    inbound's unit cost is posted as a coverage COST_TRUE_UP (the units
     *    sold on the negative balance are now covered by those layers instead
     *    of the reversed entry).
     *  - Units beyond the available stock re-create the deficit at the reversed
     *    inbound's unit cost, so Stock.negativeBalanceCost stays consistent with
     *    the value already charged to COGS.
     *
     * Reversal metadata (`reversalOfId`) goes only on the first posted row.
     */
    static async reverseCoveredShortfall(tx: Tx, params: {
        type: InventoryMovementType;
        companyId: number;
        warehouseId: number;
        productId: number;
        userId: number;
        quantity: number;
        /** Unit cost of the inbound being reversed. */
        unitCost: number;
        reason?: string;
        reference?: string;
        productName?: string;
        origin?: ApplyMovementParams['origin'];
        transferGroupId?: string | null;
        reversalOfId?: number;
        reversalGroupId?: string;
        reversalKey?: string;
        /**
         * Inbound movement(s) being reversed: the deficit slices they covered
         * are re-opened (deficit leg, LIFO) or moved to the covered leg.
         */
        coveringMovementIds?: number[];
    }): Promise<{
        movementIds: number[];
        /** Movement id carrying reversalOfId (the first posted row). */
        firstMovementId: number | null;
        totalCost: number;
        consumedLayers: NonNullable<ApplyMovementResult['consumedLayers']>;
        trueUpAmount: number;
    }> {
        const quantity = Number(params.quantity);
        const unitCost = Number(params.unitCost);
        if (!(quantity > EPS)) {
            return { movementIds: [], firstMovementId: null, totalCost: 0, consumedLayers: [], trueUpAmount: 0 };
        }
        if (!Number.isFinite(unitCost) || unitCost < 0) {
            throw new Error('El costo unitario del reverso debe ser finito y mayor o igual a 0');
        }
        // Same canonical lock order as applyMovement; the Product lock
        // serializes every writer of this stock row before it is read.
        await this.lockInventoryScope(tx, params.companyId, [params.warehouseId], [params.productId]);
        const available = Math.max(0, await this.lockedStockQuantity(tx, params.companyId, params.warehouseId, params.productId));
        let reversalOfId = params.reversalOfId;
        const movementIds: number[] = [];
        const consumedLayers: NonNullable<ApplyMovementResult['consumedLayers']> = [];
        let totalCost = 0;

        // Units a sale return already brought back (their covered slice was
        // split off with returnMovementId): take them out of the return's own
        // layers at their cost, no true-up. Only the still-live covered slices
        // go through the FIFO + true-up leg below.
        let returnedTaken = 0;
        const coveringIds = params.coveringMovementIds ?? [];
        const sliceDelegate = this.sliceDelegate(tx);
        if (coveringIds.length > 0 && sliceDelegate) {
            const live = await this.lockSlicesCoveredBy(tx, params.companyId, params.warehouseId, params.productId, coveringIds);
            const liveQty = live.reduce((sum, row) => sum + row.quantity, 0);
            const returnedRows = await this.lockReturnedSlicesCoveredBy(
                tx, params.companyId, params.warehouseId, params.productId, coveringIds
            );
            let room = Math.max(0, Math.min(quantity - liveQty, available));
            for (const row of returnedRows) {
                if (!(room > EPS)) break;
                const sourceRef = this.returnedSliceSourceRef(row.id);
                const inLayer = (await this.lockRemainingLayers(tx, params.companyId, params.warehouseId, params.productId))
                    .filter((layer) => layer.sourceRef === sourceRef)
                    .reduce((sum, layer) => sum + Number(layer.remainingQty), 0);
                // Returned units that were sold again (their DSLICE layer was
                // consumed, not merely trimmed by an open deficit) cannot be
                // attributed exactly: refuse, as for any consumed receipt layer.
                // The first layer created under this ref is the return's own
                // (already trimmed) layer; later ones are re-returns of resales.
                const batchDelegate = (tx as unknown as { inventoryBatch?: { findFirst?: (args: unknown) => Promise<{ originalQty: unknown } | null> } }).inventoryBatch;
                if (typeof batchDelegate?.findFirst === 'function') {
                    const firstLayer = await batchDelegate.findFirst({
                        where: { companyId: params.companyId, warehouseId: params.warehouseId, productId: params.productId, sourceRef },
                        orderBy: { id: 'asc' },
                        select: { originalQty: true },
                    });
                    const required = Math.min(row.quantity, Number(firstLayer?.originalQty ?? 0));
                    if (inLayer < required - EPS) {
                        throw new Error(
                            `No se puede revertir: ${Number((required - inLayer).toFixed(6))} unidad(es) devueltas al inventario (${sourceRef}) ya fueron consumidas, vendidas o transferidas. ` +
                            'Revierta primero esos movimientos o registre un ajuste.'
                        );
                    }
                }
                const take = Math.min(row.quantity, inLayer, room);
                if (!(take > EPS)) continue;
                const back = await this.applyMovement(tx, {
                    type: params.type,
                    direction: 'OUT',
                    companyId: params.companyId,
                    warehouseId: params.warehouseId,
                    productId: params.productId,
                    userId: params.userId,
                    quantity: take,
                    consumeSourceRef: sourceRef,
                    valueFromConsumedLayers: true,
                    reason: params.reason,
                    reference: params.reference,
                    productName: params.productName,
                    origin: params.origin,
                    transferGroupId: params.transferGroupId,
                    reversalGroupId: params.reversalGroupId,
                    reversalKey: params.reversalKey,
                    ...(reversalOfId != null ? { reversalOfId } : {})
                });
                reversalOfId = undefined;
                movementIds.push(back.movementId);
                consumedLayers.push(...(back.consumedLayers ?? []));
                totalCost += back.totalCost;
                const left = row.quantity - take;
                await sliceDelegate.update({
                    where: { id: row.id },
                    data: { quantity: Math.max(0, left), coveredValue: row.quantity > EPS ? row.coveredValue * (Math.max(0, left) / row.quantity) : 0 }
                });
                room -= take;
                returnedTaken += take;
            }
        }
        const remainingQty = quantity - returnedTaken;
        const coveredQty = Math.min(remainingQty, Math.max(0, available - returnedTaken));
        const deficitQty = remainingQty - coveredQty;
        const common = {
            type: params.type,
            direction: 'OUT' as const,
            companyId: params.companyId,
            warehouseId: params.warehouseId,
            productId: params.productId,
            userId: params.userId,
            reason: params.reason,
            reference: params.reference,
            productName: params.productName,
            origin: params.origin,
            transferGroupId: params.transferGroupId,
            reversalGroupId: params.reversalGroupId,
            reversalKey: params.reversalKey
        };
        let trueUpAmount = 0;
        let coveredLeg: { movementId: number; unitValue: number } | null = null;

        if (coveredQty > EPS) {
            // The covered leg takes out exactly the reversed inbound's value
            // (u per unit) while consuming the other layers at their cost C.
            // The layer value removed above that, (C - u) x k, is the extra
            // cost of the units sold on the negative balance: a coverage
            // true-up moves it to COGS and restates the balance by -(C - u)k.
            const covered = await this.applyMovement(tx, {
                ...common,
                quantity: coveredQty,
                unitCost,
                // The stock covers it; allowNegative only avoids
                // PRODUCT_COST_MISSING on legacy WA stock without layers.
                allowNegative: true,
                ...(reversalOfId != null ? { reversalOfId } : {})
            });
            reversalOfId = undefined;
            movementIds.push(covered.movementId);
            const coveredLayers = covered.consumedLayers ?? [];
            consumedLayers.push(...coveredLayers);
            totalCost += covered.totalCost;
            const layerValue = coveredLayers.reduce((sum, layer) => sum + layer.quantity * layer.unitCost, 0);
            const amount = layerValue - covered.totalCost;
            coveredLeg = { movementId: covered.movementId, unitValue: layerValue / coveredQty };
            if (Math.abs(amount) > COST_EPS) {
                trueUpAmount = amount;
                const trueUpId = await this.postCostTrueUp(tx, {
                    companyId: params.companyId,
                    warehouseId: params.warehouseId,
                    productId: params.productId,
                    userId: params.userId,
                    amount,
                    reason: `${COST_TRUE_UP_COVERAGE_REASON} (${coveredQty} u.): ` +
                        `costo real ${layerValue.toFixed(6)} - provisional ${covered.totalCost.toFixed(6)} ` +
                        `(reverso mov. ${covered.movementId})`,
                    reference: params.reference ?? `MOV-${covered.movementId}`,
                    unitCost: layerValue / coveredQty,
                    balanceQty: covered.balanceQty,
                    balanceCost: covered.balanceCost - amount
                });
                movementIds.push(trueUpId);
            }
        }
        if (deficitQty > EPS) {
            const deficit = await this.applyMovement(tx, {
                ...common,
                quantity: deficitQty,
                unitCost,
                allowNegative: true,
                reopenCoveredByMovementIds: params.coveringMovementIds,
                ...(reversalOfId != null ? { reversalOfId } : {})
            });
            movementIds.push(deficit.movementId);
            consumedLayers.push(...(deficit.consumedLayers ?? []));
            totalCost += deficit.totalCost;
        }
        if (coveredLeg && params.coveringMovementIds?.length) {
            await this.recoverSlices(tx, {
                companyId: params.companyId,
                warehouseId: params.warehouseId,
                productId: params.productId,
                fromMovementIds: params.coveringMovementIds,
                toMovementId: coveredLeg.movementId,
                quantity: coveredQty,
                unitValue: coveredLeg.unitValue
            });
        }
        return { movementIds, firstMovementId: movementIds[0] ?? null, totalCost, consumedLayers, trueUpAmount };
    }

    // ==========================================
    // Deficit-slice ledger (negative balances)
    // ==========================================

    private static sliceDelegate(tx: Tx): Tx['inventoryDeficitSlice'] | undefined {
        // Unit-test doubles without the model keep the pooled (pro-rata) logic.
        return (tx as { inventoryDeficitSlice?: Tx['inventoryDeficitSlice'] }).inventoryDeficitSlice;
    }

    private static toSliceRow(row: Record<string, unknown>): DeficitSliceRow | null {
        const id = Number(row.id);
        const quantity = Number(row.quantity);
        if (!Number.isInteger(id) || !Number.isFinite(quantity)) return null;
        return {
            id,
            saleMovementId: row.saleMovementId == null ? null : Number(row.saleMovementId),
            quantity,
            provisionalUnitCost: Number(row.provisionalUnitCost ?? 0),
            coveringMovementId: row.coveringMovementId == null ? null : Number(row.coveringMovementId),
            coveredValue: Number(row.coveredValue ?? 0)
        };
    }

    /**
     * Slices read WITH their row locks (ordered by id, after the Stock lock),
     * so values are the latest committed ones. Falls back to findMany only for
     * unit-test doubles (whose raw queries return nothing usable).
     */
    private static async lockSlices(
        tx: Tx,
        raw: () => Promise<unknown>,
        where: Prisma.InventoryDeficitSliceWhereInput
    ): Promise<DeficitSliceRow[]> {
        const delegate = this.sliceDelegate(tx);
        if (!delegate) return [];
        const rows = await raw();
        const valid = (Array.isArray(rows) ? rows : [])
            .map((row) => this.toSliceRow(row as Record<string, unknown>))
            .filter((row): row is DeficitSliceRow => row != null);
        if (valid.length > 0) return valid;
        const probe = await tx.$queryRaw<Array<{ ok: unknown }>>`SELECT 1 AS ok`;
        if (Array.isArray(probe) && probe.length > 0) return [];
        const found = await delegate.findMany({ where, orderBy: { id: 'asc' } });
        return found
            .map((row) => this.toSliceRow(row as unknown as Record<string, unknown>))
            .filter((row): row is DeficitSliceRow => row != null && row.quantity > EPS);
    }

    /** Open slices (deficit queue, oldest first). */
    private static lockOpenSlices(tx: Tx, companyId: number, warehouseId: number, productId: number) {
        return this.lockSlices(
            tx,
            () => tx.$queryRaw`SELECT id, saleMovementId, quantity, provisionalUnitCost, coveringMovementId, coveredValue FROM \`InventoryDeficitSlice\` WHERE companyId = ${companyId} AND warehouseId = ${warehouseId} AND productId = ${productId} AND coveringMovementId IS NULL AND returnMovementId IS NULL AND quantity > 0 ORDER BY id FOR UPDATE`,
            { companyId, warehouseId, productId, coveringMovementId: null, returnMovementId: null, quantity: { gt: 0 } }
        );
    }

    /** Live (not returned) slices covered by the given movements (oldest first). */
    private static lockSlicesCoveredBy(tx: Tx, companyId: number, warehouseId: number, productId: number, movementIds: number[]) {
        if (movementIds.length === 0) return Promise.resolve([] as DeficitSliceRow[]);
        return this.lockSlices(
            tx,
            () => tx.$queryRaw`SELECT id, saleMovementId, quantity, provisionalUnitCost, coveringMovementId, coveredValue FROM \`InventoryDeficitSlice\` WHERE warehouseId = ${warehouseId} AND productId = ${productId} AND companyId = ${companyId} AND coveringMovementId IN (${Prisma.join(movementIds)}) AND returnMovementId IS NULL AND quantity > 0 ORDER BY id FOR UPDATE`,
            { companyId, warehouseId, productId, coveringMovementId: { in: movementIds }, returnMovementId: null, quantity: { gt: 0 } }
        );
    }

    /**
     * Parts of slices covered by the given movements that a sale return already
     * brought back (their layer carries sourceRef DSLICE-<id>), oldest first.
     */
    private static lockReturnedSlicesCoveredBy(tx: Tx, companyId: number, warehouseId: number, productId: number, movementIds: number[]) {
        if (movementIds.length === 0) return Promise.resolve([] as DeficitSliceRow[]);
        return this.lockSlices(
            tx,
            () => tx.$queryRaw`SELECT id, saleMovementId, quantity, provisionalUnitCost, coveringMovementId, coveredValue FROM \`InventoryDeficitSlice\` WHERE warehouseId = ${warehouseId} AND productId = ${productId} AND companyId = ${companyId} AND coveringMovementId IN (${Prisma.join(movementIds)}) AND returnMovementId IS NOT NULL AND quantity > 0 ORDER BY id FOR UPDATE`,
            { companyId, warehouseId, productId, coveringMovementId: { in: movementIds }, returnMovementId: { not: null }, quantity: { gt: 0 } }
        );
    }

    /** Layer reference of the part of a slice a return brought back. */
    static returnedSliceSourceRef(sliceId: number): string {
        return `DSLICE-${sliceId}`;
    }

    /**
     * Slices opened by the given sale OUT movements (open and covered, oldest
     * first). Callers must already hold the Stock row lock.
     */
    static lockSlicesOfSales(tx: Tx, companyId: number, warehouseId: number, productId: number, saleMovementIds: number[]) {
        if (saleMovementIds.length === 0) return Promise.resolve([] as DeficitSliceRow[]);
        return this.lockSlices(
            tx,
            () => tx.$queryRaw`SELECT id, saleMovementId, quantity, provisionalUnitCost, coveringMovementId, coveredValue FROM \`InventoryDeficitSlice\` WHERE warehouseId = ${warehouseId} AND productId = ${productId} AND companyId = ${companyId} AND saleMovementId IN (${Prisma.join(saleMovementIds)}) AND returnMovementId IS NULL AND quantity > 0 ORDER BY id FOR UPDATE`,
            { companyId, warehouseId, productId, saleMovementId: { in: saleMovementIds }, returnMovementId: null, quantity: { gt: 0 } }
        );
    }

    /**
     * Split off `take` units of a covered slice that a sale return brings back.
     * The split row is created with a pending returnMovementId (0) so it is no
     * longer live; `markReturnedSlices` sets the real return movement id. The
     * caller gives the returned layer sourceRef DSLICE-<returned row id> so an
     * inbound reversal can take those exact units back.
     */
    static async splitReturnedCoveredSlice(tx: Tx, row: DeficitSliceRow & { companyId: number; warehouseId: number; productId: number }, take: number): Promise<number | null> {
        const delegate = this.sliceDelegate(tx);
        if (!delegate || !(take > EPS)) return null;
        const unit = row.quantity > EPS ? row.coveredValue / row.quantity : 0;
        const left = Math.max(0, row.quantity - take);
        await delegate.update({
            where: { id: row.id },
            data: { quantity: left, coveredValue: unit * left }
        });
        const returned = await delegate.create({
            data: {
                companyId: row.companyId,
                warehouseId: row.warehouseId,
                productId: row.productId,
                saleMovementId: row.saleMovementId,
                quantity: take,
                provisionalUnitCost: row.provisionalUnitCost,
                coveringMovementId: row.coveringMovementId,
                coveredValue: unit * take,
                returnMovementId: 0
            },
            select: { id: true }
        });
        return returned.id;
    }

    /** Record the return movement on the slices split off by its plan. */
    static async markReturnedSlices(tx: Tx, sliceIds: number[], returnMovementId: number): Promise<void> {
        const delegate = this.sliceDelegate(tx);
        if (!delegate) return;
        for (const id of sliceIds) {
            await delegate.update({ where: { id }, data: { returnMovementId } });
        }
    }

    /**
     * Which open slices an inbound covering `coveredQty` units consumes: the
     * returned sale's own slices first, then the queue oldest-first. Units not
     * represented by slices (legacy pooled deficit) are valued pro rata from
     * Stock.negativeBalanceCost.
     */
    private static async planSliceCoverage(tx: Tx, params: {
        companyId: number;
        warehouseId: number;
        productId: number;
        coveredQty: number;
        deficit: number;
        deficitCost: number;
        returnedOpenSlices?: Array<{ id: number; quantity: number }>;
    }): Promise<SliceCoveragePlan> {
        const open = await this.lockOpenSlices(tx, params.companyId, params.warehouseId, params.productId);
        const takes: SliceCoveragePlan['takes'] = [];
        const used = new Map<number, number>();
        let remaining = params.coveredQty;
        let provisionalValue = 0;
        let returnedQty = 0;
        let returnedValue = 0;
        for (const spec of params.returnedOpenSlices ?? []) {
            const row = open.find((candidate) => candidate.id === spec.id);
            if (!row) continue;
            const take = Math.min(spec.quantity, row.quantity - (used.get(row.id) ?? 0), remaining);
            if (!(take > EPS)) continue;
            takes.push({ row, take, returned: true });
            used.set(row.id, (used.get(row.id) ?? 0) + take);
            remaining -= take;
            provisionalValue += take * row.provisionalUnitCost;
            returnedQty += take;
            returnedValue += take * row.provisionalUnitCost;
        }
        for (const row of open) {
            if (!(remaining > EPS)) break;
            const take = Math.min(row.quantity - (used.get(row.id) ?? 0), remaining);
            if (!(take > EPS)) continue;
            takes.push({ row, take, returned: false });
            used.set(row.id, (used.get(row.id) ?? 0) + take);
            remaining -= take;
            provisionalValue += take * row.provisionalUnitCost;
        }
        if (remaining > EPS) {
            const sliceQty = open.reduce((sum, row) => sum + row.quantity, 0);
            const sliceValue = open.reduce((sum, row) => sum + row.quantity * row.provisionalUnitCost, 0);
            const residualQty = Math.max(0, params.deficit - sliceQty);
            const residualCost = Math.max(0, params.deficitCost - sliceValue);
            const rate = residualQty > EPS
                ? residualCost / residualQty
                : params.deficit > EPS ? params.deficitCost / params.deficit : 0;
            provisionalValue += remaining * rate;
        }
        return {
            companyId: params.companyId, warehouseId: params.warehouseId, productId: params.productId,
            takes, provisionalValue, returnedQty, returnedValue
        };
    }

    /** Persist a coverage plan once the covering movement id is known. */
    private static async applySliceCoverage(
        tx: Tx,
        plan: SliceCoveragePlan,
        movementId: number,
        unitActual: number
    ): Promise<void> {
        const delegate = this.sliceDelegate(tx);
        if (!delegate || plan.takes.length === 0) return;
        const byRow = new Map<number, { row: DeficitSliceRow; returned: number; covered: number }>();
        for (const take of plan.takes) {
            const entry = byRow.get(take.row.id) ?? { row: take.row, returned: 0, covered: 0 };
            if (take.returned) entry.returned += take.take;
            else entry.covered += take.take;
            byRow.set(take.row.id, entry);
        }
        for (const { row, returned, covered } of byRow.values()) {
            const left = row.quantity - returned - covered;
            if (covered > EPS && returned <= EPS && left <= EPS) {
                await delegate.update({
                    where: { id: row.id },
                    data: { coveringMovementId: movementId, coveredValue: covered * unitActual, quantity: covered }
                });
                continue;
            }
            await delegate.update({ where: { id: row.id }, data: { quantity: Math.max(0, left) } });
            if (covered > EPS) {
                await delegate.create({
                    data: {
                        companyId: plan.companyId,
                        warehouseId: plan.warehouseId,
                        productId: plan.productId,
                        saleMovementId: row.saleMovementId,
                        quantity: covered,
                        provisionalUnitCost: row.provisionalUnitCost,
                        coveringMovementId: movementId,
                        coveredValue: covered * unitActual
                    }
                });
            }
        }
    }

    /**
     * An OUT drove the balance (further) below zero: re-open the slices the
     * given inbound movements had covered (LIFO) and append a new slice for
     * the rest, all at the OUT's deficit rate.
     */
    private static async openDeficitSlices(tx: Tx, params: {
        companyId: number;
        warehouseId: number;
        productId: number;
        movementId: number;
        quantity: number;
        rate: number;
        reopenCoveredByMovementIds?: number[];
    }): Promise<void> {
        const delegate = this.sliceDelegate(tx);
        if (!delegate) return;
        let remaining = params.quantity;
        if (params.reopenCoveredByMovementIds?.length) {
            const covered = await this.lockSlicesCoveredBy(
                tx, params.companyId, params.warehouseId, params.productId, params.reopenCoveredByMovementIds
            );
            for (const row of [...covered].reverse()) {
                if (!(remaining > EPS)) break;
                const take = Math.min(row.quantity, remaining);
                remaining -= take;
                if (take >= row.quantity - EPS) {
                    await delegate.update({
                        where: { id: row.id },
                        data: { coveringMovementId: null, coveredValue: 0, provisionalUnitCost: params.rate }
                    });
                } else {
                    const left = row.quantity - take;
                    await delegate.update({
                        where: { id: row.id },
                        data: { quantity: left, coveredValue: row.coveredValue * (left / row.quantity) }
                    });
                    await delegate.create({
                        data: {
                            companyId: params.companyId,
                            warehouseId: params.warehouseId,
                            productId: params.productId,
                            saleMovementId: row.saleMovementId,
                            quantity: take,
                            provisionalUnitCost: params.rate
                        }
                    });
                }
            }
        }
        if (remaining > EPS) {
            await delegate.create({
                data: {
                    companyId: params.companyId,
                    warehouseId: params.warehouseId,
                    productId: params.productId,
                    saleMovementId: params.movementId,
                    quantity: remaining,
                    provisionalUnitCost: params.rate
                }
            });
        }
    }

    /**
     * After an inbound reversal took its covered units out of other layers:
     * the sold units it had covered are now covered by that OUT leg at the
     * layer cost actually consumed.
     */
    private static async recoverSlices(tx: Tx, params: {
        companyId: number;
        warehouseId: number;
        productId: number;
        fromMovementIds: number[];
        toMovementId: number;
        quantity: number;
        unitValue: number;
    }): Promise<void> {
        const delegate = this.sliceDelegate(tx);
        if (!delegate || !(params.quantity > EPS)) return;
        const rows = await this.lockSlicesCoveredBy(
            tx, params.companyId, params.warehouseId, params.productId, params.fromMovementIds
        );
        let remaining = params.quantity;
        for (const row of rows) {
            if (!(remaining > EPS)) break;
            const take = Math.min(row.quantity, remaining);
            remaining -= take;
            if (take >= row.quantity - EPS) {
                await delegate.update({
                    where: { id: row.id },
                    data: { coveringMovementId: params.toMovementId, coveredValue: take * params.unitValue }
                });
            } else {
                const left = row.quantity - take;
                await delegate.update({
                    where: { id: row.id },
                    data: { quantity: left, coveredValue: row.coveredValue * (left / row.quantity) }
                });
                await delegate.create({
                    data: {
                        companyId: params.companyId,
                        warehouseId: params.warehouseId,
                        productId: params.productId,
                        saleMovementId: row.saleMovementId,
                        quantity: take,
                        provisionalUnitCost: row.provisionalUnitCost,
                        coveringMovementId: params.toMovementId,
                        coveredValue: take * params.unitValue
                    }
                });
            }
        }
    }

    /**
     * Costing method in force for a warehouse, read with a FOR SHARE lock on
     * the Warehouse row (latest committed Warehouse.costingMethod, which the
     * method switch updates under X locks). Use it whenever a flow decides how
     * to value/consume layers. Falls back to the company (test doubles).
     */
    static async readWarehouseCostingMethod(
        tx: Tx,
        companyId: number,
        warehouseId: number
    ): Promise<'FIFO' | 'WEIGHTED_AVERAGE'> {
        const rows = await tx.$queryRaw<Array<{ costingMethod?: string | null }>>`SELECT costingMethod FROM \`Warehouse\` WHERE id = ${warehouseId} AND companyId = ${companyId} LOCK IN SHARE MODE`;
        const method = Array.isArray(rows) ? rows[0]?.costingMethod : undefined;
        if (method === 'FIFO' || method === 'WEIGHTED_AVERAGE') return method;
        return this.readCostingMethod(tx, companyId);
    }

    /** Company costing method (FIFO or weighted average) for a movement. */
    static async readCostingMethod(tx: Tx, companyId: number): Promise<'FIFO' | 'WEIGHTED_AVERAGE'> {
        // Plain (non-locking) read on purpose: a FOR SHARE on Company here,
        // taken after Warehouse -> Product -> Stock, inverts the order used by
        // production (Company FOR UPDATE -> Warehouse/Product) and deadlocks.
        // CAUTION: under REPEATABLE READ this returns the transaction snapshot,
        // so it can miss a switch committed after the snapshot even though the
        // caller holds its Warehouse lock. applyMovement therefore reads
        // Warehouse.costingMethod from its own Warehouse locking read and only
        // falls back here for test doubles. Use this for reporting/sync paths,
        // never to decide how a movement consumes layers.
        const company = await tx.company.findUnique({
            where: { id: companyId },
            select: { costingMethod: true }
        });
        return company?.costingMethod === 'FIFO' ? 'FIFO' : 'WEIGHTED_AVERAGE';
    }

    /**
     * Current stock quantity read WITH the Stock row lock (latest committed
     * value, not the REPEATABLE READ snapshot). Callers must already hold the
     * Warehouse/Product locks (canonical order). 0 when the row does not exist.
     */
    static async lockedStockQuantity(tx: Tx, companyId: number, warehouseId: number, productId: number): Promise<number> {
        const rows = await tx.$queryRaw<Array<{ quantity: unknown }>>`SELECT quantity FROM \`Stock\` WHERE companyId = ${companyId} AND warehouseId = ${warehouseId} AND productId = ${productId} FOR UPDATE`;
        if (Array.isArray(rows) && rows.length > 0) return Number(rows[0].quantity ?? 0);
        // Missing row (or a unit-test double answering raw queries with []).
        const stock = await tx.stock.findUnique({
            where: { warehouseId_productId: { warehouseId, productId } },
            select: { quantity: true }
        });
        return Number(stock?.quantity ?? 0);
    }

    /** MySQL TINYINT(1) from a raw query may arrive as 0/1 or boolean. */
    private static sqlBoolean(value: unknown): boolean {
        return value === true || Number(value) === 1;
    }

    /**
     * Remaining layers (oldest first) read WITH the row locks, so the values
     * are the latest committed ones, not the transaction snapshot.
     */
    private static async lockRemainingLayers(
        tx: Tx,
        companyId: number,
        warehouseId: number,
        productId: number
    ): Promise<Array<{
        id: number;
        unitCost: unknown;
        remainingQty: unknown;
        sourceRef: string | null;
        sourceType: string;
        sourceMovementId: number | null;
        createdAt: Date;
    }>> {
        const rows = await tx.$queryRaw<Array<{
            id: number;
            unitCost: unknown;
            remainingQty: unknown;
            sourceRef: string | null;
            sourceType: string;
            sourceMovementId: number | null;
            createdAt: Date;
        }>>`SELECT id, unitCost, remainingQty, sourceRef, sourceType, sourceMovementId, createdAt FROM \`InventoryBatch\` WHERE companyId = ${companyId} AND warehouseId = ${warehouseId} AND productId = ${productId} AND remainingQty > 0 ORDER BY createdAt, id FOR UPDATE`;
        if (Array.isArray(rows) && rows.length > 0) {
            return rows.map((row) => ({
                ...row,
                id: Number(row.id),
                sourceMovementId: row.sourceMovementId == null ? null : Number(row.sourceMovementId),
                createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt))
            }));
        }
        // An empty locked result is authoritative in MySQL: confirm it with a
        // probe that always yields one row there. Only unit-test doubles (which
        // answer every raw query with []) reach the findMany fallback, so a stale
        // snapshot can never resurrect layers consumed by a concurrent movement.
        const probe = await tx.$queryRaw<Array<{ n: unknown }>>`SELECT COUNT(*) AS n FROM \`InventoryBatch\` WHERE companyId = ${companyId} AND warehouseId = ${warehouseId} AND productId = ${productId} AND remainingQty > 0`;
        if (Array.isArray(probe) && probe.length > 0) return [];
        return tx.inventoryBatch.findMany({
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
    }

    /** Sum the valued (remainingQty * unitCost) of the remaining FIFO layers. */
    private static async remainingLayerTotals(
        tx: Tx,
        companyId: number,
        warehouseId: number,
        productId: number
    ): Promise<{ quantity: number; value: number }> {
        const layers = await this.lockRemainingLayers(tx, companyId, warehouseId, productId);
        return layers.reduce((totals, batch) => ({
            quantity: totals.quantity + Number(batch.remainingQty),
            value: totals.value + Number(batch.remainingQty) * Number(batch.unitCost)
        }), { quantity: 0, value: 0 });
    }
}
