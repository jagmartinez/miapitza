import { afterEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../../utils/prisma';
import { OrderService } from '../../services/order.service';
import { buildKitchenNotificationDedupKey } from '../../services/kitchen-notification.service';

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

function batchRow(overrides: Record<string, unknown> = {}) {
    const sentAt = new Date('2026-07-29T12:30:00.000Z');
    return {
        id: 81,
        companyId: 1,
        branchId: 2,
        orderId: 41,
        sequence: 2,
        status: 'PENDING',
        sentAt,
        startedAt: null,
        readyAt: null,
        releasedAt: null,
        startedById: null,
        releasedById: null,
        createdAt: sentAt,
        updatedAt: sentAt,
        order: {
            id: 41,
            companyId: 1,
            branchId: 2,
            tableId: 7,
            userId: 9,
            status: 'SENT_TO_KITCHEN',
            financialStatus: 'UNPAID',
            total: 20,
            createdAt: new Date('2026-07-29T12:00:00.000Z'),
            table: { id: 7, number: '7' },
            user: { id: 9, name: 'Ana', color: '#123456' },
        },
        items: [{
            id: 12,
            orderId: 41,
            menuItemId: 5,
            kitchenBatchId: 81,
            quantity: 1,
            price: 20,
            subtotal: 20,
            notes: null,
            status: 'PENDING',
            sentAt,
            startedAt: null,
            finishedAt: null,
            menuItem: { id: 5, name: 'Pizza' },
            modifiers: [],
        }],
        ...overrides,
    };
}

function compatibilityOrder(activeStatuses: string[]) {
    return {
        id: 41,
        status: 'SENT_TO_KITCHEN',
        kitchenReleasedAt: null,
        items: [],
        kitchenBatches: activeStatuses.map((status) => ({
            status,
            startedAt: null,
            startedById: null,
            releasedAt: null,
            releasedById: null,
        })),
    };
}

describe('persistent KDS batches', () => {
    it('keeps active table debt recoverable and queries independent KDS batches', async () => {
        const orderFindMany = jest.spyOn(prisma.order, 'findMany').mockResolvedValue([]);
        const batchFindMany = jest.spyOn(prisma.kitchenBatch, 'findMany').mockResolvedValue([]);

        await OrderService.getActiveOrders(1, 2);
        expect(orderFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED'] },
                financialStatus: { not: 'PAID' },
            }),
        }));

        await OrderService.getKitchenQueue(1, 2);
        expect(batchFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                companyId: 1,
                branchId: 2,
                status: { in: ['PENDING', 'IN_PREPARATION', 'READY'] },
                order: { status: { notIn: ['CANCELLED', 'DELIVERED'] } },
            }),
        }));
    });

    it('returns two simultaneous sends from one commercial order as separate KDS cards', async () => {
        jest.spyOn(prisma.kitchenBatch, 'findMany').mockResolvedValue([
            batchRow({
                id: 80,
                sequence: 1,
                sentAt: new Date('2026-07-29T12:00:00.000Z'),
                items: [{
                    ...batchRow().items[0],
                    id: 11,
                    kitchenBatchId: 80,
                    sentAt: new Date('2026-07-29T12:00:00.000Z'),
                }],
            }),
            batchRow(),
        ] as never);

        const queue = await OrderService.getKitchenQueue(1, 2);

        expect(queue).toHaveLength(2);
        expect(queue.map((entry) => entry.kitchenBatchId)).toEqual([80, 81]);
        expect(queue.map((entry) => entry.kitchenBatchSequence)).toEqual([1, 2]);
        expect(queue.map((entry) => entry.items.map((item) => item.id))).toEqual([[11], [12]]);
    });

    it('creates a new pending batch even while a previous batch remains active', async () => {
        const now = new Date('2026-07-29T12:30:00.000Z');
        jest.useFakeTimers().setSystemTime(now);
        const created = batchRow();
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 41,
                    branchId: 2,
                    status: 'IN_PREPARATION',
                    items: [
                        { id: 11, sentAt: new Date('2026-07-29T12:00:00.000Z'), status: 'IN_PROGRESS' },
                        { id: 12, sentAt: null, status: 'PENDING' },
                    ],
                })),
                findUnique: jest.fn(async () => compatibilityOrder(['IN_PREPARATION', 'PENDING'])),
                update: jest.fn(async (_args: unknown) => ({})),
            },
            kitchenBatch: {
                aggregate: jest.fn(async () => ({ _max: { sequence: 1 } })),
                create: jest.fn(async (_args: unknown) => ({ ...created, order: undefined, items: undefined })),
                findUnique: jest.fn(async () => created),
            },
            orderItem: { updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })) },
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        const result = await OrderService.sendToKitchen(41, 1);

        expect(tx.kitchenBatch.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                orderId: 41,
                sequence: 2,
                status: 'PENDING',
                sentAt: now,
            }),
        });
        expect(tx.orderItem.updateMany).toHaveBeenCalledWith({
            where: { orderId: 41, sentAt: null },
            data: { sentAt: now, kitchenBatchId: 81 },
        });
        expect(result).toMatchObject({
            kitchenBatchId: 81,
            kitchenBatchSequence: 2,
            kitchenBatchSent: true,
        });
    });

    it('treats an offline retry with no unsent products as an idempotent no-op', async () => {
        const current = batchRow();
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 41,
                    branchId: 2,
                    status: 'SENT_TO_KITCHEN',
                    items: [{ id: 12, sentAt: current.sentAt, status: 'PENDING' }],
                })),
                findUnique: jest.fn(async () => compatibilityOrder(['PENDING'])),
                update: jest.fn(async (_args: unknown) => ({})),
            },
            kitchenBatch: {
                findFirst: jest.fn(async () => current),
            },
            orderItem: { updateMany: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        const result = await OrderService.sendToKitchen(41, 1);

        expect(result).toMatchObject({ kitchenBatchId: 81, kitchenBatchSent: false });
        expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('restores READY on a no-op send when a released order was left OPEN with nothing unsent', async () => {
        const released = batchRow({ status: 'RELEASED' });
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 41,
                    branchId: 2,
                    status: 'OPEN',
                    items: [{ id: 12, sentAt: released.sentAt, status: 'DONE' }],
                })),
                findUnique: jest.fn(async () => ({ ...compatibilityOrder(['RELEASED']), status: 'OPEN' })),
                update: jest.fn(async (_args: unknown) => ({})),
            },
            kitchenBatch: { findFirst: jest.fn(async () => released) },
            orderItem: { updateMany: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        await OrderService.sendToKitchen(41, 1);

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 41 },
            data: expect.objectContaining({ status: 'READY' }),
        }));
    });

    it('restores READY after removing the only draft line added to a released order', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            orderItem: {
                findFirst: jest.fn(async () => ({ orderId: 41 })),
                findUnique: jest.fn(async () => ({
                    id: 13,
                    orderId: 41,
                    sentAt: null,
                    order: {
                        id: 41, companyId: 1, branchId: 2, status: 'OPEN', invoiceNumber: null,
                        preInvoicedAt: null, discount: 0, discountCode: null, tipAmount: 0, payments: [],
                    },
                })),
                delete: jest.fn(async () => ({})),
                findMany: jest.fn(async () => [{ subtotal: 20 }]),
            },
            setting: { findMany: jest.fn(async () => []) },
            order: {
                findUnique: jest.fn(async () => ({ ...compatibilityOrder(['RELEASED']), status: 'OPEN' })),
                update: jest.fn(async (_args: unknown) => ({})),
            },
            kitchenBatch: { count: jest.fn(async () => 1) },
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        await expect(OrderService.removeItem(13, 1)).resolves.toEqual({ success: true });

        expect(tx.order.update).toHaveBeenLastCalledWith(expect.objectContaining({
            where: { id: 41 },
            data: expect.objectContaining({ status: 'READY' }),
        }));
    });

    it('starts only the requested batch and stamps its own lifecycle', async () => {
        const pending = batchRow();
        const inPreparation = batchRow({
            status: 'IN_PREPARATION',
            startedAt: new Date('2026-07-29T12:31:00.000Z'),
            items: batchRow().items.map((item) => ({
                ...item,
                status: 'IN_PROGRESS',
                startedAt: new Date('2026-07-29T12:31:00.000Z'),
            })),
        });
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({ id: 41, branchId: 2 })),
                findUnique: jest.fn(async () => compatibilityOrder(['IN_PREPARATION', 'PENDING'])),
                update: jest.fn(async (_args: unknown) => ({})),
            },
            kitchenBatch: {
                findFirst: jest.fn(async () => pending),
                update: jest.fn(async (_args: unknown) => ({})),
                findUnique: jest.fn(async () => inPreparation),
            },
            orderItem: { updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })) },
            auditLog: { create: jest.fn(async () => ({})) },
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        const result = await OrderService.startKitchenPreparation(41, 1, 9, 81);

        expect(tx.orderItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { orderId: 41, kitchenBatchId: 81, status: 'PENDING' },
        }));
        expect(tx.kitchenBatch.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 81 },
            data: expect.objectContaining({ status: 'IN_PREPARATION', startedById: 9 }),
        }));
        expect(result).toMatchObject({ changed: true, kitchenBatchId: 81 });
    });

    it('finishes one item and marks only its batch READY', async () => {
        const inPreparation = batchRow({
            status: 'IN_PREPARATION',
            startedAt: new Date('2026-07-29T12:31:00.000Z'),
            startedById: 9,
        });
        const ready = batchRow({
            status: 'READY',
            startedAt: new Date('2026-07-29T12:31:00.000Z'),
            readyAt: new Date('2026-07-29T12:40:00.000Z'),
            items: batchRow().items.map((item) => ({
                ...item,
                status: 'DONE',
                startedAt: new Date('2026-07-29T12:31:00.000Z'),
                finishedAt: new Date('2026-07-29T12:40:00.000Z'),
            })),
        });
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({ status: 'IN_PREPARATION' })),
                findUnique: jest.fn(async () => compatibilityOrder(['READY', 'PENDING'])),
                update: jest.fn(async (_args: unknown) => ({})),
            },
            orderItem: {
                findFirst: jest.fn(async () => ({ kitchenBatchId: 81 })),
                updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })),
                findUnique: jest.fn(async () => ready.items[0]),
                count: jest.fn(async (_args: unknown) => 0),
            },
            kitchenBatch: {
                findFirst: jest.fn(async () => inPreparation),
                update: jest.fn(async (_args: unknown) => ({})),
                findUnique: jest.fn(async () => ready),
            },
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        const result = await OrderService.finishItem(41, 12, 1, 9);

        expect(tx.orderItem.count).toHaveBeenCalledWith({
            where: { kitchenBatchId: 81, status: { not: 'DONE' } },
        });
        expect(tx.kitchenBatch.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 81 },
            data: expect.objectContaining({ status: 'READY' }),
        }));
        expect(result).toMatchObject({ allDone: true, kitchenBatchId: 81 });
    });

    it('releases exactly one READY batch without hiding a later pending send', async () => {
        const ready = batchRow({ status: 'READY', readyAt: new Date('2026-07-29T12:40:00.000Z') });
        const released = batchRow({
            status: 'RELEASED',
            readyAt: new Date('2026-07-29T12:40:00.000Z'),
            releasedAt: new Date('2026-07-29T12:41:00.000Z'),
        });
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({ id: 41, branchId: 2, status: 'SENT_TO_KITCHEN' })),
                findUnique: jest.fn(async () => compatibilityOrder(['RELEASED', 'PENDING'])),
                update: jest.fn(async (_args: unknown) => ({})),
            },
            kitchenBatch: {
                findFirst: jest.fn(async () => ready),
                update: jest.fn(async (_args: unknown) => ({})),
                findUnique: jest.fn(async () => released),
            },
            auditLog: { create: jest.fn(async () => ({})) },
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        const result = await OrderService.releaseFromKitchen(41, 1, 9, 81);

        expect(tx.kitchenBatch.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 81 },
            data: expect.objectContaining({ status: 'RELEASED', releasedById: 9 }),
        }));
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: 'SENT_TO_KITCHEN' }),
        }));
        expect(result).toMatchObject({ changed: true, kitchenBatchId: 81 });
    });

    it('deduplicates the same batch event while allowing another batch of the same order', () => {
        const timestamp = new Date('2026-07-29T12:40:00.000Z');
        const first = buildKitchenNotificationDedupKey({
            orderId: 41,
            kitchenBatchId: 80,
            eventType: 'ORDER_READY',
            eventTimestamp: timestamp,
        });
        const retry = buildKitchenNotificationDedupKey({
            orderId: 41,
            kitchenBatchId: 80,
            eventType: 'ORDER_READY',
            eventTimestamp: timestamp,
        });
        const secondBatch = buildKitchenNotificationDedupKey({
            orderId: 41,
            kitchenBatchId: 81,
            eventType: 'ORDER_READY',
            eventTimestamp: timestamp,
        });

        expect(retry).toBe(first);
        expect(secondBatch).not.toBe(first);
    });
});

describe('KDS migration contract', () => {
    it('persists independent batches, backfills sent waves and links every sent line', () => {
        const sql = fs.readFileSync(path.resolve(
            process.cwd(),
            'prisma/migrations/20260730_add_persistent_kitchen_batches/migration.sql',
        ), 'utf8');
        expect(sql).toContain('CREATE TABLE `KitchenBatch`');
        expect(sql).toContain('ROW_NUMBER() OVER');
        expect(sql).toContain('ADD COLUMN `kitchenBatchId`');
        expect(sql).toContain('SET oi.`kitchenBatchId` = kb.`id`');
    });

    it('keeps batch identity in the API and KDS card key', () => {
        const service = fs.readFileSync(path.resolve(process.cwd(), 'src/services/order.service.ts'), 'utf8');
        const client = fs.readFileSync(path.resolve(process.cwd(), '../client/src/pages/Kitchen.tsx'), 'utf8');
        expect(service).toContain('kitchenBatchId: batch.id');
        expect(service).toContain("status: { in: ['PENDING', 'IN_PREPARATION', 'READY'] }");
        expect(client).toContain("`${order.id}:${order.kitchenBatchId ?? 'legacy'}`");
    });
});
