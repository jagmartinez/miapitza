import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { CostingService } from '../../services/costing.service';
import { ProductionRecipeService } from '../../services/production-recipe.service';

describe('CostingService.calculateWeightedAverageCost', () => {
    it('returns the new cost when there is no current stock', async () => {
        const result = await CostingService.calculateWeightedAverageCost(1, 0, 5, 10, 7);
        expect(result).toBe(7);
    });

    it('blends current and incoming cost by quantity', async () => {
        // (10 * 5 + 10 * 7) / 20 = 6
        const result = await CostingService.calculateWeightedAverageCost(1, 10, 5, 10, 7);
        expect(result).toBe(6);
    });
});

describe('CostingService.applyProductionCost', () => {
    it('folds the produced unit cost into the weighted average and records cost history without a PO item', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const historyRows: Array<Record<string, unknown>> = [];

        const tx = {
            product: {
                findFirst: jest.fn(async () => ({ currentAverageCost: 5 })),
                update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return {};
                })
            },
            company: {
                findUnique: jest.fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE' }))
            },
            productCostHistory: {
                create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    historyRows.push(args.data);
                    return {};
                })
            }
        } as unknown as Parameters<typeof CostingService.applyProductionCost>[0];

        // previousStock 10 @ 5, produce 10 @ 7 -> new avg 6
        await CostingService.applyProductionCost(tx, 42, 1, 10, 7, 10);

        expect(updates).toHaveLength(1);
        expect(updates[0].currentAverageCost).toBe(6);
        expect(updates[0].cost).toBe(6);
        // production entries do not set lastPurchaseCost (only purchases do)
        expect(updates[0].lastPurchaseCost).toBeUndefined();

        expect(historyRows).toHaveLength(1);
        expect(historyRows[0].newAvgCost).toBe(6);
        expect(historyRows[0].previousStock).toBe(10);
        expect(historyRows[0].newStock).toBe(20);
        expect(historyRows[0].purchaseOrderItemId).toBeUndefined();
    });
});

describe('ProductionRecipeService.assertNoCircularDependency', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects a component equal to the output product', async () => {
        await expect(
            ProductionRecipeService.assertNoCircularDependency(1, 5, [5])
        ).rejects.toThrow(/propio producto/i);
    });

    it('detects an indirect cycle through active recipes', async () => {
        // Output = 1, component = 2. Product 2 has an ACTIVE recipe whose component is 1 -> cycle.
        jest.spyOn(prisma.productionRecipe, 'findFirst').mockImplementation((async (args: {
            where?: { productId?: number };
        }) => {
            if (args?.where?.productId === 2) {
                return { id: 99, components: [{ componentProductId: 1 }] } as never;
            }
            return null as never;
        }) as never);

        await expect(
            ProductionRecipeService.assertNoCircularDependency(1, 1, [2])
        ).rejects.toThrow(/circular/i);
    });

    it('passes for an acyclic recipe', async () => {
        jest.spyOn(prisma.productionRecipe, 'findFirst').mockResolvedValue(null as never);

        await expect(
            ProductionRecipeService.assertNoCircularDependency(1, 1, [2, 3])
        ).resolves.toBeUndefined();
    });
});
