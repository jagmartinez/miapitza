import type { Prisma } from '@prisma/client';
import { UnitConversionService } from './unit-conversion.service';
import { InventoryEngineService, type BatchSourceType } from './inventory-engine.service';
import { CostingService } from './costing.service';
import { StockAlertService } from './stock-alert.service';
import { WarehouseRouteService } from './warehouse-route.service';
import { resolveRecipeUnit } from '../utils/recipe-unit';

/**
 * Centralizes recipe -> base-unit conversion, stock decrement and the matching
 * `OUT` inventoryMovement creation for order consumption.
 *
 * Previously this logic was duplicated in PaymentService (financial settlement)
 * and OrderService.complete (operational delivery), which caused inventory to be
 * deducted twice for the same order. Both paths now route through
 * `consumeForOrder`, which is idempotent: it skips deduction when the order has
 * already been consumed (an outstanding `OUT` movement exists for the order that
 * has not been compensated by a reversal `IN`).
 */

type RecipeProductLike = {
    name: string;
    unit: string;
    baseUnit?: { abbreviation: string } | null;
    currentAverageCost?: Prisma.Decimal | number | null;
    cost?: Prisma.Decimal | number | null;
};

type RecipeLike = {
    productId: number;
    quantity: Prisma.Decimal | number | string;
    unit?: string | null;
    // Optional FK-resolved unit. When the caller includes the `unitOfMeasure`
    // relation, its abbreviation is used as a fallback for the legacy `unit`
    // string; absent it, behavior is unchanged (falls back to product.unit).
    unitOfMeasure?: { abbreviation: string } | null;
    product: RecipeProductLike;
};

type OrderItemLike = {
    id?: number;
    quantity: number;
    menuItem: { recipes: RecipeLike[] };
};

type ModifierConsumptionRow = {
    modifier: {
        name: string;
        productId: number | null;
        consumeQuantity: Prisma.Decimal | number | string | null;
        /** ADD (default/legacy) consumes extra stock; REMOVE drops/reduces a recipe line. */
        inventoryEffect?: 'ADD' | 'REMOVE' | null;
        unit: { abbreviation: string } | null;
        product: { id: number; name: string; unit: string } | null;
    };
    orderItem: { id?: number; quantity: number };
};

/** Minimal modifier shape needed to resolve a "sin X" recipe removal. */
export type RemovalModifierLike = {
    name: string;
    productId: number | null;
    consumeQuantity: Prisma.Decimal | number | string | null;
    inventoryEffect?: 'ADD' | 'REMOVE' | null;
    unit: { abbreviation: string } | null;
    product: { unit: string } | null;
};

/**
 * Per-unit removal of one recipe product on one order line. `full` drops the
 * whole line; otherwise `baseQuantity` (product base unit, per dish unit) is
 * subtracted from the recipe quantity, clamped at 0.
 */
export type RecipeRemoval = { full: boolean; baseQuantity: number };

/** orderItemId -> productId -> removal. */
export type RecipeRemovalMap = Map<number, Map<number, RecipeRemoval>>;

export function isRemovalModifier(modifier: { inventoryEffect?: string | null; productId: number | null }): boolean {
    return modifier.inventoryEffect === 'REMOVE' && !!modifier.productId;
}

/** Per-dish-unit base quantity left after applying a removal (never negative). */
export function applyRecipeRemoval(perUnitBaseQuantity: number, removal: RecipeRemoval | undefined): number {
    if (!removal) return perUnitBaseQuantity;
    if (removal.full) return 0;
    return Math.max(0, perUnitBaseQuantity - removal.baseQuantity);
}

/**
 * Stateful variant for a dish whose recipe lists the same product on several
 * lines: a partial removal applies ONCE to the product's combined quantity,
 * consumed from the lines in order and clamped at 0 (two 30 g lines minus
 * 20 g -> 10 g + 30 g, never 10 g + 10 g). `key` identifies the dish line +
 * product (e.g. `${orderItemId}:${productId}`).
 */
export function createRecipeRemovalApplier(): (
    key: string,
    perUnitBaseQuantity: number,
    removal: RecipeRemoval | undefined
) => number {
    const remaining = new Map<string, number>();
    return (key, perUnitBaseQuantity, removal) => {
        if (!removal) return perUnitBaseQuantity;
        if (removal.full) return 0;
        const budget = remaining.get(key) ?? Math.max(0, removal.baseQuantity);
        const take = Math.min(budget, Math.max(0, perUnitBaseQuantity));
        remaining.set(key, budget - take);
        return Math.max(0, perUnitBaseQuantity - take);
    };
}

export type ConsumableOrder = {
    id: number;
    userId: number;
    items: OrderItemLike[];
};

export interface ConsumeForOrderParams {
    order: ConsumableOrder;
    /**
     * Fallback warehouse (sale warehouse, or the selected waste warehouse).
     * Lines whose product/category has a routing rule in this warehouse's
     * branch (InventoryWarehouseRoute) are consumed from the routed warehouse.
     */
    warehouseId: number;
    userId: number;
    companyId: number;
    /** Override for non-sale physical consumption, e.g. prepared-order waste. */
    reference?: string;
    reason?: string;
    modifierReason?: string;
    /** Restrict linked-modifier consumption to the same selected order lines. */
    orderItemIds?: number[];
    /**
     * Sale consumption of an already-sold order must never be blocked by a
     * short balance: the stock may go negative and an alert is recorded per
     * product instead. Non-sale movements keep the strict guard.
     */
    allowNegative?: boolean;
    /**
     * Per-ingredient routing (default true). Pass `false` when the user
     * explicitly selected the warehouse (e.g. a chosen waste warehouse): every
     * line is then consumed from `warehouseId`.
     */
    route?: boolean;
    /**
     * Branch the fallback warehouse must belong to (the order's branch).
     * Re-validated under the warehouse lock, so a warehouse reassigned to
     * another branch after the caller's plain validation read is rejected.
     */
    expectedBranchId?: number | null;
    /**
     * AuditLog entity of the negative-stock alert (default `Order`). Non-order
     * consumers (catering events) pass their own entity so the alert never
     * points at an unrelated order with the same id.
     */
    alertEntityType?: string;
}

/**
 * Ingredient whose balance went below zero during an `allowNegative`
 * consumption. Quantities are in the product base unit; `available` is the
 * balance of `warehouseId` right before this consumption.
 */
export type ConsumptionShortage = {
    productId: number;
    productName: string;
    unit: string | null;
    warehouseId: number;
    required: number;
    available: number;
};

/** Action of the AuditLog row that keeps the per-line consumption snapshot. */
export const ORDER_CONSUMPTION_SNAPSHOT_ACTION = 'INVENTORY_CONSUMPTION_SNAPSHOT';

export type OrderConsumptionSnapshot = {
    reference: string;
    /** Fallback (sale) warehouse of the consumption. */
    warehouseId: number;
    items: Array<{
        orderItemId: number;
        itemQuantity: number;
        /** `warehouseId` = warehouse the line was consumed from (absent on legacy snapshots). */
        products: Array<{ productId: number; quantity: number; warehouseId?: number }>;
    }>;
};

export interface ReverseForOrderParams {
    orderId: number;
    userId: number;
    companyId: number;
    reason: string;
    sourceType: BatchSourceType;
    reversalOrigin: string;
}

export interface ReverseOrderQuantitiesParams extends ReverseForOrderParams {
    /**
     * Base quantities to restore. `warehouseId` (from the consumption snapshot)
     * restores into the warehouse the line was consumed from first; any
     * remainder falls back to the other outstanding warehouses ascending.
     */
    quantities: Array<{ productId: number; quantity: number; warehouseId?: number | null }>;
}

export type ConsumedLayer = {
    quantity: number;
    unitCost: number;
    sourceRef: string | null;
    sourceType: BatchSourceType;
    createdAt?: Date;
};

/** Parses InventoryMovement.consumedLayers JSON, dropping malformed entries. */
export function parseConsumedLayers(raw: unknown): ConsumedLayer[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((value) => {
        const layer = (value ?? {}) as Record<string, unknown>;
        return {
            quantity: Number(layer.quantity),
            unitCost: Number(layer.unitCost),
            sourceRef: typeof layer.sourceRef === 'string' ? layer.sourceRef : null,
            sourceType: typeof layer.sourceType === 'string' ? layer.sourceType as BatchSourceType : 'ADJUSTMENT' as const,
            createdAt: typeof layer.createdAt === 'string' ? new Date(layer.createdAt) : undefined
        };
    }).filter((layer) =>
        Number.isFinite(layer.quantity) && layer.quantity > 0 &&
        Number.isFinite(layer.unitCost) && layer.unitCost >= 0 &&
        (!layer.createdAt || !Number.isNaN(layer.createdAt.getTime()))
    );
}

/**
 * Proportional share of the consumed FIFO layers for a partial return of
 * `returnQuantity` out of `outQuantity` consumed. Every layer keeps its unit
 * cost, source and date; the last portion absorbs rounding so the shares sum
 * exactly to `returnQuantity`. Returns undefined (caller falls back to one
 * averaged layer) when the stored layers do not cover the OUT quantity
 * (legacy movements without exact provenance).
 *
 * Negative-stock sales DO cover their quantity: the engine records the
 * uncovered part as a `sourceRef: null` layer at its provisional cost. If
 * that deficit was covered (and trued up) before the return, re-value those
 * portions from the sale's deficit slices with `planSaleReturnFromSlices`.
 */
export function splitConsumedLayers(
    layers: ConsumedLayer[],
    outQuantity: number,
    returnQuantity: number
): ConsumedLayer[] | undefined {
    if (!(outQuantity > 0) || !(returnQuantity > 0) || layers.length === 0) return undefined;
    const layerQuantity = layers.reduce((sum, layer) => sum + layer.quantity, 0);
    if (Math.abs(layerQuantity - outQuantity) > 1e-6) return undefined;
    const ratio = Math.min(1, returnQuantity / outQuantity);
    const shares: ConsumedLayer[] = [];
    let assigned = 0;
    layers.forEach((layer, index) => {
        const quantity = index === layers.length - 1
            ? returnQuantity - assigned
            : layer.quantity * ratio;
        assigned += quantity;
        if (quantity > 1e-12) shares.push({ ...layer, quantity });
    });
    return shares.length > 0 ? shares : undefined;
}


export type SaleReturnPlan = {
    /** Layers to re-open: priced share + covered slices + open slices LAST. */
    layers: ConsumedLayer[];
    /** Re-valued minus original layer value (> 0 reverses true-up COGS). */
    adjustment: number;
    /** Open slices of the sale this return takes out of the deficit queue. */
    returnedOpenSlices: Array<{ id: number; quantity: number }>;
    /** Records the return movement on the split-off slices (call after the inbound). */
    commit: (returnMovementId: number) => Promise<void>;
};

/**
 * Prices the unbacked part (`sourceRef: null` layers) of a returned sale share
 * from that sale's own deficit slices:
 *  - covered slices come back at the real value they were charged at
 *    (coveredValue), the difference reversing the true-up COGS;
 *  - still-open slices come back at their provisional cost and leave the
 *    deficit queue (their layers go last, so the engine trims exactly them);
 *  - units without slices (legacy sales) keep their provisional layers.
 */
export async function planSaleReturnFromSlices(
    tx: Prisma.TransactionClient,
    params: {
        companyId: number;
        warehouseId: number;
        productId: number;
        saleMovementIds: number[];
        /** The share of the sale's consumed layers being returned. */
        layers: ConsumedLayer[];
    }
): Promise<SaleReturnPlan> {
    const noop: SaleReturnPlan = { layers: params.layers, adjustment: 0, returnedOpenSlices: [], commit: async () => undefined };
    const nullQty = params.layers
        .filter((layer) => layer.sourceRef == null)
        .reduce((sum, layer) => sum + layer.quantity, 0);
    if (!(nullQty > 1e-9) || params.saleMovementIds.length === 0) return noop;
    // Clients/doubles without the slice ledger keep the provisional layers.
    if (!(tx as { inventoryDeficitSlice?: unknown }).inventoryDeficitSlice) return noop;

    // Canonical order: Warehouse -> Product -> Stock -> slices.
    await InventoryEngineService.lockInventoryScope(tx, params.companyId, [params.warehouseId], [params.productId]);
    await InventoryEngineService.lockedStockQuantity(tx, params.companyId, params.warehouseId, params.productId);
    const slices = await InventoryEngineService.lockSlicesOfSales(
        tx, params.companyId, params.warehouseId, params.productId, params.saleMovementIds
    );
    if (slices.length === 0) return noop;

    // Open slices first (they leave the deficit queue), then covered ones.
    const ordered = [...slices.filter((row) => row.coveringMovementId == null), ...slices.filter((row) => row.coveringMovementId != null)];
    let remaining = nullQty;
    const coveredLayers: ConsumedLayer[] = [];
    const openLayers: ConsumedLayer[] = [];
    const returnedOpenSlices: SaleReturnPlan['returnedOpenSlices'] = [];
    const returnedSliceIds: number[] = [];
    for (const row of ordered) {
        if (!(remaining > 1e-9)) break;
        const take = Math.min(row.quantity, remaining);
        if (!(take > 1e-12)) continue;
        remaining -= take;
        if (row.coveringMovementId == null) {
            openLayers.push({ quantity: take, unitCost: row.provisionalUnitCost, sourceRef: null, sourceType: 'ADJUSTMENT' });
            returnedOpenSlices.push({ id: row.id, quantity: take });
        } else {
            const unit = row.quantity > 0 ? row.coveredValue / row.quantity : row.provisionalUnitCost;
            // Split the returned part off the live slice; its layer is tagged so
            // a later reversal of the covering inbound takes these exact units.
            const returnedId = await InventoryEngineService.splitReturnedCoveredSlice(tx, {
                ...row, companyId: params.companyId, warehouseId: params.warehouseId, productId: params.productId
            }, take);
            coveredLayers.push({
                quantity: take,
                unitCost: Math.max(0, unit),
                sourceRef: returnedId != null ? InventoryEngineService.returnedSliceSourceRef(returnedId) : null,
                sourceType: 'ADJUSTMENT'
            });
            if (returnedId != null) returnedSliceIds.push(returnedId);
        }
    }
    // Legacy remainder (no slice): keep the original provisional null layers.
    const legacyLayers: ConsumedLayer[] = [];
    for (const layer of params.layers.filter((candidate) => candidate.sourceRef == null)) {
        if (!(remaining > 1e-9)) break;
        const take = Math.min(layer.quantity, remaining);
        remaining -= take;
        legacyLayers.push({ ...layer, quantity: take });
    }
    const layers = [
        ...params.layers.filter((layer) => layer.sourceRef != null),
        ...coveredLayers,
        ...legacyLayers,
        ...openLayers
    ];
    return {
        layers,
        adjustment: layersValue(layers) - layersValue(params.layers),
        returnedOpenSlices,
        commit: async (returnMovementId: number) => {
            await InventoryEngineService.markReturnedSlices(tx, returnedSliceIds, returnMovementId);
        }
    };
}

function layersValue(layers: Array<{ quantity: number; unitCost: number }> | undefined): number {
    return (layers ?? []).reduce((sum, layer) => sum + layer.quantity * layer.unitCost, 0);
}

export class InventoryConsumptionService {
    private static orderReference(orderId: number): string {
        return `ORD-${orderId}`;
    }

    /**
     * Net base-unit quantity already consumed (OUT minus reversal IN) for an
     * order's reference. A value > 0 means stock is currently deducted.
     */
    private static async hasOutstandingConsumption(
        tx: Prisma.TransactionClient,
        companyId: number,
        reference: string
    ): Promise<boolean> {
        const movements = await tx.inventoryMovement.findMany({
            where: { companyId, reference, type: { in: ['OUT', 'IN'] } },
            select: { warehouseId: true, productId: true, type: true, quantity: true }
        });

        const netByStock = new Map<string, number>();
        for (const movement of movements) {
            const key = `${movement.warehouseId}|${movement.productId}`;
            const current = netByStock.get(key) ?? 0;
            const qty = Number(movement.quantity);
            netByStock.set(key, current + (movement.type === 'OUT' ? qty : -qty));
        }

        // Quantities from different products/warehouses are never comparable.
        // One product's compensating IN must not hide another product's open OUT.
        return [...netByStock.values()].some((quantity) => quantity > 1e-9);
    }

    /**
     * Deduct inventory for every recipe of every order item.
     *
     * Idempotent: if the order has already been consumed (and not reversed) it
     * returns early without touching stock.
     */
    static async consumeForOrder(
        tx: Prisma.TransactionClient,
        {
            order, warehouseId, userId, companyId,
            reference: requestedReference,
            reason = 'Consumo por orden',
            modifierReason = 'Consumo por modificador',
            orderItemIds,
            allowNegative = false,
            route = true,
            expectedBranchId,
            alertEntityType
        }: ConsumeForOrderParams
    ): Promise<{ consumed: boolean; negativeProductIds?: number[]; shortages?: ConsumptionShortage[] }> {
        const reference = requestedReference || this.orderReference(order.id);

        // IDEMPOTENCY GUARD: skip when stock is already deducted for this order.
        if (await this.hasOutstandingConsumption(tx, companyId, reference)) {
            return { consumed: false };
        }

        const modifierRows = await this.loadModifierConsumptions(tx, order.id, orderItemIds);
        // "Sin X" modifiers never consume: they reduce the recipe line instead.
        const removals = await this.resolveRecipeRemovals(
            tx,
            companyId,
            modifierRows.map((row) => ({ orderItemId: row.orderItem.id, modifier: row.modifier }))
        );
        const addModifierRows = modifierRows.filter((row) => !isRemovalModifier(row.modifier));
        const productIds = [...new Set([
            ...order.items.flatMap((item) => item.menuItem.recipes.map((recipe) => recipe.productId)),
            ...addModifierRows
                .filter((row) => row.modifier.productId && row.modifier.product)
                .map((row) => row.modifier.productId as number)
        ])];
        // Per-ingredient routing: each product is consumed from its branch
        // rule's warehouse (product > category), else from `warehouseId`.
        // An explicitly selected warehouse (route: false) is never re-routed.
        const routing = route
            ? await WarehouseRouteService.resolveForWarehouse(tx, companyId, warehouseId, productIds)
            : new Map<number, number>();
        // Canonical lock order: {fallback ∪ routed} Warehouses (ascending) ->
        // Products (ascending) -> Stock (inside applyMovement). This is the
        // FIRST warehouse lock of the flow: callers validate with plain reads
        // and never lock a warehouse out of ascending order before this.
        // The fallback is always in the set so a stale route can fall back to
        // it without acquiring a new warehouse lock out of order.
        const lockedWarehouseIds = [...new Set([warehouseId, ...routing.values()])].sort((a, b) => a - b);
        await InventoryEngineService.lockInventoryScope(tx, companyId, lockedWarehouseIds, productIds);
        // Re-validate under the lock (latest committed rows): the routing rules
        // and the caller's validation were plain (snapshot) reads, so a
        // warehouse may have been reassigned to another branch meanwhile.
        const locked = await this.readLockedWarehouses(tx, companyId, lockedWarehouseIds);
        const fallback = locked.get(warehouseId);
        if (expectedBranchId != null && (!fallback || fallback.branchId !== expectedBranchId || fallback.type !== 'BRANCH')) {
            throw new Error('La bodega seleccionada ya no pertenece a la sucursal de la orden; recargue e intente de nuevo');
        }
        for (const [productId, routedWarehouseId] of routing) {
            if (routedWarehouseId === warehouseId) continue;
            const routed = locked.get(routedWarehouseId);
            const stillQualifies = !!routed
                && !!fallback
                && routed.type === 'BRANCH'
                && fallback.type === 'BRANCH'
                && fallback.branchId != null
                && routed.branchId === fallback.branchId;
            // Stale rule: consume from the (already locked) fallback warehouse.
            if (!stillQualifies) routing.set(productId, warehouseId);
        }
        const warehouseFor = (productId: number) => routing.get(productId) ?? warehouseId;

        // Per-line consumed base quantities (frozen at consumption time) so a
        // later partial credit note never re-derives them from a recipe that
        // may have changed since.
        const snapshot = new Map<number, { itemQuantity: number; products: Map<number, number> }>();
        const recordSnapshot = (orderItemId: number | undefined, itemQuantity: number, productId: number, quantity: number) => {
            if (!orderItemId) return;
            const entry = snapshot.get(orderItemId) ?? { itemQuantity, products: new Map<number, number>() };
            entry.products.set(productId, (entry.products.get(productId) ?? 0) + quantity);
            snapshot.set(orderItemId, entry);
        };
        const negative = new Map<number, { productName: string; balance: number }>();
        const applyRemoval = createRecipeRemovalApplier();
        // Per warehouse+product: total required by this consumption and the
        // balance after its last movement (both under the Stock lock).
        const usage = new Map<string, { productId: number; productName: string; unit: string | null; warehouseId: number; required: number; balance: number }>();
        const trackNegative = (
            productId: number,
            productName: string,
            result: { balanceQty?: number } | undefined,
            quantity = 0,
            unit: string | null = null
        ) => {
            const balance = Number(result?.balanceQty);
            if (!Number.isFinite(balance)) return;
            const target = warehouseFor(productId);
            const key = `${target}|${productId}`;
            const entry = usage.get(key) ?? { productId, productName, unit, warehouseId: target, required: 0, balance };
            entry.required += quantity;
            entry.balance = balance;
            usage.set(key, entry);
            if (allowNegative && balance < -1e-9) {
                negative.set(productId, { productName, balance });
            }
        };

        for (const item of order.items) {
            for (const recipe of item.menuItem.recipes) {
                // Unit priority: recipe.unit -> recipe.unitId abbreviation -> product.unit.
                // Canonical resolver (blank/whitespace units fall through).
                const recipeUnit = resolveRecipeUnit(recipe, recipe.product);
                let recipeQtyBase: number;
                let originalQuantity: number | null = null;
                let originalUnit: string | null = null;
                let conversionFactor: number | null = null;

                // NOTE: do NOT silently fall back to the raw recipe quantity when a
                // conversion fails. `convert` only returns a 1:1 result when the
                // recipe unit is the product's own unit; otherwise (a base unit is
                // configured with an incompatible unit, OR a legacy product has no
                // base unit and the recipe uses a different unit) it throws. In those
                // cases deducting the raw quantity would corrupt stock (e.g. subtract
                // 200 from a stock kept in kg for a "200 g" recipe), so we surface a
                // clear error and abort the consumption transaction.
                try {
                    const conv = await UnitConversionService.convert(
                        recipe.productId,
                        companyId,
                        Number(recipe.quantity),
                        recipeUnit,
                        tx
                    );
                    recipeQtyBase = conv.baseQuantity;
                    originalQuantity = conv.originalQuantity;
                    originalUnit = conv.originalUnit;
                    conversionFactor = conv.conversionFactor;
                } catch (err) {
                    const detail = err instanceof Error ? err.message : 'conversión de unidad no válida';
                    throw new Error(
                        `No se pudo descontar inventario de "${recipe.product.name}": ${detail}. ` +
                        `Revise la unidad de la receta y la configuración de unidades del producto.`
                    );
                }

                // Apply "sin X" removals of this line (clamped at 0). The ratio
                // keeps the traceability quantity in the recipe unit consistent.
                const removal = item.id ? removals.get(item.id)?.get(recipe.productId) : undefined;
                const effectiveQtyBase = applyRemoval(`${item.id}:${recipe.productId}`, recipeQtyBase, removal);
                const ratio = recipeQtyBase > 0 ? effectiveQtyBase / recipeQtyBase : 0;
                const requiredQty = effectiveQtyBase * item.quantity;
                if (!(requiredQty > 1e-12)) {
                    // Fully removed: no movement, but keep a zero snapshot entry so
                    // a later credit note never falls back to the full recipe.
                    recordSnapshot(item.id, item.quantity, recipe.productId, 0);
                    continue;
                }

                // Stock lock, validation, costing, FIFO-layer consumption and the
                // OUT movement are all handled by the single inventory engine.
                const result = await InventoryEngineService.applyMovement(tx, {
                    type: 'OUT',
                    companyId,
                    warehouseId: warehouseFor(recipe.productId),
                    productId: recipe.productId,
                    userId,
                    quantity: requiredQty,
                    originalQuantity: originalQuantity != null ? originalQuantity * ratio * item.quantity : null,
                    originalUnit,
                    conversionFactor,
                    reason,
                    reference,
                    productName: recipe.product.name,
                    ...(allowNegative ? { allowNegative: true } : {})
                });
                recordSnapshot(item.id, item.quantity, recipe.productId, requiredQty);
                trackNegative(
                    recipe.productId, recipe.product.name, result, requiredQty,
                    recipe.product.baseUnit?.abbreviation || recipe.product.unit || null
                );
            }
        }

        // OBJETIVO 4: also consume the ingredients linked to the order's selected
        // modifiers. Re-query the OrderItemModifier rows INSIDE the tx (do not rely
        // on the passed `order` carrying them) and post one OUT per modifier whose
        // product link + consumeQuantity are configured, under the SAME ORD-{id}
        // reference so idempotency and reversal treat them like recipe consumption.
        await this.consumeModifiersForOrder(tx, {
            warehouseId,
            warehouseFor,
            userId,
            companyId,
            reference,
            reason: modifierReason,
            orderItemIds,
            allowNegative,
            onConsumed: (row, productId, quantity, result) => {
                recordSnapshot(row.orderItem.id, row.orderItem.quantity, productId, quantity);
                trackNegative(productId, row.modifier.product?.name ?? `#${productId}`, result, quantity, row.modifier.product?.unit ?? null);
            }
        }, addModifierRows);

        if (snapshot.size > 0 && reference === this.orderReference(order.id)) {
            const details: OrderConsumptionSnapshot = {
                reference,
                warehouseId,
                items: [...snapshot.entries()].map(([orderItemId, entry]) => ({
                    orderItemId,
                    itemQuantity: entry.itemQuantity,
                    products: [...entry.products.entries()].map(([productId, quantity]) => ({
                        productId, quantity, warehouseId: warehouseFor(productId)
                    }))
                }))
            };
            await tx.auditLog.create({
                data: {
                    companyId,
                    entityType: 'Order',
                    entityId: order.id,
                    action: ORDER_CONSUMPTION_SNAPSHOT_ACTION,
                    userId,
                    details: details as unknown as Prisma.InputJsonValue
                }
            });
        }

        // One alert per warehouse that went negative (routing may split them).
        const negativeByWarehouse = new Map<number, Array<{ productId: number; productName: string; balance: number }>>();
        for (const [productId, entry] of negative) {
            const target = warehouseFor(productId);
            negativeByWarehouse.set(target, [...(negativeByWarehouse.get(target) ?? []), { productId, ...entry }]);
        }
        for (const [negativeWarehouseId, products] of [...negativeByWarehouse.entries()].sort(([a], [b]) => a - b)) {
            await StockAlertService.recordNegativeSaleStock(tx, {
                companyId,
                warehouseId: negativeWarehouseId,
                userId,
                reference,
                orderId: order.id,
                ...(alertEntityType ? { entityType: alertEntityType } : {}),
                products
            });
        }

        const shortages: ConsumptionShortage[] = allowNegative
            ? [...usage.values()]
                .filter((entry) => entry.balance < -1e-9)
                .sort((a, b) => a.warehouseId - b.warehouseId || a.productId - b.productId)
                .map((entry) => ({
                    productId: entry.productId,
                    productName: entry.productName,
                    unit: entry.unit,
                    warehouseId: entry.warehouseId,
                    required: entry.required,
                    available: entry.balance + entry.required
                }))
            : [];

        return { consumed: true, negativeProductIds: [...negative.keys()], shortages };
    }

    /**
     * Branch/type of warehouses the caller already holds (lockInventoryScope),
     * read with a locking read so it returns the latest committed row, not the
     * transaction snapshot. Re-locking a held row takes no new lock. Test
     * doubles (and only they) return no rows: fall back to a plain read.
     */
    private static async readLockedWarehouses(
        tx: Prisma.TransactionClient,
        companyId: number,
        warehouseIds: number[]
    ): Promise<Map<number, { branchId: number | null; type: string }>> {
        const result = new Map<number, { branchId: number | null; type: string }>();
        const findFirst = (tx as unknown as { warehouse?: { findFirst?: unknown } }).warehouse?.findFirst;
        const hasRawQuery = typeof (tx as unknown as { $queryRaw?: unknown }).$queryRaw === 'function';
        for (const id of warehouseIds) {
            const rows = hasRawQuery ? await tx.$queryRaw<Array<{ id: number; branchId: number | null; type: string }>>`SELECT id, branchId, type FROM \`Warehouse\` WHERE id = ${id} AND companyId = ${companyId} LOCK IN SHARE MODE` : [];
            const row = Array.isArray(rows) ? rows[0] : undefined;
            if (row && row.type != null) {
                result.set(id, { branchId: row.branchId == null ? null : Number(row.branchId), type: String(row.type) });
                continue;
            }
            if (typeof findFirst !== 'function') continue;
            const plain = await tx.warehouse.findFirst({
                where: { id, companyId },
                select: { branchId: true, type: true }
            });
            if (plain) result.set(id, { branchId: plain.branchId ?? null, type: String(plain.type) });
        }
        return result;
    }

    /**
     * Latest per-line consumption snapshot of a sale order, or null for
     * legacy orders consumed before snapshots existed.
     */
    static async getConsumptionSnapshot(
        tx: Prisma.TransactionClient,
        companyId: number,
        orderId: number
    ): Promise<OrderConsumptionSnapshot | null> {
        const row = await tx.auditLog.findFirst({
            where: { companyId, entityType: 'Order', entityId: orderId, action: ORDER_CONSUMPTION_SNAPSHOT_ACTION },
            orderBy: { id: 'desc' },
            select: { details: true }
        });
        const details = row?.details as unknown;
        if (!details || typeof details !== 'object' || !Array.isArray((details as OrderConsumptionSnapshot).items)) {
            return null;
        }
        const items = (details as OrderConsumptionSnapshot).items.filter((item) =>
            Number.isInteger(item?.orderItemId)
            && Number.isFinite(Number(item?.itemQuantity)) && Number(item.itemQuantity) > 0
            && Array.isArray(item.products)
            && item.products.every((product) =>
                Number.isInteger(product?.productId) && Number.isFinite(Number(product?.quantity)) && Number(product.quantity) >= 0)
        );
        return { ...(details as OrderConsumptionSnapshot), items };
    }

    /**
     * Consume inventory for the ingredient-linked modifiers selected on an order.
     * Each consuming modifier deducts `consumeQuantity` (in its `unit`, or the
     * linked product's base unit) times the OrderItem quantity, valued and layered
     * through the inventory engine under the order's stable reference.
     */
    private static async consumeModifiersForOrder(
        tx: Prisma.TransactionClient,
        ctx: {
            warehouseId: number;
            /** Routed warehouse per product (defaults to `warehouseId`). */
            warehouseFor?: (productId: number) => number;
            userId: number;
            companyId: number;
            reference: string;
            reason: string;
            orderItemIds?: number[];
            allowNegative?: boolean;
            onConsumed?: (
                row: ModifierConsumptionRow,
                productId: number,
                quantity: number,
                result: { balanceQty?: number } | undefined
            ) => void;
        },
        orderItemModifiers: ModifierConsumptionRow[]
    ): Promise<void> {
        if (ctx.orderItemIds && ctx.orderItemIds.length === 0) return;

        for (const oim of orderItemModifiers) {
            const modifier = oim.modifier;
            if (!modifier.productId || !modifier.product) continue;
            if (isRemovalModifier(modifier)) continue;

            const consumeQuantity = Number(modifier.consumeQuantity ?? 0);
            if (!(consumeQuantity > 0)) continue;

            const unitAbbreviation = modifier.unit?.abbreviation || modifier.product.unit;

            let baseQuantity: number;
            let originalQuantity: number | null = null;
            let originalUnit: string | null = null;
            let conversionFactor: number | null = null;
            try {
                const conv = await UnitConversionService.convert(
                    modifier.productId,
                    ctx.companyId,
                    consumeQuantity,
                    unitAbbreviation,
                    tx
                );
                baseQuantity = conv.baseQuantity;
                originalQuantity = conv.originalQuantity;
                originalUnit = conv.originalUnit;
                conversionFactor = conv.conversionFactor;
            } catch (err) {
                const detail = err instanceof Error ? err.message : 'conversión de unidad no válida';
                throw new Error(
                    `No se pudo descontar inventario del modificador "${modifier.name}": ${detail}. ` +
                    `Revise la unidad del modificador y la configuración de unidades del producto.`
                );
            }

            const requiredQty = baseQuantity * oim.orderItem.quantity;
            if (!(requiredQty > 0)) continue;

            const result = await InventoryEngineService.applyMovement(tx, {
                type: 'OUT',
                companyId: ctx.companyId,
                warehouseId: ctx.warehouseFor?.(modifier.productId) ?? ctx.warehouseId,
                productId: modifier.productId,
                userId: ctx.userId,
                quantity: requiredQty,
                originalQuantity: originalQuantity != null ? originalQuantity * oim.orderItem.quantity : null,
                originalUnit,
                conversionFactor,
                reason: ctx.reason,
                reference: ctx.reference,
                productName: modifier.product.name,
                ...(ctx.allowNegative ? { allowNegative: true } : {})
            });
            ctx.onConsumed?.(oim, modifier.productId, requiredQty, result);
        }
    }

    /**
     * Resolves the "sin X" (REMOVE) modifiers selected on order lines into
     * per-dish-unit base-quantity reductions of the matching recipe product.
     * A REMOVE modifier without consumeQuantity drops the whole line; several
     * partial removals of the same product add up; a full removal wins.
     * Shared by sale consumption, prepared-order waste and the legacy
     * credit-note fallback so all paths agree.
     */
    static async resolveRecipeRemovals(
        tx: Prisma.TransactionClient,
        companyId: number,
        rows: Array<{ orderItemId?: number; modifier: RemovalModifierLike }>
    ): Promise<RecipeRemovalMap> {
        const removals: RecipeRemovalMap = new Map();
        for (const row of rows) {
            const modifier = row.modifier;
            if (!row.orderItemId || !isRemovalModifier(modifier)) continue;
            const productId = modifier.productId as number;
            const byProduct = removals.get(row.orderItemId) ?? new Map<number, RecipeRemoval>();
            const current = byProduct.get(productId) ?? { full: false, baseQuantity: 0 };
            const quantity = Number(modifier.consumeQuantity ?? 0);
            if (!(quantity > 0)) {
                current.full = true;
            } else {
                const unit = modifier.unit?.abbreviation || modifier.product?.unit || '';
                try {
                    const conv = await UnitConversionService.convert(productId, companyId, quantity, unit, tx);
                    current.baseQuantity += conv.baseQuantity;
                } catch (err) {
                    const detail = err instanceof Error ? err.message : 'conversión de unidad no válida';
                    throw new Error(
                        `No se pudo aplicar el modificador "${modifier.name}": ${detail}. ` +
                        `Revise la unidad del modificador y la configuración de unidades del producto.`
                    );
                }
            }
            byProduct.set(productId, current);
            removals.set(row.orderItemId, byProduct);
        }
        return removals;
    }

    private static async loadModifierConsumptions(
        tx: Prisma.TransactionClient,
        orderId: number,
        orderItemIds?: number[]
    ): Promise<ModifierConsumptionRow[]> {
        if (orderItemIds && orderItemIds.length === 0) return [];
        return tx.orderItemModifier.findMany({
            where: {
                orderItem: {
                    orderId,
                    ...(orderItemIds ? { id: { in: orderItemIds } } : {})
                }
            },
            select: {
                modifier: {
                    select: {
                        name: true,
                        productId: true,
                        consumeQuantity: true,
                        inventoryEffect: true,
                        unit: { select: { abbreviation: true } },
                        product: { select: { id: true, name: true, unit: true } }
                    }
                },
                orderItem: { select: { id: true, quantity: true } }
            }
        }) as Promise<ModifierConsumptionRow[]>;
    }

    /**
     * Reverse a previous order consumption by restoring the net deducted stock
     * and recording compensating `IN` movements. After a full reversal the
     * idempotency guard in `consumeForOrder` no longer treats the order as
     * consumed, so a later re-payment will deduct again.
     */
    static async reverseForOrder(
        tx: Prisma.TransactionClient,
        { orderId, userId, companyId, reason, sourceType, reversalOrigin }: ReverseForOrderParams
    ): Promise<{ reversed: boolean }> {
        if (!reason?.trim()) throw new Error('El motivo de reversa de inventario es requerido');
        if (!reversalOrigin?.trim()) throw new Error('El origen de reversa de inventario es requerido');
        const reference = this.orderReference(orderId);

        const movements = await tx.inventoryMovement.findMany({
            where: { companyId, reference, type: { in: ['OUT', 'IN'] } },
            select: {
                id: true,
                warehouseId: true,
                productId: true,
                type: true,
                quantity: true,
                unitCost: true,
                totalCost: true,
                balanceQty: true,
                consumedLayers: true
            }
        });

        // Aggregate outstanding (un-reversed) consumption per warehouse + product.
        const net = new Map<string, {
            warehouseId: number;
            productId: number;
            quantity: number;
            value: number;
            outQuantity: number;
            layers: ConsumedLayer[];
            outs: Array<{ id: number; quantity: number; balanceQty: unknown; layers: ConsumedLayer[] }>;
        }>();
        for (const m of movements) {
            const key = `${m.warehouseId}|${m.productId}`;
            const movementQuantity = Number(m.quantity);
            if (!Number.isFinite(movementQuantity) || movementQuantity < 0) {
                throw new Error(`El movimiento de inventario ${m.id} tiene una cantidad inválida; requiere remediación manual`);
            }
            const delta = m.type === 'OUT' ? movementQuantity : -movementQuantity;
            const explicitTotal = m.totalCost == null ? null : Number(m.totalCost);
            const explicitUnit = m.unitCost == null ? null : Number(m.unitCost);
            let movementValue: number;
            if (explicitTotal != null && Number.isFinite(explicitTotal) && explicitTotal >= 0) {
                movementValue = explicitTotal;
            } else if (explicitUnit != null && Number.isFinite(explicitUnit) && explicitUnit >= 0) {
                // Legacy rows may lack totalCost but still retain an authoritative
                // unit cost. Reconstruct only from those two persisted fields.
                movementValue = movementQuantity * explicitUnit;
            } else {
                throw new Error(
                    `El movimiento de inventario ${m.id} no tiene costo total ni unitario íntegro; requiere remediación manual`
                );
            }
            const valueDelta = m.type === 'OUT' ? movementValue : -movementValue;
            const storedLayers = m.type === 'OUT' && Array.isArray(m.consumedLayers)
                ? m.consumedLayers.map((raw) => {
                    const layer = raw as Record<string, unknown>;
                    return {
                        quantity: Number(layer.quantity),
                        unitCost: Number(layer.unitCost),
                        sourceRef: typeof layer.sourceRef === 'string' ? layer.sourceRef : null,
                        sourceType: typeof layer.sourceType === 'string'
                            ? layer.sourceType as BatchSourceType
                            : 'ADJUSTMENT' as const,
                        createdAt: typeof layer.createdAt === 'string' ? new Date(layer.createdAt) : undefined
                    };
                }).filter((layer) =>
                    Number.isFinite(layer.quantity) && layer.quantity > 0 &&
                    Number.isFinite(layer.unitCost) && layer.unitCost >= 0 &&
                    (!layer.createdAt || !Number.isNaN(layer.createdAt.getTime()))
                )
                : [];
            const out = m.type === 'OUT'
                ? [{ id: m.id, quantity: movementQuantity, balanceQty: m.balanceQty, layers: storedLayers }]
                : [];
            const entry = net.get(key);
            if (entry) {
                entry.quantity += delta;
                entry.value += valueDelta;
                entry.layers.push(...storedLayers);
                if (m.type === 'OUT') entry.outQuantity += movementQuantity;
                entry.outs.push(...out);
            } else {
                net.set(key, {
                    warehouseId: m.warehouseId,
                    productId: m.productId,
                    quantity: delta,
                    value: valueDelta,
                    outQuantity: m.type === 'OUT' ? movementQuantity : 0,
                    layers: storedLayers,
                    outs: out
                });
            }
        }

        const outstanding = [...net.values()]
            .filter((entry) => entry.quantity > 1e-9)
            .sort((a, b) => a.productId - b.productId || a.warehouseId - b.warehouseId);
        // Canonical lock order: Warehouses -> Products (ascending) -> Stock.
        await InventoryEngineService.lockInventoryScope(
            tx,
            companyId,
            outstanding.map((entry) => entry.warehouseId),
            outstanding.map((entry) => entry.productId)
        );

        let reversed = false;
        for (const entry of outstanding) {
            // Restore the outstanding value, not the unit cost of whichever OUT
            // happened to be read last. The same product can be consumed by several
            // order lines/layers at different costs; using the last cost corrupts
            // inventory valuation on reversal.
            const unitCost = Math.max(0, entry.value / entry.quantity);
            // Exact provenance of what is still outstanding (the whole sale, or
            // the share left after earlier partial returns). Units sold on a
            // negative balance are priced from the sale's own deficit slices.
            const share = splitConsumedLayers(entry.layers, entry.outQuantity, entry.quantity);
            const plan = share
                ? await planSaleReturnFromSlices(tx, {
                    companyId, warehouseId: entry.warehouseId, productId: entry.productId,
                    saleMovementIds: entry.outs.map((out) => out.id), layers: share
                })
                : null;
            const exactLayers = plan?.layers;
            const adjustment = plan && Math.abs(plan.adjustment) > 1e-9 ? plan.adjustment : 0;
            const hasAdjustment = adjustment !== 0;
            const restoredUnitCost = unitCost + adjustment / entry.quantity;
            const previousGlobalStock = await this.globalStock(tx, entry.productId, companyId);
            const result = await InventoryEngineService.applyMovement(tx, {
                type: 'IN',
                companyId,
                warehouseId: entry.warehouseId,
                productId: entry.productId,
                userId,
                quantity: entry.quantity,
                unitCost,
                inboundLayers: exactLayers,
                ...(hasAdjustment ? { restoredValueAdjustment: adjustment } : {}),
                ...(plan?.returnedOpenSlices.length ? { returnedOpenSlices: plan.returnedOpenSlices } : {}),
                reason: `${reason.trim()} [${reversalOrigin.trim()}]`,
                reference,
                sourceType: exactLayers ? undefined : sourceType,
                origin: 'REVERSAL',
                reversalGroupId: reversalOrigin.trim(),
                reversalKey: `${reversalOrigin.trim()}:${entry.productId}:${entry.warehouseId}`
            });
            await plan?.commit(result.movementId);
            await this.foldReversalCost(
                tx, companyId, entry.productId, entry.quantity, previousGlobalStock, result,
                hasAdjustment ? restoredUnitCost : undefined
            );
            reversed = true;
        }

        return { reversed };
    }

    /**
     * Restores only the requested base-unit quantities from an order's open
     * consumption. Used by partial fiscal returns: it never infers a percentage
     * from money and never restores more than the still-outstanding ORD ledger.
     */
    static async reverseQuantitiesForOrder(
        tx: Prisma.TransactionClient,
        { orderId, userId, companyId, reason, sourceType, reversalOrigin, quantities }: ReverseOrderQuantitiesParams
    ): Promise<{ reversed: boolean }> {
        if (!reason?.trim()) throw new Error('El motivo de reversa de inventario es requerido');
        if (!reversalOrigin?.trim()) throw new Error('El origen de reversa de inventario es requerido');
        if (!Array.isArray(quantities) || quantities.length === 0) return { reversed: false };

        const requested = new Map<number, number>();
        // productId -> preferred warehouse -> quantity (the warehouse each line
        // was actually consumed from, per the consumption snapshot).
        const preferred = new Map<number, Map<number, number>>();
        for (const row of quantities) {
            if (!Number.isInteger(row.productId) || row.productId <= 0 || !Number.isFinite(row.quantity) || row.quantity <= 0) {
                throw new Error('La cantidad parcial a devolver es inválida');
            }
            requested.set(row.productId, (requested.get(row.productId) || 0) + row.quantity);
            const preferredWarehouse = Number(row.warehouseId);
            if (Number.isInteger(preferredWarehouse) && preferredWarehouse > 0) {
                const byWarehouse = preferred.get(row.productId) ?? new Map<number, number>();
                byWarehouse.set(preferredWarehouse, (byWarehouse.get(preferredWarehouse) || 0) + row.quantity);
                preferred.set(row.productId, byWarehouse);
            }
        }

        const reference = this.orderReference(orderId);
        const movements = await tx.inventoryMovement.findMany({
            where: { companyId, reference, type: { in: ['OUT', 'IN'] } },
            select: {
                id: true, warehouseId: true, productId: true, type: true,
                quantity: true, unitCost: true, totalCost: true, balanceQty: true, consumedLayers: true
            }
        });
        const outstanding = new Map<string, {
            warehouseId: number;
            productId: number;
            quantity: number;
            value: number;
            /** Gross OUT quantity and the FIFO layers those OUTs consumed. */
            outQuantity: number;
            layers: ConsumedLayer[];
            outs: Array<{ id: number; quantity: number; balanceQty: unknown; layers: ConsumedLayer[] }>;
        }>();
        for (const movement of movements) {
            const quantity = Number(movement.quantity);
            const totalCost = movement.totalCost == null ? null : Number(movement.totalCost);
            const unitCost = movement.unitCost == null ? null : Number(movement.unitCost);
            if (!Number.isFinite(quantity) || quantity < 0) {
                throw new Error(`El movimiento de inventario ${movement.id} tiene una cantidad inválida; requiere remediación manual`);
            }
            const value = totalCost != null && Number.isFinite(totalCost) && totalCost >= 0
                ? totalCost
                : unitCost != null && Number.isFinite(unitCost) && unitCost >= 0
                    ? unitCost * quantity
                    : Number.NaN;
            if (!Number.isFinite(value)) {
                throw new Error(`El movimiento de inventario ${movement.id} no tiene costo íntegro; requiere remediación manual`);
            }
            const sign = movement.type === 'OUT' ? 1 : -1;
            const key = `${movement.productId}|${movement.warehouseId}`;
            const current = outstanding.get(key) || {
                warehouseId: movement.warehouseId,
                productId: movement.productId,
                quantity: 0,
                value: 0,
                outQuantity: 0,
                layers: [] as ConsumedLayer[],
                outs: [] as Array<{ id: number; quantity: number; balanceQty: unknown; layers: ConsumedLayer[] }>
            };
            current.quantity += sign * quantity;
            current.value += sign * value;
            if (movement.type === 'OUT') {
                const layers = parseConsumedLayers(movement.consumedLayers);
                current.outQuantity += quantity;
                current.layers.push(...layers);
                current.outs.push({ id: movement.id, quantity, balanceQty: movement.balanceQty, layers });
            }
            outstanding.set(key, current);
        }

        for (const [productId, requestedQuantity] of requested) {
            const available = [...outstanding.values()]
                .filter((entry) => entry.productId === productId && entry.quantity > 1e-9)
                .reduce((sum, entry) => sum + entry.quantity, 0);
            if (requestedQuantity - available > 1e-6) {
                throw new Error(`La devolución parcial excede el consumo pendiente del producto #${productId}`);
            }
        }
        // Canonical lock order: Warehouses -> Products (ascending) -> Stock.
        await InventoryEngineService.lockInventoryScope(
            tx,
            companyId,
            [...outstanding.values()]
                .filter((entry) => requested.has(entry.productId) && entry.quantity > 1e-9)
                .map((entry) => entry.warehouseId),
            requested.keys()
        );

        // Under FIFO a partial return re-opens the originally consumed layers
        // (proportional share of each, keeping cost and age) instead of one
        // averaged layer dated now. WA keeps the averaged single layer.
        const fifoByWarehouse = new Map<number, boolean>();

        let reversed = false;
        for (const [productId, requestedQuantity] of [...requested.entries()].sort(([a], [b]) => a - b)) {
            let remaining = requestedQuantity;
            const entries = [...outstanding.values()]
                .filter((entry) => entry.productId === productId && entry.quantity > 1e-9)
                .sort((a, b) => a.warehouseId - b.warehouseId);
            // Allocation: the preferred (consumed-from) warehouses first, capped
            // at what each still has outstanding; any remainder ascending. The
            // inbounds themselves are applied in ascending warehouse order.
            const allocated = new Map<number, number>();
            let unallocated = requestedQuantity;
            const preferredRows = [...(preferred.get(productId) ?? new Map<number, number>()).entries()].sort(([a], [b]) => a - b);
            for (const [preferredWarehouse, preferredQuantity] of preferredRows) {
                const entry = entries.find((candidate) => candidate.warehouseId === preferredWarehouse);
                if (!entry) continue;
                const take = Math.min(preferredQuantity, entry.quantity - (allocated.get(entry.warehouseId) ?? 0), unallocated);
                if (take <= 1e-9) continue;
                allocated.set(entry.warehouseId, (allocated.get(entry.warehouseId) ?? 0) + take);
                unallocated -= take;
            }
            for (const entry of entries) {
                if (unallocated <= 1e-9) break;
                const take = Math.min(entry.quantity - (allocated.get(entry.warehouseId) ?? 0), unallocated);
                if (take <= 1e-9) continue;
                allocated.set(entry.warehouseId, (allocated.get(entry.warehouseId) ?? 0) + take);
                unallocated -= take;
            }
            for (const entry of entries) {
                if (remaining <= 1e-9) break;
                const share = allocated.get(entry.warehouseId) ?? 0;
                if (share <= 1e-9) continue;
                // Method in force for this warehouse, read under its lock.
                if (!fifoByWarehouse.has(entry.warehouseId)) {
                    fifoByWarehouse.set(entry.warehouseId, (await InventoryEngineService.readWarehouseCostingMethod(
                        tx, companyId, entry.warehouseId
                    )) === 'FIFO');
                }
                const isFifo = fifoByWarehouse.get(entry.warehouseId) === true;
                const quantity = Math.min(entry.quantity, share, remaining);
                const unitCost = entry.quantity > 0 ? Math.max(0, entry.value / entry.quantity) : 0;
                // Proportional share of the consumed layers; units sold on a
                // negative balance are priced from the sale's deficit slices.
                const originalShare = splitConsumedLayers(entry.layers, entry.outQuantity, quantity);
                const plan = originalShare
                    ? await planSaleReturnFromSlices(tx, {
                        companyId, warehouseId: entry.warehouseId, productId,
                        saleMovementIds: entry.outs.map((out) => out.id), layers: originalShare
                    })
                    : null;
                const adjustment = plan && Math.abs(plan.adjustment) > 1e-9 ? plan.adjustment : 0;
                const hasAdjustment = adjustment !== 0;
                const slicesInvolved = hasAdjustment || (plan?.returnedOpenSlices.length ?? 0) > 0;
                const inboundLayers = isFifo || slicesInvolved ? plan?.layers : undefined;
                // With exact provenance the layers value the entry (FIFO); when
                // slices re-price the share, the movement keeps the value of the
                // sale share and the difference is a COST_TRUE_UP reversal.
                const valuation = slicesInvolved && inboundLayers
                    ? {
                        inboundLayers,
                        unitCost: isFifo ? layersValue(originalShare) / quantity : unitCost,
                        ...(hasAdjustment ? { restoredValueAdjustment: adjustment } : {}),
                        ...(plan?.returnedOpenSlices.length ? { returnedOpenSlices: plan.returnedOpenSlices } : {})
                    }
                    : inboundLayers ? { inboundLayers } : { unitCost, sourceType };
                const previousGlobalStock = await this.globalStock(tx, productId, companyId);
                const result = await InventoryEngineService.applyMovement(tx, {
                    type: 'IN',
                    companyId,
                    warehouseId: entry.warehouseId,
                    productId,
                    userId,
                    quantity,
                    ...valuation,
                    reason: `${reason.trim()} [${reversalOrigin.trim()}]`,
                    reference,
                    origin: 'REVERSAL',
                    reversalGroupId: reversalOrigin.trim(),
                    reversalKey: `${reversalOrigin.trim()}:${productId}:${entry.warehouseId}`
                });
                await plan?.commit(result.movementId);
                await this.foldReversalCost(
                    tx, companyId, productId, quantity, previousGlobalStock, result,
                    hasAdjustment ? ((Number(result.totalCost) + adjustment) / quantity) : undefined
                );
                remaining -= quantity;
                reversed = true;
            }
            if (remaining > 1e-6) {
                throw new Error(`No se pudo conciliar la devolución parcial del producto #${productId}`);
            }
        }
        return { reversed };
    }

    private static async globalStock(tx: Prisma.TransactionClient, productId: number, companyId: number) {
        const global = await tx.stock.aggregate({
            where: { productId, companyId },
            _sum: { quantity: true }
        });
        return Number(global._sum.quantity ?? 0);
    }

    /**
     * A reversal re-enters stock at the value it left with. Like every other
     * valued inbound (receipts, production, manual IN, movement reversals), it
     * must be folded into Product.currentAverageCost; otherwise later WA outflows
     * keep using an average that no longer matches the restored stock value.
     */
    private static async foldReversalCost(
        tx: Prisma.TransactionClient,
        companyId: number,
        productId: number,
        quantity: number,
        previousGlobalStock: number,
        result: { movementId?: number; unitCost?: number } | undefined,
        /** Restored unit cost when it differs from the movement value (re-valued deficit). */
        restoredUnitCost?: number
    ) {
        if (!result?.movementId || result.unitCost == null || !Number.isFinite(Number(result.unitCost))) return;
        await CostingService.applyProductionCost(
            tx,
            productId,
            companyId,
            quantity,
            restoredUnitCost != null && Number.isFinite(restoredUnitCost) ? restoredUnitCost : Number(result.unitCost),
            previousGlobalStock,
            undefined,
            result.movementId
        );
    }
}
