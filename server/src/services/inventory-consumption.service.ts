import type { Prisma } from '@prisma/client';
import { UnitConversionService } from './unit-conversion.service';
import { InventoryEngineService } from './inventory-engine.service';

/**
 * Centralizes recipe -> base-unit conversion, stock decrement and the matching
 * `OUT` inventoryMovement creation for order consumption.
 *
 * Previously this logic was duplicated in PaymentService (PAID auto-deduct) and
 * OrderService.complete (PAID -> DELIVERED), which caused inventory to be
 * deducted twice for the same order. Both paths now route through
 * `consumeForOrder`, which is idempotent: it skips deduction when the order has
 * already been consumed (an outstanding `OUT` movement exists for the order that
 * has not been compensated by a reversal `IN`).
 */

type RecipeProductLike = {
    name: string;
    unit: string;
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
    quantity: number;
    menuItem: { recipes: RecipeLike[] };
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
}

export interface ReverseForOrderParams {
    orderId: number;
    userId: number;
    companyId: number;
}

export class InventoryConsumptionService {
    private static orderReference(orderId: number): string {
        return `ORD-${orderId}`;
    }

    /**
     * Net base-unit quantity already consumed (OUT minus reversal IN) for an
     * order's reference. A value > 0 means stock is currently deducted.
     */
    private static async netConsumed(
        tx: Prisma.TransactionClient,
        companyId: number,
        reference: string
    ): Promise<number> {
        const movements = await tx.inventoryMovement.findMany({
            where: { companyId, reference, type: { in: ['OUT', 'IN'] } },
            select: { type: true, quantity: true }
        });

        return movements.reduce((net, m) => {
            const qty = Number(m.quantity);
            return m.type === 'OUT' ? net + qty : net - qty;
        }, 0);
    }

    /**
     * Deduct inventory for every recipe of every order item.
     *
     * Idempotent: if the order has already been consumed (and not reversed) it
     * returns early without touching stock.
     */
    static async consumeForOrder(
        tx: Prisma.TransactionClient,
        { order, warehouseId, userId, companyId }: ConsumeForOrderParams
    ): Promise<{ consumed: boolean }> {
        const reference = this.orderReference(order.id);

        // IDEMPOTENCY GUARD: skip when stock is already deducted for this order.
        if ((await this.netConsumed(tx, companyId, reference)) > 1e-9) {
            return { consumed: false };
        }

        for (const item of order.items) {
            for (const recipe of item.menuItem.recipes) {
                // Unit priority: recipe.unit -> recipe.unitId abbreviation -> product.unit.
                const recipeUnit = recipe.unit || recipe.unitOfMeasure?.abbreviation || recipe.product.unit;
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
                    reason: 'Consumo por orden',
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
        await this.consumeModifiersForOrder(tx, order.id, { warehouseId, userId, companyId, reference });

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
        orderId: number,
        ctx: { warehouseId: number; userId: number; companyId: number; reference: string }
    ): Promise<void> {
        const orderItemModifiers = await tx.orderItemModifier.findMany({
            where: { orderItem: { orderId } },
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
        });

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
                reason: 'Consumo por modificador',
                reference: ctx.reference,
                productName: modifier.product.name
            });
        }
    }

    /**
     * Reverse a previous order consumption by restoring the net deducted stock
     * and recording compensating `IN` movements. After a full reversal the
     * idempotency guard in `consumeForOrder` no longer treats the order as
     * consumed, so a later re-payment will deduct again.
     */
    static async reverseForOrder(
        tx: Prisma.TransactionClient,
        { orderId, userId, companyId }: ReverseForOrderParams
    ): Promise<{ reversed: boolean }> {
        const reference = this.orderReference(orderId);

        const movements = await tx.inventoryMovement.findMany({
            where: { companyId, reference, type: { in: ['OUT', 'IN'] } },
            select: { warehouseId: true, productId: true, type: true, quantity: true, unitCost: true }
        });

        // Aggregate outstanding (un-reversed) consumption per warehouse + product.
        const net = new Map<string, { warehouseId: number; productId: number; quantity: number; unitCost: number }>();
        for (const m of movements) {
            const key = `${m.warehouseId}|${m.productId}`;
            const delta = m.type === 'OUT' ? Number(m.quantity) : -Number(m.quantity);
            const entry = net.get(key);
            if (entry) {
                entry.quantity += delta;
                if (m.type === 'OUT' && m.unitCost != null) entry.unitCost = Number(m.unitCost);
            } else {
                net.set(key, {
                    warehouseId: m.warehouseId,
                    productId: m.productId,
                    quantity: delta,
                    unitCost: m.unitCost != null ? Number(m.unitCost) : 0
                });
            }
        }

        let reversed = false;
        for (const entry of net.values()) {
            if (entry.quantity <= 1e-9) continue; // nothing outstanding to restore

            // Restore the net deducted stock with a compensating IN through the
            // engine. We pass the original OUT unit cost explicitly so the reversal
            // is valued at the cost it was consumed at (bespoke), and a FIFO layer
            // is re-opened for the restored quantity.
            await InventoryEngineService.applyMovement(tx, {
                type: 'IN',
                companyId,
                warehouseId: entry.warehouseId,
                productId: entry.productId,
                userId,
                quantity: entry.quantity,
                unitCost: entry.unitCost,
                reason: 'Reversa de consumo por orden (pago eliminado)',
                reference,
                sourceType: 'ADJUSTMENT'
            });
            reversed = true;
        }

        return { reversed };
    }
}
