import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { CostingService } from '../../services/costing.service';
import { ProductionRecipeService } from '../../services/production-recipe.service';
import { ProductionOrderService } from '../../services/production-order.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import { AuditLogService } from '../../services/audit-log.service';

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
    it('propagates an audit failure inside a status transaction so the transition can roll back', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            productionOrder: {
                findFirst: jest.fn(async () => ({
                    id: 8,
                    companyId: 1,
                    status: 'DRAFT',
                    startedAt: null
                })),
                update: jest.fn(async (_args: unknown) => ({ id: 8, status: 'PENDING' }))
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        jest.spyOn(AuditLogService, 'log').mockRejectedValue(new Error('audit unavailable'));

        await expect(ProductionOrderService.setStatus(8, 1, 'PENDING', 9))
            .rejects.toThrow('audit unavailable');

        expect(AuditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({ entityType: 'ProductionOrder', entityId: 8 }),
            tx as never
        );
    });

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

    it('rejects all-zero real consumptions before mutating stock or the order', async () => {
        jest.spyOn(prisma.productionOrder, 'findFirst').mockResolvedValue({
            id: 8, companyId: 1, status: 'IN_PROGRESS', recipeId: null,
            items: [{ id: 1, componentProductId: 12, requiredQuantity: 4 }]
        } as never);
        const transaction = jest.spyOn(prisma, '$transaction');
        const movement = jest.spyOn(InventoryEngineService, 'applyMovement');

        await expect(ProductionOrderService.finish(8, 1, 9, {
            consumptions: [{ componentProductId: 12, consumedQuantity: 0 }]
        })).rejects.toThrow(/consumir al menos un insumo/i);

        expect(transaction).not.toHaveBeenCalled();
        expect(movement).not.toHaveBeenCalled();
    });

    it('allows mixed zero and positive overrides while posting only the positive input', async () => {
        const order = {
            id: 8, companyId: 1, branchId: 2, status: 'IN_PROGRESS', recipeId: null,
            productId: 30, warehouseId: 4, code: 'PRD-8', plannedQuantity: 1,
            items: [
                { id: 1, componentProductId: 12, requiredQuantity: 4 },
                { id: 2, componentProductId: 13, requiredQuantity: 3 }
            ]
        };
        jest.spyOn(prisma.productionOrder, 'findFirst').mockResolvedValue(order as never);
        const itemUpdate = jest.fn(async (_args: unknown) => ({}));
        const tx = {
            $queryRaw: jest.fn(async () => []),
            productionOrder: {
                findFirst: jest.fn(async () => order),
                update: jest.fn(async (_args: unknown) => ({ ...order, status: 'FINISHED' }))
            },
            productionOrderItem: { update: itemUpdate },
            product: { findFirst: jest.fn(async ({ where }: { where: { id: number } }) => ({ id: where.id, name: `P${where.id}` })) },
            stock: { aggregate: jest.fn(async () => ({ _sum: { quantity: 0 } })) }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        const movement = jest.spyOn(InventoryEngineService, 'applyMovement')
            .mockResolvedValueOnce({ movementId: 1, unitCost: 5, totalCost: 10, balanceQty: 0, balanceCost: 0, consumedLayers: [] })
            .mockResolvedValueOnce({ movementId: 2, unitCost: 10, totalCost: 10, balanceQty: 1, balanceCost: 10, consumedLayers: [] });
        jest.spyOn(CostingService, 'applyProductionCost').mockResolvedValue();
        jest.spyOn(AuditLogService, 'log').mockResolvedValue({} as never);

        await ProductionOrderService.finish(8, 1, 9, {
            producedQuantity: 1,
            consumptions: [
                { componentProductId: 12, consumedQuantity: 0 },
                { componentProductId: 13, consumedQuantity: 2 }
            ]
        });

        const inputCalls = movement.mock.calls.filter((call) => call[1].type === 'OUT');
        expect(inputCalls).toHaveLength(1);
        expect(inputCalls[0][1]).toEqual(expect.objectContaining({ productId: 13, quantity: 2 }));
        expect(itemUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 1 }, data: { consumedQuantity: 0, totalCost: 0 }
        }));
        expect(tx.productionOrder.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: 'FINISHED',
                finishedById: 9
            })
        }));
        expect(AuditLogService.log).toHaveBeenCalledWith(
            expect.objectContaining({
                entityType: 'ProductionOrder',
                entityId: 8,
                details: expect.objectContaining({ status: 'FINISHED' })
            }),
            tx as never
        );
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
