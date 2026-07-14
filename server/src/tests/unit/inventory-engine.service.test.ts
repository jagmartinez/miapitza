import { describe, expect, it, jest } from '@jest/globals';

import { InventoryEngineService } from '../../services/inventory-engine.service';

type Tx = Parameters<typeof InventoryEngineService.applyMovement>[0];

interface BatchRow {
    id: number;
    unitCost: number;
    remainingQty: number;
    sourceRef?: string | null;
    sourceType?: string;
    createdAt?: Date;
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
        warehouse: {
            findFirst: jest.fn(async () => ({ id: 1 }))
        },
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

describe('Inventory engine numeric invariants', () => {
    it('rejects a warehouse from another tenant before reading or creating stock', async () => {
        const { tx, stockUpdates } = makeTx({ costingMethod: 'WEIGHTED_AVERAGE', stockQuantity: 0 });
        (tx.warehouse.findFirst as ReturnType<typeof jest.fn>).mockResolvedValueOnce(null);
        await expect(InventoryEngineService.applyMovement(tx, {
            type: 'IN', companyId: 99, warehouseId: 1, productId: 1, userId: 1, quantity: 1
        })).rejects.toThrow(/Almacén no encontrado/i);
        expect(tx.stock.findUnique).not.toHaveBeenCalled();
        expect(stockUpdates).toHaveLength(0);
    });

    it('rejects a product from another tenant before reading or creating stock', async () => {
        const { tx, stockUpdates } = makeTx({ costingMethod: 'WEIGHTED_AVERAGE', stockQuantity: 0 });
        (tx.product.findFirst as ReturnType<typeof jest.fn>).mockResolvedValueOnce(null);
        await expect(InventoryEngineService.applyMovement(tx, {
            type: 'IN', companyId: 99, warehouseId: 1, productId: 1, userId: 1, quantity: 1
        })).rejects.toThrow(/Producto no encontrado/i);
        expect(tx.stock.findUnique).not.toHaveBeenCalled();
        expect(stockUpdates).toHaveLength(0);
    });

    it.each([NaN, Infinity, -Infinity, 0, -1])('rejects invalid quantity %s without mutation', async (quantity) => {
        const { tx, stockUpdates } = makeTx({ costingMethod: 'WEIGHTED_AVERAGE', stockQuantity: 0 });
        await expect(InventoryEngineService.applyMovement(tx, {
            type: 'IN', companyId: 1, warehouseId: 1, productId: 1, userId: 1, quantity
        })).rejects.toThrow(/cantidad/i);
        expect(stockUpdates).toHaveLength(0);
    });

    it.each([NaN, Infinity, -Infinity, -1])('rejects invalid cost %s without mutation', async (unitCost) => {
        const { tx, stockUpdates } = makeTx({ costingMethod: 'WEIGHTED_AVERAGE', stockQuantity: 0 });
        await expect(InventoryEngineService.applyMovement(tx, {
            type: 'IN', companyId: 1, warehouseId: 1, productId: 1, userId: 1, quantity: 1, unitCost
        })).rejects.toThrow(/costo unitario/i);
        expect(stockUpdates).toHaveLength(0);
    });

    it('consumes fractional FIFO layers as sum of take times layer cost', async () => {
        const { tx, batchUpdates } = makeTx({
            costingMethod: 'FIFO', stockQuantity: 2.25, avgCost: 4,
            batches: [
                { id: 1, unitCost: 1.25, remainingQty: 0.5 },
                { id: 2, unitCost: 2.5, remainingQty: 0.75 },
                { id: 3, unitCost: 10, remainingQty: 1 }
            ]
        });
        // 0.5*1.25 + 0.75*2.5 + 0.25*10 = 5; layer 3 retains 0.75.
        const result = await InventoryEngineService.applyMovement(tx, {
            type: 'OUT', companyId: 1, warehouseId: 1, productId: 1, userId: 1, quantity: 1.5
        });
        expect(result.totalCost).toBeCloseTo(5, 12);
        expect(result.balanceQty).toBeCloseTo(0.75, 12);
        expect(batchUpdates.map((u) => u.data.remainingQty)).toEqual([0, 0, 0.75]);
    });
});

describe('InventoryEngineService.applyMovement — IN opens a FIFO layer', () => {
    it('rejects FIFO inbound movement when legacy stock has no opening layer', async () => {
        const { tx, stockUpdates } = makeTx({
            costingMethod: 'FIFO', stockQuantity: 3, avgCost: 5, batches: []
        });
        await expect(InventoryEngineService.applyMovement(tx, {
            type: 'IN', companyId: 1, warehouseId: 1, productId: 1, userId: 1,
            quantity: 1, unitCost: 6
        })).rejects.toThrow(/FIFO inconsistente/i);
        expect(stockUpdates).toHaveLength(0);
    });

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

    it('restores exact FIFO layer metadata instead of averaging a reversal', async () => {
        const { tx, batchCreates } = makeTx({
            costingMethod: 'FIFO',
            stockQuantity: 0,
            avgCost: 5,
            batches: []
        });
        const acquiredAt = new Date('2025-01-02T03:04:05.000Z');

        await InventoryEngineService.applyMovement(tx, {
            type: 'IN', companyId: 1, warehouseId: 1, productId: 1, userId: 1,
            quantity: 5,
            inboundLayers: [
                { quantity: 2, unitCost: 3, sourceRef: 'PO-1', sourceType: 'PURCHASE', createdAt: acquiredAt },
                { quantity: 3, unitCost: 7, sourceRef: 'PO-2', sourceType: 'PURCHASE', createdAt: acquiredAt }
            ]
        });

        expect(batchCreates).toHaveLength(2);
        expect(batchCreates[0]).toMatchObject({
            originalQty: 2, remainingQty: 2, unitCost: 3,
            sourceRef: 'PO-1', sourceType: 'PURCHASE', createdAt: acquiredAt
        });
        expect(batchCreates[1]).toMatchObject({
            originalQty: 3, remainingQty: 3, unitCost: 7,
            sourceRef: 'PO-2', sourceType: 'PURCHASE', createdAt: acquiredAt
        });
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

    it('consumes only the requested production layer during an exact reversal', async () => {
        const { tx, batchUpdates } = makeTx({
            costingMethod: 'FIFO',
            stockQuantity: 15,
            avgCost: 6,
            batches: [
                { id: 1, unitCost: 4, remainingQty: 10, sourceRef: 'PO-1' },
                { id: 2, unitCost: 8, remainingQty: 5, sourceRef: 'PROD-7' }
            ]
        });

        await InventoryEngineService.applyMovement(tx, {
            type: 'OUT',
            companyId: 1,
            warehouseId: 1,
            productId: 1,
            userId: 1,
            quantity: 5,
            unitCost: 8,
            consumeSourceRef: 'PROD-7'
        });

        expect(batchUpdates).toEqual([{ where: { id: 2 }, data: { remainingQty: 0 } }]);
    });

    it('rejects an exact reversal when its own layer was already consumed', async () => {
        const { tx, stockUpdates } = makeTx({
            costingMethod: 'WEIGHTED_AVERAGE',
            stockQuantity: 10,
            avgCost: 6,
            batches: [
                { id: 1, unitCost: 4, remainingQty: 9, sourceRef: 'PO-1' },
                { id: 2, unitCost: 8, remainingQty: 1, sourceRef: 'PROD-7' }
            ]
        });

        await expect(InventoryEngineService.applyMovement(tx, {
            type: 'OUT',
            companyId: 1,
            warehouseId: 1,
            productId: 1,
            userId: 1,
            quantity: 5,
            unitCost: 8,
            consumeSourceRef: 'PROD-7'
        })).rejects.toThrow(/reversa exacta/i);

        expect(stockUpdates).toHaveLength(0);
    });
});
