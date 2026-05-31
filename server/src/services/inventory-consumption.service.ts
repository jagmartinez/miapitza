import type { Prisma } from '@prisma/client';
import { UnitConversionService } from './unit-conversion.service';

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
                const recipeUnit = recipe.unit || recipe.product.unit;
                let recipeQtyBase = Number(recipe.quantity);
                let originalQuantity: number | null = null;
                let originalUnit: string | null = null;
                let conversionFactor: number | null = null;

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
                } catch {
                    // Fallback to legacy quantity when conversion is not configured
                }

                const requiredQty = recipeQtyBase * item.quantity;

                const stock = await tx.stock.findUnique({
                    where: { warehouseId_productId: { warehouseId, productId: recipe.productId } }
                });

                if (!stock) {
                    throw new Error(`Stock insuficiente para ${recipe.product.name}. Requerido: ${requiredQty}, Disponible: 0`);
                }

                const currentQty = Number(stock.quantity);
                if (currentQty < requiredQty) {
                    throw new Error(`Stock insuficiente para ${recipe.product.name}. Requerido: ${requiredQty}, Disponible: ${currentQty}`);
                }

                const newQty = currentQty - requiredQty;
                const unitCost = Number(recipe.product.currentAverageCost || recipe.product.cost || 0);

                await tx.stock.update({
                    where: { warehouseId_productId: { warehouseId, productId: recipe.productId } },
                    data: { quantity: newQty }
                });

                await tx.inventoryMovement.create({
                    data: {
                        companyId,
                        warehouseId,
                        productId: recipe.productId,
                        userId,
                        type: 'OUT',
                        quantity: requiredQty,
                        originalQuantity: originalQuantity != null ? originalQuantity * item.quantity : null,
                        originalUnit,
                        conversionFactor,
                        unitCost,
                        totalCost: unitCost * requiredQty,
                        balanceQty: newQty,
                        balanceCost: newQty * unitCost,
                        reason: 'Consumo por orden',
                        reference
                    }
                });
            }
        }

        return { consumed: true };
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

            const stock = await tx.stock.findUnique({
                where: { warehouseId_productId: { warehouseId: entry.warehouseId, productId: entry.productId } }
            });

            const currentQty = stock ? Number(stock.quantity) : 0;
            const newQty = currentQty + entry.quantity;

            if (stock) {
                await tx.stock.update({
                    where: { warehouseId_productId: { warehouseId: entry.warehouseId, productId: entry.productId } },
                    data: { quantity: newQty }
                });
            } else {
                await tx.stock.create({
                    data: {
                        companyId,
                        warehouseId: entry.warehouseId,
                        productId: entry.productId,
                        quantity: newQty
                    }
                });
            }

            await tx.inventoryMovement.create({
                data: {
                    companyId,
                    warehouseId: entry.warehouseId,
                    productId: entry.productId,
                    userId,
                    type: 'IN',
                    quantity: entry.quantity,
                    unitCost: entry.unitCost,
                    totalCost: entry.unitCost * entry.quantity,
                    balanceQty: newQty,
                    balanceCost: newQty * entry.unitCost,
                    reason: 'Reversa de consumo por orden (pago eliminado)',
                    reference
                }
            });
            reversed = true;
        }

        return { reversed };
    }
}
