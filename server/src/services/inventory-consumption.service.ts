import type { Prisma } from '@prisma/client';
import { UnitConversionService } from './unit-conversion.service';
import { InventoryEngineService, type BatchSourceType } from './inventory-engine.service';

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
        unit: { abbreviation: string } | null;
        product: { id: number; name: string; unit: string } | null;
    };
    orderItem: { quantity: number };
};

export type ConsumableOrder = {
    id: number;
    userId: number;
    items: OrderItemLike[];
};

export interface ConsumeForOrderParams {
    order: ConsumableOrder;
    warehouseId: number;
    userId: number;
    companyId: number;
    /** Override for non-sale physical consumption, e.g. prepared-order waste. */
    reference?: string;
    reason?: string;
    modifierReason?: string;
    /** Restrict linked-modifier consumption to the same selected order lines. */
    orderItemIds?: number[];
}

export interface ReverseForOrderParams {
    orderId: number;
    userId: number;
    companyId: number;
    reason: string;
    sourceType: BatchSourceType;
    reversalOrigin: string;
}

export interface ReverseOrderQuantitiesParams extends ReverseForOrderParams {
    quantities: Array<{ productId: number; quantity: number }>;
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
            orderItemIds
        }: ConsumeForOrderParams
    ): Promise<{ consumed: boolean }> {
        const reference = requestedReference || this.orderReference(order.id);

        // IDEMPOTENCY GUARD: skip when stock is already deducted for this order.
        if (await this.hasOutstandingConsumption(tx, companyId, reference)) {
            return { consumed: false };
        }

        const modifierRows = await this.loadModifierConsumptions(tx, order.id, orderItemIds);
        const productIds = [...new Set([
            ...order.items.flatMap((item) => item.menuItem.recipes.map((recipe) => recipe.productId)),
            ...modifierRows
                .filter((row) => row.modifier.productId && row.modifier.product)
                .map((row) => row.modifier.productId as number)
        ])].sort((a, b) => a - b);
        for (const productId of productIds) {
            await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${productId} AND companyId = ${companyId} FOR UPDATE`;
        }

        for (const item of order.items) {
            for (const recipe of item.menuItem.recipes) {
                // Unit priority: recipe.unit -> recipe.unitId abbreviation -> product.unit.
                const recipeUnit = recipe.unit
                    || recipe.unitOfMeasure?.abbreviation
                    || recipe.product.baseUnit?.abbreviation
                    || recipe.product.unit;
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

                const requiredQty = recipeQtyBase * item.quantity;

                // Stock lock, validation, costing, FIFO-layer consumption and the
                // OUT movement are all handled by the single inventory engine.
                await InventoryEngineService.applyMovement(tx, {
                    type: 'OUT',
                    companyId,
                    warehouseId,
                    productId: recipe.productId,
                    userId,
                    quantity: requiredQty,
                    originalQuantity: originalQuantity != null ? originalQuantity * item.quantity : null,
                    originalUnit,
                    conversionFactor,
                    reason,
                    reference,
                    productName: recipe.product.name
                });
            }
        }

        // OBJETIVO 4: also consume the ingredients linked to the order's selected
        // modifiers. Re-query the OrderItemModifier rows INSIDE the tx (do not rely
        // on the passed `order` carrying them) and post one OUT per modifier whose
        // product link + consumeQuantity are configured, under the SAME ORD-{id}
        // reference so idempotency and reversal treat them like recipe consumption.
        await this.consumeModifiersForOrder(tx, {
            warehouseId,
            userId,
            companyId,
            reference,
            reason: modifierReason,
            orderItemIds
        }, modifierRows);

        return { consumed: true };
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
            userId: number;
            companyId: number;
            reference: string;
            reason: string;
            orderItemIds?: number[];
        },
        orderItemModifiers: ModifierConsumptionRow[]
    ): Promise<void> {
        if (ctx.orderItemIds && ctx.orderItemIds.length === 0) return;

        for (const oim of orderItemModifiers) {
            const modifier = oim.modifier;
            if (!modifier.productId || !modifier.product) continue;

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

            await InventoryEngineService.applyMovement(tx, {
                type: 'OUT',
                companyId: ctx.companyId,
                warehouseId: ctx.warehouseId,
                productId: modifier.productId,
                userId: ctx.userId,
                quantity: requiredQty,
                originalQuantity: originalQuantity != null ? originalQuantity * oim.orderItem.quantity : null,
                originalUnit,
                conversionFactor,
                reason: ctx.reason,
                reference: ctx.reference,
                productName: modifier.product.name
            });
        }
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
                        unit: { select: { abbreviation: true } },
                        product: { select: { id: true, name: true, unit: true } }
                    }
                },
                orderItem: { select: { quantity: true } }
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
                consumedLayers: true
            }
        });

        // Aggregate outstanding (un-reversed) consumption per warehouse + product.
        const net = new Map<string, {
            warehouseId: number;
            productId: number;
            quantity: number;
            value: number;
            layers: Array<{
                quantity: number;
                unitCost: number;
                sourceRef: string | null;
                sourceType: BatchSourceType;
                createdAt?: Date;
            }>;
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
            const entry = net.get(key);
            if (entry) {
                entry.quantity += delta;
                entry.value += valueDelta;
                entry.layers.push(...storedLayers);
            } else {
                net.set(key, {
                    warehouseId: m.warehouseId,
                    productId: m.productId,
                    quantity: delta,
                    value: valueDelta,
                    layers: storedLayers
                });
            }
        }

        const outstanding = [...net.values()]
            .filter((entry) => entry.quantity > 1e-9)
            .sort((a, b) => a.productId - b.productId || a.warehouseId - b.warehouseId);
        for (const productId of [...new Set(outstanding.map((entry) => entry.productId))]) {
            await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${productId} AND companyId = ${companyId} FOR UPDATE`;
        }

        let reversed = false;
        for (const entry of outstanding) {
            // Restore the outstanding value, not the unit cost of whichever OUT
            // happened to be read last. The same product can be consumed by several
            // order lines/layers at different costs; using the last cost corrupts
            // inventory valuation on reversal.
            const unitCost = Math.max(0, entry.value / entry.quantity);
            const layerQuantity = entry.layers.reduce((sum, layer) => sum + layer.quantity, 0);
            const exactLayers = Math.abs(layerQuantity - entry.quantity) <= 1e-6
                ? entry.layers
                : undefined;
            await InventoryEngineService.applyMovement(tx, {
                type: 'IN',
                companyId,
                warehouseId: entry.warehouseId,
                productId: entry.productId,
                userId,
                quantity: entry.quantity,
                unitCost,
                inboundLayers: exactLayers,
                reason: `${reason.trim()} [${reversalOrigin.trim()}]`,
                reference,
                sourceType: exactLayers ? undefined : sourceType,
                origin: 'REVERSAL',
                reversalGroupId: reversalOrigin.trim(),
                reversalKey: `${reversalOrigin.trim()}:${entry.productId}:${entry.warehouseId}`
            });
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
        for (const row of quantities) {
            if (!Number.isInteger(row.productId) || row.productId <= 0 || !Number.isFinite(row.quantity) || row.quantity <= 0) {
                throw new Error('La cantidad parcial a devolver es inválida');
            }
            requested.set(row.productId, (requested.get(row.productId) || 0) + row.quantity);
        }

        const reference = this.orderReference(orderId);
        const movements = await tx.inventoryMovement.findMany({
            where: { companyId, reference, type: { in: ['OUT', 'IN'] } },
            select: { id: true, warehouseId: true, productId: true, type: true, quantity: true, unitCost: true, totalCost: true }
        });
        const outstanding = new Map<string, {
            warehouseId: number;
            productId: number;
            quantity: number;
            value: number;
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
                value: 0
            };
            current.quantity += sign * quantity;
            current.value += sign * value;
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
        for (const productId of [...requested.keys()].sort((a, b) => a - b)) {
            await tx.$queryRaw`SELECT id FROM \`Product\` WHERE id = ${productId} AND companyId = ${companyId} FOR UPDATE`;
        }

        let reversed = false;
        for (const [productId, requestedQuantity] of [...requested.entries()].sort(([a], [b]) => a - b)) {
            let remaining = requestedQuantity;
            const entries = [...outstanding.values()]
                .filter((entry) => entry.productId === productId && entry.quantity > 1e-9)
                .sort((a, b) => a.warehouseId - b.warehouseId);
            for (const entry of entries) {
                if (remaining <= 1e-9) break;
                const quantity = Math.min(entry.quantity, remaining);
                const unitCost = entry.quantity > 0 ? Math.max(0, entry.value / entry.quantity) : 0;
                await InventoryEngineService.applyMovement(tx, {
                    type: 'IN',
                    companyId,
                    warehouseId: entry.warehouseId,
                    productId,
                    userId,
                    quantity,
                    unitCost,
                    reason: `${reason.trim()} [${reversalOrigin.trim()}]`,
                    reference,
                    sourceType,
                    origin: 'REVERSAL',
                    reversalGroupId: reversalOrigin.trim(),
                    reversalKey: `${reversalOrigin.trim()}:${productId}:${entry.warehouseId}`
                });
                remaining -= quantity;
                reversed = true;
            }
            if (remaining > 1e-6) {
                throw new Error(`No se pudo conciliar la devolución parcial del producto #${productId}`);
            }
        }
        return { reversed };
    }
}
