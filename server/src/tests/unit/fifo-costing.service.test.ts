import { describe, expect, it, jest } from '@jest/globals';

import { InventoryEngineService } from '../../services/inventory-engine.service';

type Tx = Parameters<typeof InventoryEngineService.applyMovement>[0];

interface BatchRow {
    id: number;
    unitCost: number;
    remainingQty: number;
}

/**
 * Build a minimal transaction-client mock exercising the engine's FIFO OUT path:
 * stock lock (`$queryRaw`), product/company lookups, the InventoryBatch layers and
 * the movement insert. Mirrors the mocking style of production.service.test.ts.
 */
function makeTx(opts: {
    costingMethod: 'WEIGHTED_AVERAGE' | 'FIFO';
    stockQuantity: number;
    avgCost?: number | null;
    cost?: number | null;
    batches?: BatchRow[];
}) {
    const batchUpdates: Array<{ where: { id: number }; data: { remainingQty: number } }> = [];
    const movementCreates: Array<Record<string, unknown>> = [];

    const tx = {
        warehouse: {
            findFirst: jest.fn(async () => ({ id: 1 }))
        },
        stock: {
            findUnique: jest.fn(async () => ({ id: 1, quantity: opts.stockQuantity })),
            create: jest.fn(async () => ({ id: 1, quantity: 0 })),
            update: jest.fn(async () => ({}))
        },
        product: {
            findFirst: jest.fn(async () => ({
                currentAverageCost: opts.avgCost ?? null,
                cost: opts.cost ?? null
            }))
        },
        company: {
            findUnique: jest.fn(async () => ({ costingMethod: opts.costingMethod }))
        },
        inventoryBatch: {
            findMany: jest.fn(async () => (opts.batches ?? []).map((b) => ({ ...b }))),
            findFirst: jest.fn(async () => null),
            create: jest.fn(async () => ({})),
            update: jest.fn(async (args: { where: { id: number }; data: { remainingQty: number } }) => {
                batchUpdates.push(args);
                return {};
            })
        },
        inventoryMovement: {
            create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                movementCreates.push(args.data);
                return { id: 999 };
            })
        },
        $queryRaw: jest.fn(async () => [])
    } as unknown as Tx;

    return { tx, batchUpdates, movementCreates };
}

describe('FIFO costing — engine OUT consumes layers oldest-first', () => {
    it('values the COGS by consuming the oldest layers first across 3 batches', async () => {
        const { tx, batchUpdates } = makeTx({
            costingMethod: 'FIFO',
            stockQuantity: 18, // 3 + 5 + 10
            avgCost: 100,
            batches: [
                { id: 1, unitCost: 6, remainingQty: 3 },
                { id: 2, unitCost: 9, remainingQty: 5 },
                { id: 3, unitCost: 12, remainingQty: 10 }
            ]
        });

        // Consume 6 -> 3@6 (=18) + 3@9 (=27) = 45 ; unit = 45/6 = 7.5
        const result = await InventoryEngineService.applyMovement(tx, {
            type: 'OUT',
            companyId: 1,
            warehouseId: 1,
            productId: 1,
            userId: 1,
            quantity: 6
        });

        expect(result.totalCost).toBeCloseTo(45, 6);
        expect(result.unitCost).toBeCloseTo(7.5, 6);
        expect(result.balanceQty).toBe(12);

        // Oldest-first: layer 1 fully drained, then layer 2 partially (5 - 3 = 2).
        expect(batchUpdates).toHaveLength(2);
        expect(batchUpdates[0].where.id).toBe(1);
        expect(batchUpdates[0].data.remainingQty).toBeCloseTo(0, 6);
        expect(batchUpdates[1].where.id).toBe(2);
        expect(batchUpdates[1].data.remainingQty).toBeCloseTo(2, 6);
    });

    it('covers the shortfall at the average cost when layers run out (graceful degradation)', async () => {
        const { tx } = makeTx({
            costingMethod: 'FIFO',
            stockQuantity: 5,
            avgCost: 5, // average used for the uncovered remainder
            batches: [{ id: 1, unitCost: 10, remainingQty: 2 }]
        });

        // Consume 5 -> 2@10 (=20) + 3@avg5 (=15) = 35 ; unit = 35/5 = 7
        const result = await InventoryEngineService.applyMovement(tx, {
            type: 'OUT',
            companyId: 1,
            warehouseId: 1,
            productId: 1,
            userId: 1,
            quantity: 5
        });

        expect(result.totalCost).toBeCloseTo(35, 6);
        expect(result.unitCost).toBeCloseTo(7, 6);
        expect(result.balanceQty).toBe(0);
    });
});
