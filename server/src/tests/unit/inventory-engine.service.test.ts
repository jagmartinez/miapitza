import { describe, expect, it, jest } from '@jest/globals';

import { InventoryEngineService } from '../../services/inventory-engine.service';

type Tx = Parameters<typeof InventoryEngineService.applyMovement>[0];

interface BatchRow {
    id: number;
    unitCost: number;
    remainingQty: number;
}

/**
 * Minimal transaction-client mock for the inventory engine, in the style of
 * production.service.test.ts: jest-mocked tx.stock / tx.inventoryMovement /
 * tx.inventoryBatch / tx.company / tx.product, and tx.$queryRaw -> [] for the lock.
 */
function makeTx(opts: {
    costingMethod: 'WEIGHTED_AVERAGE' | 'FIFO';
    stockQuantity: number;
    avgCost?: number | null;
    cost?: number | null;
    batches?: BatchRow[];
}) {
    const batchCreates: Array<Record<string, unknown>> = [];
    const batchUpdates: Array<{ where: { id: number }; data: { remainingQty: number } }> = [];
    const movementCreates: Array<Record<string, unknown>> = [];
    const stockUpdates: Array<Record<string, unknown>> = [];

    const tx = {
        stock: {
            findUnique: jest.fn(async () => ({ id: 1, quantity: opts.stockQuantity })),
            create: jest.fn(async () => ({ id: 1, quantity: 0 })),
            update: jest.fn(async (args: { data: Record<string, unknown> }) => {
                stockUpdates.push(args.data);
                return {};
            })
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
            create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                batchCreates.push(args.data);
                return {};
            }),
            update: jest.fn(async (args: { where: { id: number }; data: { remainingQty: number } }) => {
                batchUpdates.push(args);
                return {};
            })
        },
        inventoryMovement: {
            create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                movementCreates.push(args.data);
                return { id: 777 };
            })
        },
        $queryRaw: jest.fn(async () => [])
    } as unknown as Tx;

    return { tx, batchCreates, batchUpdates, movementCreates, stockUpdates };
}

describe('InventoryEngineService.applyMovement — IN opens a FIFO layer', () => {
    it('opens a batch and accumulates the valued balance on an inbound movement', async () => {
        const { tx, batchCreates, movementCreates } = makeTx({
            costingMethod: 'WEIGHTED_AVERAGE',
            stockQuantity: 10,
            avgCost: 5
        });

        // IN 10 @ 7 over 10 @ 5 -> balanceQty 20, balanceCost 10*5 + 10*7 = 120.
        const result = await InventoryEngineService.applyMovement(tx, {
            type: 'IN',
            companyId: 1,
            warehouseId: 1,
            productId: 1,
            userId: 1,
            quantity: 10,
            unitCost: 7,
            sourceType: 'PURCHASE',
            reference: 'PO-1'
        });

        expect(result.unitCost).toBe(7);
        expect(result.totalCost).toBe(70);
        expect(result.balanceQty).toBe(20);
        expect(result.balanceCost).toBeCloseTo(120, 6);

        expect(batchCreates).toHaveLength(1);
        expect(batchCreates[0].unitCost).toBe(7);
        expect(batchCreates[0].originalQty).toBe(10);
        expect(batchCreates[0].remainingQty).toBe(10);
        expect(batchCreates[0].sourceType).toBe('PURCHASE');
        expect(batchCreates[0].sourceRef).toBe('PO-1');

        expect(movementCreates).toHaveLength(1);
        expect(movementCreates[0].type).toBe('IN');
        expect(movementCreates[0].balanceQty).toBe(20);
    });

    it('falls back to currentAverageCost when no entry cost is provided', async () => {
        const { tx, batchCreates } = makeTx({
            costingMethod: 'WEIGHTED_AVERAGE',
            stockQuantity: 0,
            avgCost: 4
        });

        const result = await InventoryEngineService.applyMovement(tx, {
            type: 'IN',
            companyId: 1,
            warehouseId: 1,
            productId: 1,
            userId: 1,
            quantity: 5
        });

        expect(result.unitCost).toBe(4);
        expect(result.totalCost).toBe(20);
        expect(batchCreates[0].unitCost).toBe(4);
    });
});

describe('InventoryEngineService.applyMovement — OUT consumes FIFO layers oldest-first', () => {
    it('drains the oldest layer first under FIFO and derives the COGS', async () => {
        const { tx, batchUpdates, movementCreates } = makeTx({
            costingMethod: 'FIFO',
            stockQuantity: 10,
            avgCost: 6,
            batches: [
                { id: 1, unitCost: 4, remainingQty: 5 },
                { id: 2, unitCost: 8, remainingQty: 5 }
            ]
        });

        // Consume 7 -> 5@4 (=20) + 2@8 (=16) = 36.
        const result = await InventoryEngineService.applyMovement(tx, {
            type: 'OUT',
            companyId: 1,
            warehouseId: 1,
            productId: 1,
            userId: 1,
            quantity: 7
        });

        expect(result.totalCost).toBeCloseTo(36, 6);
        expect(result.balanceQty).toBe(3);

        // Oldest-first ordering of layer consumption.
        expect(batchUpdates[0].where.id).toBe(1);
        expect(batchUpdates[0].data.remainingQty).toBeCloseTo(0, 6);
        expect(batchUpdates[1].where.id).toBe(2);
        expect(batchUpdates[1].data.remainingQty).toBeCloseTo(3, 6);

        expect(movementCreates[0].type).toBe('OUT');
    });

    it('rejects an OUT that would drive the balance negative (no allowNegative)', async () => {
        const { tx } = makeTx({
            costingMethod: 'WEIGHTED_AVERAGE',
            stockQuantity: 2,
            avgCost: 5
        });

        await expect(
            InventoryEngineService.applyMovement(tx, {
                type: 'OUT',
                companyId: 1,
                warehouseId: 1,
                productId: 1,
                userId: 1,
                quantity: 5,
                productName: 'Harina'
            })
        ).rejects.toThrow(/Stock insuficiente para Harina/);
    });
});
