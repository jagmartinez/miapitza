import prisma from '../utils/prisma';
import { getErrorMessage } from '../utils/error';

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
     * Update product cost when receiving a purchase order
     * This is called automatically when a purchase order is received
     */
    static async updateProductCost(
        productId: number,
        companyId: number,
        purchaseOrderItemId: number,
        quantity: number,
        unitCost: number,
        warehouseId: number
    ): Promise<void> {
        try {
            // Get current product data
            const product = await prisma.product.findUnique({
                where: { id: productId },
                include: {
                    stocks: {
                        where: { warehouseId }
                    }
                }
            });

            if (!product) {
                throw new Error(`Product ${productId} not found`);
            }

            // Get company costing method
            const company = await prisma.company.findUnique({
                where: { id: companyId },
                select: { costingMethod: true }
            });

            const costingMethod = company?.costingMethod || 'WEIGHTED_AVERAGE';

            // Calculate current stock in this warehouse
            const currentStock = product.stocks.reduce((sum, stock) => sum + Number(stock.quantity), 0);

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
                const batches = await this.getFifoBatches(productId, companyId);
                // Add the new batch to the list for the average calculation
                batches.push({ quantity, unitCost });
                newAvgCost = this.calculateBatchWeightedAverage(batches);
            }

            // Update product costs
            await prisma.product.update({
                where: { id: productId },
                data: {
                    currentAverageCost: newAvgCost,
                    lastPurchaseCost: unitCost,
                    cost: newAvgCost, // Keep legacy field in sync
                    updatedAt: new Date()
                }
            });

            // Record cost history
            await prisma.productCostHistory.create({
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
                    cost: newAvgCost,
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
                    cost: runningAvgCost,
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
        companyId: number
    ): Promise<Array<{ quantity: number; unitCost: number }>> {
        // Get all purchase batches ordered oldest first
        const purchaseHistory = await prisma.productCostHistory.findMany({
            where: { productId, companyId },
            orderBy: { createdAt: 'asc' }
        });

        // Build batch list from purchases
        const batches: Array<{ quantity: number; unitCost: number }> = purchaseHistory.map((entry) => ({
            quantity: Number(entry.quantity),
            unitCost: Number(entry.unitCost)
        }));

        // Get total consumed quantity from OUT movements
        const outMovements = await prisma.inventoryMovement.findMany({
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
        quantityToConsume: number
    ): Promise<{ totalCost: number; costPerUnit: number; batchesUsed: Array<{ quantity: number; unitCost: number }> }> {
        const batches = await this.getFifoBatches(productId, companyId);

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
