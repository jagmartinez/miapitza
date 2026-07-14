import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { CostingService } from '../../services/costing.service';
import { ProductionRecipeService } from '../../services/production-recipe.service';
import { ProductionOrderService } from '../../services/production-order.service';

afterEach(() => {
    jest.restoreAllMocks();
});

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
        // Product.cost remains the reviewed catalog/reference value.
        expect(updates[0].cost).toBeUndefined();
        // production entries do not set lastPurchaseCost (only purchases do)
        expect(updates[0].lastPurchaseCost).toBeUndefined();

        expect(historyRows).toHaveLength(1);
        expect(historyRows[0].newAvgCost).toBe(6);
        expect(historyRows[0].previousStock).toBe(10);
        expect(historyRows[0].newStock).toBe(20);
        expect(historyRows[0].purchaseOrderItemId).toBeUndefined();
    });
});

describe('CostingService.reverseProductionCost', () => {
    it('replays from the historical baseline instead of zero after removing a middle production entry', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const history = [
            {
                id: 1, productId: 42, companyId: 1, productionOrderId: null,
                quantity: 10, unitCost: 5, previousStock: 0, previousAvgCost: 0,
                newStock: 10, newAvgCost: 5, createdAt: new Date('2026-01-01')
            },
            {
                id: 2, productId: 42, companyId: 1, productionOrderId: 7,
                quantity: 10, unitCost: 9, previousStock: 10, previousAvgCost: 5,
                newStock: 20, newAvgCost: 7, createdAt: new Date('2026-01-02')
            },
            {
                id: 3, productId: 42, companyId: 1, productionOrderId: null,
                quantity: 10, unitCost: 7, previousStock: 20, previousAvgCost: 7,
                newStock: 30, newAvgCost: 7, createdAt: new Date('2026-01-03')
            }
        ];
        const db = {
            productCostHistory: {
                findMany: jest.fn(async (args: { where: { productionOrderId?: number } }) => (
                    args.where.productionOrderId === 7 ? [{ productId: 42 }] : history
                )),
                deleteMany: jest.fn(async () => ({ count: 1 }))
            },
            company: { findUnique: jest.fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE' })) },
            product: {
                update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return {};
                })
            }
        } as unknown as Parameters<typeof CostingService.reverseProductionCost>[0];

        await CostingService.reverseProductionCost(db, 7, 1);

        // Remaining: 10 @ 5 plus 10 @ 7 = 6. The removed production 10 @ 9
        // must not leak through the later row's stored previousAvgCost.
        expect(updates[0].currentAverageCost).toBe(6);
        expect(updates[0].cost).toBeUndefined();
        expect(updates[0].lastPurchaseCost).toBeUndefined();
    });

    it('restores the pre-production legacy average when no history remains', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const onlyProduction = [{
            id: 2, productId: 42, companyId: 1, productionOrderId: 7,
            quantity: 10, unitCost: 9, previousStock: 6, previousAvgCost: 4,
            newStock: 16, newAvgCost: 7.125, createdAt: new Date('2026-01-02')
        }];
        const db = {
            productCostHistory: {
                findMany: jest.fn(async (args: { where: { productionOrderId?: number } }) => (
                    args.where.productionOrderId === 7 ? [{ productId: 42 }] : onlyProduction
                )),
                deleteMany: jest.fn(async () => ({ count: 1 }))
            },
            company: { findUnique: jest.fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE' })) },
            product: {
                update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return {};
                })
            }
        } as unknown as Parameters<typeof CostingService.reverseProductionCost>[0];

        await CostingService.reverseProductionCost(db, 7, 1);
        expect(updates[0].currentAverageCost).toBe(4);
    });
});

describe('CostingService.reversePurchaseCost', () => {
    it('removes the target receipt and replays later purchases from the original baseline', async () => {
        const updates: Array<Record<string, unknown>> = [];
        const history = [
            {
                id: 1, productId: 42, companyId: 1, purchaseOrderItemId: 31,
                quantity: 10, unitCost: 8, previousStock: 10, previousAvgCost: 4,
                newStock: 20, newAvgCost: 6, createdAt: new Date('2026-01-01')
            },
            {
                id: 2, productId: 42, companyId: 1, purchaseOrderItemId: 32,
                quantity: 10, unitCost: 10, previousStock: 20, previousAvgCost: 6,
                newStock: 30, newAvgCost: 7.333333, createdAt: new Date('2026-01-02')
            }
        ];
        const db = {
            productCostHistory: {
                findMany: jest.fn(async (args: { where: { purchaseOrderItemId?: { in: number[] } } }) => (
                    args.where.purchaseOrderItemId ? [{ productId: 42 }] : history
                )),
                deleteMany: jest.fn(async () => ({ count: 1 }))
            },
            company: { findUnique: jest.fn(async () => ({ costingMethod: 'WEIGHTED_AVERAGE' })) },
            product: {
                update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    updates.push(args.data);
                    return {};
                })
            }
        } as unknown as Parameters<typeof CostingService.reversePurchaseCost>[0];

        await CostingService.reversePurchaseCost(db, [31], 1);

        // Baseline 10 @ 4 plus remaining purchase 10 @ 10 = 7.
        expect(updates[0]).toEqual(expect.objectContaining({
            currentAverageCost: 7,
            lastPurchaseCost: 10
        }));
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

describe('ProductionOrderService numeric invariants', () => {
    it.each([NaN, Infinity, -Infinity, 0, -1])('rejects invalid planned quantity %s before querying inventory', async (plannedQuantity) => {
        await expect(ProductionOrderService.computeRequirements(1, {
            productId: 1,
            plannedQuantity,
            warehouseId: 1
        })).rejects.toThrow(/finito|mayor a 0/i);
    });
});

describe('Production order lifecycle invariants', () => {
    it('does not allow a draft order to bypass start and finish directly', async () => {
        jest.spyOn(prisma.productionOrder, 'findFirst').mockResolvedValue({
            id: 8,
            companyId: 1,
            status: 'DRAFT',
            recipeId: 3,
            items: [{ id: 1 }]
        } as never);

        await expect(ProductionOrderService.finish(8, 1, 9, {}))
            .rejects.toThrow(/debe estar En Proceso/i);
    });

    it('requires an auditable cancellation reason before reading or mutating the order', async () => {
        const findFirst = jest.spyOn(prisma.productionOrder, 'findFirst');

        await expect(ProductionOrderService.cancel(8, 1, 9, '   '))
            .rejects.toThrow(/motivo de anulación es requerido/i);
        expect(findFirst).not.toHaveBeenCalled();
    });
});

describe('Production recipe lifecycle invariants', () => {
    it('does not allow an active version to return to draft/editable state', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            productionRecipe: {
                findFirst: jest.fn(async () => ({
                    id: 4, companyId: 1, productId: 7, status: 'ACTIVE', components: []
                })),
                update: jest.fn(async () => ({})),
                updateMany: jest.fn(async () => ({ count: 0 }))
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(ProductionRecipeService.setStatus(4, 1, 'DRAFT'))
            .rejects.toThrow(/ACTIVE -> DRAFT/);
        expect(tx.productionRecipe.update).not.toHaveBeenCalled();
    });
});

describe('Production recipe yield-unit contract', () => {
    it('publishes the configured output base unit when the recipe has no explicit yield unit', async () => {
        jest.spyOn(prisma.productionRecipe, 'findMany').mockResolvedValue([{
            id: 11,
            productId: 7,
            yieldUnit: null,
            product: { unit: 'kg', baseUnit: { abbreviation: 'g' } }
        }] as never);
        jest.spyOn(ProductionRecipeService, 'computeRecipeCost').mockResolvedValue({
            batchCost: 1,
            yieldBaseQuantity: 1,
            yieldBaseUnit: 'g',
            unitCost: 1,
            lines: []
        });

        const [recipe] = await ProductionRecipeService.list(1);

        expect(recipe.yieldUnitAbbreviation).toBe('g');
        expect(recipe.yieldUnitSource).toBe('PRODUCT_BASE');
    });

    it('costs an implicit yield in the same configured base unit exposed to the UI', async () => {
        const product = {
            id: 7,
            companyId: 1,
            name: 'Masa',
            unit: 'kg',
            baseUnit: { abbreviation: 'g', measurementType: 'MASS', systemFactor: 1 },
            allowedUnits: [{
                conversionFactor: 1000,
                unit: { abbreviation: 'kg', measurementType: 'MASS', systemFactor: 1000 }
            }]
        };
        const db = {
            productionRecipe: {
                findFirst: jest.fn(async () => ({
                    id: 11,
                    companyId: 1,
                    productId: 7,
                    yieldQuantity: 1,
                    yieldUnit: null,
                    product,
                    components: []
                }))
            },
            product: { findFirst: jest.fn(async () => product) }
        } as unknown as Parameters<typeof ProductionRecipeService.computeRecipeCost>[2];

        const cost = await ProductionRecipeService.computeRecipeCost(11, 1, db);

        expect(cost.yieldBaseQuantity).toBe(1);
        expect(cost.yieldBaseUnit).toBe('g');
    });
});
