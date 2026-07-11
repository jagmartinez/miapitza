import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { effectiveUnitCost } from '../utils/product-cost';
import { getErrorMessage } from '../utils/error';

/**
 * A Prisma client surface that works both with the global client and inside a
 * `$transaction` callback. Costing writes that happen as part of a larger flow
 * (e.g. receiving a purchase order) MUST use the caller's transaction client so
 * the cost mutations commit/rollback atomically with the stock changes.
 */
type Db = Prisma.TransactionClient;

/**
 * Service for handling product costing calculations
 * Supports Weighted Average and FIFO costing methods
 */
export class CostingService {
    /**
     * Calculate weighted average cost for a product
     * Formula: (currentStock * currentCost + newQuantity * newCost) / (currentStock + newQuantity)
     */
    static async calculateWeightedAverageCost(
        productId: number,
        currentStock: number,
        currentAverageCost: number,
        newQuantity: number,
        newCost: number
    ): Promise<number> {
        // If no current stock, the new cost becomes the average cost
        if (currentStock === 0) {
            return newCost;
        }

        const totalValue = (currentStock * currentAverageCost) + (newQuantity * newCost);
        const totalQuantity = currentStock + newQuantity;

        return totalValue / totalQuantity;
    }

    /**
     * Resolve the unit cost used to value an OUTFLOW (sale, consumption,
     * transfer-out) according to the company's costing method. Shared contract
     * invoked by other services when posting OUT movements.
     *
     * - WEIGHTED_AVERAGE: the product's stored moving-average cost.
     * - FIFO: best-effort estimate from the oldest remaining real cost layer
     *   (`InventoryBatch`, company-wide), falling back to the legacy
     *   ProductCostHistory-derived batches and finally to the average/legacy cost.
     *
     * NOTE: This is a COMPANY-WIDE best estimate. The exact per-warehouse FIFO
     * COGS is computed by InventoryEngineService.applyMovement, which knows the
     * warehouse. This helper is only used for the WEIGHTED_AVERAGE outflow value
     * and as a FIFO fallback for callers that don't go through the engine.
     */
    static async getOutflowUnitCost(db: Db, productId: number, companyId: number): Promise<number> {
        const product = await db.product.findFirst({
            where: { id: productId, companyId },
            select: { currentAverageCost: true, cost: true }
        });

        const fallback = effectiveUnitCost(product?.currentAverageCost, product?.cost);

        const company = await db.company.findUnique({
            where: { id: companyId },
            select: { costingMethod: true }
        });
        const costingMethod = company?.costingMethod || 'WEIGHTED_AVERAGE';

        if (costingMethod !== 'FIFO') {
            return fallback;
        }

        // FIFO best-effort: prefer the real cost layers (InventoryBatch) when the
        // delegate is available (it is on the real Prisma client; minimal test
        // stubs may omit it, in which case we fall back to the legacy estimate).
        const batchDelegate = (db as unknown as {
            inventoryBatch?: {
                findFirst: (args: unknown) => Promise<{ unitCost: unknown } | null>;
            };
        }).inventoryBatch;
        if (batchDelegate?.findFirst) {
            const oldest = await batchDelegate.findFirst({
                where: { productId, companyId, remainingQty: { gt: 0 } },
                orderBy: { createdAt: 'asc' },
                select: { unitCost: true }
            });
            if (oldest && Number(oldest.unitCost) > 0) {
                return Number(oldest.unitCost);
            }
        }

        // Legacy fallback: value the outflow at the oldest ProductCostHistory batch.
        const batches = await this.getFifoBatches(productId, companyId, db);
        if (batches.length > 0 && batches[0].unitCost > 0) {
            return batches[0].unitCost;
        }
        return fallback;
    }

    /**
     * Update product cost when receiving a purchase order.
     *
     * This is called automatically when a purchase order is received. It MUST run
     * inside the same transaction as the stock mutation, so the caller passes its
     * `tx` client (`db`). The caller also passes the PRE-receipt GLOBAL stock
     * quantity for the product (sum across all of the company's warehouses,
     * captured before the stock update) so the weighted-average computation is
     * deterministic and reflects the global moving average — not a single
     * warehouse's quantity.
     */
    static async updateProductCost(
        db: Db,
        productId: number,
        companyId: number,
        purchaseOrderItemId: number,
        quantity: number,
        unitCost: number,
        warehouseId: number,
        previousStock: number
    ): Promise<void> {
        try {
            // Get current product data (tenant-scoped)
            const product = await db.product.findFirst({
                where: { id: productId, companyId },
                select: { currentAverageCost: true }
            });

            if (!product) {
                throw new Error(`Product ${productId} not found`);
            }

            // Get company costing method
            const company = await db.company.findUnique({
                where: { id: companyId },
                select: { costingMethod: true }
            });

            const costingMethod = company?.costingMethod || 'WEIGHTED_AVERAGE';

            // Pre-receipt GLOBAL stock for the product, supplied by the caller.
            // When 0 it means "no global stock", so the new cost simply becomes the
            // entry cost (handled inside calculateWeightedAverageCost).
            const currentStock = previousStock;

            const previousAvgCost = Number(product.currentAverageCost);
            let newAvgCost: number;

            if (costingMethod === 'WEIGHTED_AVERAGE') {
                newAvgCost = await this.calculateWeightedAverageCost(
                    productId,
                    currentStock,
                    previousAvgCost,
                    quantity,
                    unitCost
                );
            } else {
                // FIFO - new purchase simply adds a batch at its own cost.
                // The "average cost" stored on the product reflects the FIFO-weighted
                // average across all remaining batches for display purposes.
                const batches = await this.getFifoBatches(productId, companyId, db);
                // Add the new batch to the list for the average calculation
                batches.push({ quantity, unitCost });
                newAvgCost = this.calculateBatchWeightedAverage(batches);
            }

            // Product.cost is the reviewed catalog/reference value. Operational
            // receipts update only the moving average and last purchase cost;
            // consumers use effectiveUnitCost() to prefer this positive average.
            await db.product.update({
                where: { id: productId },
                data: {
                    currentAverageCost: newAvgCost,
                    lastPurchaseCost: unitCost,
                    updatedAt: new Date()
                }
            });

            // Record cost history
            await db.productCostHistory.create({
                data: {
                    productId,
                    companyId,
                    purchaseOrderItemId,
                    quantity,
                    unitCost,
                    previousAvgCost,
                    newAvgCost,
                    previousStock: currentStock,
                    newStock: currentStock + quantity
                }
            });

            console.log(`[CostingService] Updated cost for product ${productId}:`, {
                previousAvgCost,
                newAvgCost,
                unitCost,
                quantity,
                currentStock,
                method: costingMethod
            });
        } catch (error: unknown) {
            console.error(`[CostingService] Error updating product cost:`, error);
            throw new Error(`Failed to update product cost: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Update product cost when a manufactured product ENTERS inventory through a
     * production order (orden de producción).
     *
     * This is the internal-transformation counterpart of `updateProductCost`. It
     * MUST run inside the production order's transaction (`db`). The produced unit
     * cost is computed by the production service from the real cost of the consumed
     * inputs (`realCost / producedQuantity`), so here we simply fold it into the
     * weighted-average / FIFO valuation of the OUTPUT product, exactly like a
     * purchase receipt would — but without a purchaseOrderItem.
     *
     * `previousStock` is the OUTPUT product stock for the target warehouse captured
     * BEFORE the production IN movement, mirroring the purchase-receive convention.
     */
    static async applyProductionCost(
        db: Db,
        productId: number,
        companyId: number,
        quantity: number,
        unitCost: number,
        previousStock: number,
        productionOrderId?: number
    ): Promise<void> {
        try {
            const product = await db.product.findFirst({
                where: { id: productId, companyId },
                select: { currentAverageCost: true }
            });

            if (!product) {
                throw new Error(`Product ${productId} not found`);
            }

            const company = await db.company.findUnique({
                where: { id: companyId },
                select: { costingMethod: true }
            });
            const costingMethod = company?.costingMethod || 'WEIGHTED_AVERAGE';

            const currentStock = previousStock;
            const previousAvgCost = Number(product.currentAverageCost);
            let newAvgCost: number;

            if (costingMethod === 'WEIGHTED_AVERAGE') {
                newAvgCost = await this.calculateWeightedAverageCost(
                    productId,
                    currentStock,
                    previousAvgCost,
                    quantity,
                    unitCost
                );
            } else {
                // FIFO: the production batch is added at its computed cost; the stored
                // average reflects the FIFO-weighted average across remaining batches.
                const batches = await this.getFifoBatches(productId, companyId, db);
                batches.push({ quantity, unitCost });
                newAvgCost = this.calculateBatchWeightedAverage(batches);
            }

            await db.product.update({
                where: { id: productId },
                data: {
                    currentAverageCost: newAvgCost,
                    updatedAt: new Date()
                }
            });

            // Record cost history (purchaseOrderItemId is null for production
            // entries). productionOrderId links the entry to its order so the cost
            // effect can be reversed exactly when the order is cancelled (#1).
            await db.productCostHistory.create({
                data: {
                    productId,
                    companyId,
                    productionOrderId: productionOrderId ?? null,
                    quantity,
                    unitCost,
                    previousAvgCost,
                    newAvgCost,
                    previousStock: currentStock,
                    newStock: currentStock + quantity
                }
            });
        } catch (error: unknown) {
            console.error(`[CostingService] Error applying production cost:`, error);
            throw new Error(`Failed to apply production cost: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Reverse the cost effect of a (now cancelled) production order (#1).
     *
     * Locates the ProductCostHistory entry/entries created by applyProductionCost
     * for `productionOrderId`, removes them, and recomputes the product's
     * currentAverageCost from the REMAINING history (WEIGHTED_AVERAGE) or the
     * remaining FIFO batches. Product.cost stays as the reviewed reference value.
     * MUST run inside the cancellation transaction so the
     * cost reversal commits atomically with the stock reversal — replacing the
     * previous post-commit recalculateProductCost which could leave a partial state.
     */
    static async reverseProductionCost(
        db: Db,
        productionOrderId: number,
        companyId: number
    ): Promise<void> {
        const entries = await db.productCostHistory.findMany({
            where: { productionOrderId, companyId },
            select: { productId: true }
        });
        if (entries.length === 0) return;

        const productIds = [...new Set(entries.map((entry) => entry.productId))];

        // Capture the complete replay chain before deleting the target entry.
        // The first row's previousStock/previousAvgCost is the historical/legacy
        // baseline; replaying from zero would erase stock value that predates the
        // ProductCostHistory table.
        const histories = new Map<number, Awaited<ReturnType<typeof db.productCostHistory.findMany>>>();
        for (const productId of productIds) {
            const history = await db.productCostHistory.findMany({
                where: { productId, companyId },
                orderBy: { createdAt: 'asc' }
            });
            histories.set(productId, history);
        }

        // Drop the production cost entries so the recompute reflects the reversal.
        await db.productCostHistory.deleteMany({ where: { productionOrderId, companyId } });

        const company = await db.company.findUnique({
            where: { id: companyId },
            select: { costingMethod: true }
        });
        const costingMethod = company?.costingMethod || 'WEIGHTED_AVERAGE';

        for (const productId of productIds) {
            let newAvgCost: number;
            if (costingMethod === 'FIFO') {
                const batches = await this.getFifoBatches(productId, companyId, db);
                newAvgCost = this.calculateBatchWeightedAverage(batches);
            } else {
                const completeHistory = histories.get(productId) || [];
                const baseline = completeHistory[0];
                let runningStock = baseline ? Number(baseline.previousStock) : 0;
                let runningAvgCost = baseline ? Number(baseline.previousAvgCost) : 0;
                let removedStockBefore = 0;

                for (const entry of completeHistory) {
                    const qty = Number(entry.quantity);
                    if (entry.productionOrderId === productionOrderId) {
                        // Exact batch reversal guarantees this produced quantity
                        // was not consumed. Every later history row therefore saw
                        // `qty` more stock than the counterfactual replay should.
                        removedStockBefore += qty;
                        continue;
                    }
                    // `previousStock` captures real OUT movements between cost
                    // events. Reset to that observed stock and subtract only the
                    // removed production layers that precede this row.
                    runningStock = Math.max(0, Number(entry.previousStock) - removedStockBefore);
                    const cost = Number(entry.unitCost);
                    if (runningStock + qty === 0) {
                        runningAvgCost = 0;
                    } else {
                        runningAvgCost = ((runningStock * runningAvgCost) + (qty * cost)) / (runningStock + qty);
                    }
                    runningStock += qty;
                }
                newAvgCost = runningAvgCost;
            }

            await db.product.update({
                where: { id: productId },
                data: {
                    currentAverageCost: newAvgCost,
                    updatedAt: new Date()
                }
            });
        }
    }

    /**
     * Get cost history for a product
     */
    static async getCostHistory(productId: number, companyId: number, limit: number = 50) {
        return await prisma.productCostHistory.findMany({
            where: {
                productId,
                companyId
            },
            include: {
                purchaseOrderItem: {
                    include: {
                        purchaseOrder: {
                            select: {
                                id: true,
                                date: true,
                                supplier: {
                                    select: {
                                        name: true
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: limit
        });
    }

    /**
     * Recalculate cost for a product based on current stock and purchase history.
     * Replays all inventory movements chronologically using the company's costing method.
     */
    static async recalculateProductCost(productId: number, companyId: number): Promise<void> {
        const company = await prisma.company.findUnique({
            where: { id: companyId },
            select: { costingMethod: true }
        });

        const costingMethod = company?.costingMethod || 'WEIGHTED_AVERAGE';

        if (costingMethod === 'FIFO') {
            // Recalculate FIFO average from remaining batches
            const batches = await this.getFifoBatches(productId, companyId);
            const newAvgCost = this.calculateBatchWeightedAverage(batches);

            await prisma.product.update({
                where: { id: productId },
                data: {
                    currentAverageCost: newAvgCost,
                    updatedAt: new Date()
                }
            });
        } else {
            // Weighted average: replay all purchase history entries
            const history = await prisma.productCostHistory.findMany({
                where: { productId, companyId },
                orderBy: { createdAt: 'asc' }
            });

            let runningStock = 0;
            let runningAvgCost = 0;

            for (const entry of history) {
                const qty = Number(entry.quantity);
                const cost = Number(entry.unitCost);
                if (runningStock + qty === 0) {
                    runningAvgCost = 0;
                } else {
                    runningAvgCost = ((runningStock * runningAvgCost) + (qty * cost)) / (runningStock + qty);
                }
                runningStock += qty;
            }

            await prisma.product.update({
                where: { id: productId },
                data: {
                    currentAverageCost: runningAvgCost,
                    updatedAt: new Date()
                }
            });
        }
    }

    // ==========================================
    // FIFO Costing Methods
    // ==========================================

    /**
     * Get remaining FIFO batches for a product.
     * Each batch is a purchase (from ProductCostHistory) with remaining quantity
     * calculated by subtracting consumed stock (OUT movements) from oldest batches first.
     */
    static async getFifoBatches(
        productId: number,
        companyId: number,
        db: Db = prisma
    ): Promise<Array<{ quantity: number; unitCost: number }>> {
        // Get all purchase batches ordered oldest first
        const purchaseHistory = await db.productCostHistory.findMany({
            where: { productId, companyId },
            orderBy: { createdAt: 'asc' }
        });

        // Build batch list from purchases
        const batches: Array<{ quantity: number; unitCost: number }> = purchaseHistory.map((entry) => ({
            quantity: Number(entry.quantity),
            unitCost: Number(entry.unitCost)
        }));

        // Get total consumed quantity from OUT movements
        const outMovements = await db.inventoryMovement.findMany({
            where: {
                productId,
                companyId,
                type: 'OUT'
            },
            select: { quantity: true }
        });

        let totalConsumed = outMovements.reduce((sum, m) => sum + Math.abs(Number(m.quantity)), 0);

        // Consume from oldest batches first (FIFO)
        const remaining: Array<{ quantity: number; unitCost: number }> = [];
        for (const batch of batches) {
            if (totalConsumed >= batch.quantity) {
                totalConsumed -= batch.quantity;
                // This batch is fully consumed, skip it
            } else {
                remaining.push({
                    quantity: batch.quantity - totalConsumed,
                    unitCost: batch.unitCost
                });
                totalConsumed = 0;
            }
        }

        return remaining;
    }

    /**
     * Calculate the FIFO cost of goods for a given consumption quantity.
     * Consumes from oldest batches first and returns the total cost.
     */
    static async calculateFifoCostOfGoods(
        productId: number,
        companyId: number,
        quantityToConsume: number,
        db: Db = prisma
    ): Promise<{ totalCost: number; costPerUnit: number; batchesUsed: Array<{ quantity: number; unitCost: number }> }> {
        const batches = await this.getFifoBatches(productId, companyId, db);

        let remaining = quantityToConsume;
        let totalCost = 0;
        const batchesUsed: Array<{ quantity: number; unitCost: number }> = [];

        for (const batch of batches) {
            if (remaining <= 0) break;

            const used = Math.min(batch.quantity, remaining);
            totalCost += used * batch.unitCost;
            remaining -= used;

            batchesUsed.push({ quantity: used, unitCost: batch.unitCost });
        }

        // If remaining > 0, there is insufficient stock in batches.
        // Fall back to last known cost for the shortfall.
        if (remaining > 0 && batchesUsed.length > 0) {
            const lastCost = batchesUsed[batchesUsed.length - 1].unitCost;
            totalCost += remaining * lastCost;
            batchesUsed.push({ quantity: remaining, unitCost: lastCost });
        }

        const costPerUnit = quantityToConsume > 0 ? totalCost / quantityToConsume : 0;

        return {
            totalCost: Math.round(totalCost * 100) / 100,
            costPerUnit: Math.round(costPerUnit * 100) / 100,
            batchesUsed
        };
    }

    /**
     * Calculate weighted average cost across a set of batches (for display purposes under FIFO).
     */
    private static calculateBatchWeightedAverage(
        batches: Array<{ quantity: number; unitCost: number }>
    ): number {
        const totalQty = batches.reduce((sum, b) => sum + b.quantity, 0);
        if (totalQty === 0) return 0;

        const totalValue = batches.reduce((sum, b) => sum + b.quantity * b.unitCost, 0);
        return totalValue / totalQty;
    }
}
