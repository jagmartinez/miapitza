import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { InventoryEngineService, COST_TRUE_UP_ORIGIN } from '../../services/inventory-engine.service';
import { ProductionRecipeService } from '../../services/production-recipe.service';

type Tx = Parameters<typeof InventoryEngineService.applyMovement>[0];

function makeTx(opts: {
    costingMethod: 'WEIGHTED_AVERAGE' | 'FIFO';
    stockQuantity: number;
    negativeBalanceCost?: number;
    avgCost?: number;
    cost?: number;
    averageCostKnown?: boolean;
}) {
    const movementCreates: Array<Record<string, unknown>> = [];
    const stockUpdates: Array<Record<string, unknown>> = [];
    const batchCreates: Array<Record<string, unknown>> = [];
    let nextMovementId = 100;
    const tx = {
        warehouse: { findFirst: jest.fn(async () => ({ id: 1 })) },
        stock: {
            findUnique: jest.fn(async () => ({
                id: 1,
                quantity: opts.stockQuantity,
                negativeBalanceCost: opts.negativeBalanceCost ?? 0
            })),
            create: jest.fn(async () => ({ id: 1, quantity: 0 })),
            update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                stockUpdates.push(args.data);
                return {};
            })
        },
        product: {
            findFirst: jest.fn(async () => ({
                currentAverageCost: opts.avgCost ?? 0,
                averageCostKnown: opts.averageCostKnown ?? false,
                cost: opts.cost ?? 0,
                referenceCostKnown: false
            })),
            update: jest.fn(async () => ({}))
        },
        company: { findUnique: jest.fn(async () => ({ costingMethod: opts.costingMethod })) },
        inventoryBatch: {
            findMany: jest.fn(async () => []),
            findFirst: jest.fn(async () => null),
            create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                batchCreates.push(args.data);
                return { id: batchCreates.length };
            }),
            update: jest.fn(async () => ({})),
            updateMany: jest.fn(async () => ({ count: 1 }))
        },
        inventoryMovement: {
            create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                movementCreates.push(args.data);
                nextMovementId += 1;
                return { id: nextMovementId };
            })
        },
        $queryRaw: jest.fn(async () => [])
    } as unknown as Tx;
    return { tx, movementCreates, stockUpdates, batchCreates };
}

const base = { companyId: 1, warehouseId: 1, productId: 1, userId: 1 };

afterEach(() => {
    jest.restoreAllMocks();
});

describe('Negative-stock provisional cost (D1a)', () => {
    it('values an uncovered FIFO sale of a never-costed intermediate at its recipe cost', async () => {
        jest.spyOn(ProductionRecipeService, 'resolveProductUnitCost').mockResolvedValue(2);
        const { tx, stockUpdates, movementCreates } = makeTx({ costingMethod: 'FIFO', stockQuantity: 0 });

        const result = await InventoryEngineService.applyMovement(tx, {
            ...base, type: 'OUT', quantity: 3, allowNegative: true
        });

        expect(result.unitCost).toBeCloseTo(2, 6);
        expect(result.totalCost).toBeCloseTo(6, 6);
        expect(movementCreates[0].consumedLayers).toEqual([expect.objectContaining({ quantity: 3, unitCost: 2 })]);
        expect(stockUpdates[0]).toEqual({ quantity: -3, negativeBalanceCost: 6 });
    });

    it('uses a provisional cost under WA instead of PRODUCT_COST_MISSING when negative stock is authorized', async () => {
        jest.spyOn(ProductionRecipeService, 'resolveProductUnitCost').mockResolvedValue(1.5);
        const { tx, stockUpdates } = makeTx({ costingMethod: 'WEIGHTED_AVERAGE', stockQuantity: 1 });

        const result = await InventoryEngineService.applyMovement(tx, {
            ...base, type: 'OUT', quantity: 3, allowNegative: true
        });

        expect(result.totalCost).toBeCloseTo(4.5, 6);
        // Only the 2 unbacked units enter the provisional deficit.
        expect(stockUpdates[0]).toEqual({ quantity: -2, negativeBalanceCost: 3 });
    });

    it('still rejects an unknown-cost WA outflow without allowNegative', async () => {
        const spy = jest.spyOn(ProductionRecipeService, 'resolveProductUnitCost');
        const { tx } = makeTx({ costingMethod: 'WEIGHTED_AVERAGE', stockQuantity: 5 });

        await expect(InventoryEngineService.applyMovement(tx, {
            ...base, type: 'OUT', quantity: 1
        })).rejects.toThrow(/PRODUCT_COST_MISSING/);
        expect(spy).not.toHaveBeenCalled();
    });

    it('values at 0 (later trued up) when nothing resolves and the sale is authorized', async () => {
        jest.spyOn(ProductionRecipeService, 'resolveProductUnitCost').mockRejectedValue(new Error('circular'));
        const { tx, stockUpdates } = makeTx({ costingMethod: 'FIFO', stockQuantity: 0 });

        const result = await InventoryEngineService.applyMovement(tx, {
            ...base, type: 'OUT', quantity: 2, allowNegative: true
        });

        expect(result.totalCost).toBe(0);
        expect(stockUpdates[0]).toEqual({ quantity: -2, negativeBalanceCost: 0 });
    });
});

describe('Negative-stock cost true-up (D1b)', () => {
    it('FIFO: posts the trimmed value minus the provisional cost as a COST_TRUE_UP row', async () => {
        const { tx, movementCreates, stockUpdates, batchCreates } = makeTx({
            costingMethod: 'FIFO', stockQuantity: -3, negativeBalanceCost: 6, avgCost: 2, averageCostKnown: true
        });

        const result = await InventoryEngineService.applyMovement(tx, {
            ...base, type: 'IN', quantity: 10, unitCost: 5, reference: 'PO-9'
        });

        expect(batchCreates).toHaveLength(1);
        expect(Number(batchCreates[0].remainingQty)).toBeCloseTo(7, 6);
        expect(result.balanceCost).toBeCloseTo(35, 6);
        expect(stockUpdates[0]).toEqual({ quantity: 7, negativeBalanceCost: 0 });

        expect(movementCreates).toHaveLength(2);
        const trueUp = movementCreates[1];
        expect(trueUp).toMatchObject({
            type: 'ADJUSTMENT',
            origin: COST_TRUE_UP_ORIGIN,
            direction: 'OUT',
            quantity: 0,
            // Coverage rows record the real unit cost of the covered units.
            unitCost: 5,
            reference: 'PO-9',
            balanceQty: 7
        });
        // 3 covered units cost 15 for real, 6 were charged provisionally.
        expect(Number(trueUp.totalCost)).toBeCloseTo(9, 6);
        expect(Number(trueUp.balanceCost)).toBeCloseTo(35, 6);
        expect(result.costTrueUp).toEqual({ movementId: 102, amount: 9, coveredQty: 3 });
    });

    it('WA: partial coverage trues up pro rata and keeps the remaining provisional deficit', async () => {
        const { tx, movementCreates, stockUpdates } = makeTx({
            costingMethod: 'WEIGHTED_AVERAGE', stockQuantity: -4, negativeBalanceCost: 8, avgCost: 2, averageCostKnown: true
        });

        const result = await InventoryEngineService.applyMovement(tx, {
            ...base, type: 'IN', quantity: 2, unitCost: 3
        });

        expect(stockUpdates[0]).toEqual({ quantity: -2, negativeBalanceCost: 4 });
        // The IN carries the provisional deficit (-8) plus the entry (6).
        expect(result.balanceCost).toBeCloseTo(-2, 6);
        const trueUp = movementCreates[1];
        expect(Number(trueUp.totalCost)).toBeCloseTo(2, 6);
        // Remaining deficit is restated at its provisional value: -2 u x 2.
        expect(Number(trueUp.balanceCost)).toBeCloseTo(-4, 6);
        expect(trueUp.direction).toBe('OUT');
    });

    it('posts an IN-direction true-up when the real cost is below the provisional cost', async () => {
        const { tx, movementCreates } = makeTx({
            costingMethod: 'FIFO', stockQuantity: -2, negativeBalanceCost: 10, avgCost: 5, averageCostKnown: true
        });

        const result = await InventoryEngineService.applyMovement(tx, {
            ...base, type: 'IN', quantity: 2, unitCost: 4
        });

        expect(movementCreates[1].direction).toBe('IN');
        expect(Number(movementCreates[1].totalCost)).toBeCloseTo(2, 6);
        expect(result.costTrueUp?.amount).toBeCloseTo(-2, 6);
    });

    it('posts nothing when the inbound cost equals the provisional cost', async () => {
        const { tx, movementCreates, stockUpdates } = makeTx({
            costingMethod: 'FIFO', stockQuantity: -2, negativeBalanceCost: 10, avgCost: 5, averageCostKnown: true
        });

        const result = await InventoryEngineService.applyMovement(tx, {
            ...base, type: 'IN', quantity: 5, unitCost: 5
        });

        expect(movementCreates).toHaveLength(1);
        expect(result.costTrueUp).toBeUndefined();
        expect(stockUpdates[0]).toEqual({ quantity: 3, negativeBalanceCost: 0 });
    });
});
