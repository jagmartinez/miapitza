import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { OrderService } from '../../services/order.service';
import { OrderController } from '../../controllers/order.controller';
import { KitchenError } from '../../services/kitchen-errors';
import { KitchenNotificationService } from '../../services/kitchen-notification.service';
import { WebSocketService } from '../../services/websocket.service';

afterEach(() => {
    jest.restoreAllMocks();
});

type Row = Record<string, unknown>;

function kitchenTx(options: { batch?: Row | null; released?: Row | null; pendingCount?: number } = {}) {
    const batch = options.batch === undefined
        ? { id: 7, orderId: 41, sequence: 1, status: 'PENDING', startedAt: null, startedById: null }
        : options.batch;
    const batchFindFirst = jest.fn<(args: unknown) => Promise<unknown>>()
        .mockResolvedValueOnce(batch)
        .mockResolvedValue(options.released ?? null);
    return {
        $queryRaw: jest.fn(async () => []),
        order: { findFirst: jest.fn(async () => ({ id: 41, branchId: 3, status: 'SENT_TO_KITCHEN' })) },
        orderItem: { updateMany: jest.fn(async () => ({ count: options.pendingCount ?? 1 })) },
        kitchenBatch: {
            findFirst: batchFindFirst,
            findUnique: jest.fn(async () => null),
            update: jest.fn(async (args: unknown) => args),
        },
    };
}

function useTx(tx: ReturnType<typeof kitchenTx>) {
    jest.spyOn(prisma, '$transaction').mockImplementation(
        (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never,
    );
}

async function codeOf(promise: Promise<unknown>) {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(KitchenError);
        return { code: (error as KitchenError).code, status: (error as KitchenError).statusCode };
    }
    throw new Error('expected rejection');
}

describe('kitchen batch typed errors', () => {
    it('ready on RELEASED batch throws KitchenError KITCHEN_BATCH_RELEASED (409)', async () => {
        useTx(kitchenTx({ batch: null, released: { id: 7 } }));
        expect(await codeOf(OrderService.markKitchenBatchReady(41, 1, 5, 7)))
            .toEqual({ code: 'KITCHEN_BATCH_RELEASED', status: 409 });
    });

    it('release on PENDING throws KITCHEN_BATCH_NOT_READY', async () => {
        useTx(kitchenTx({ batch: { id: 7, orderId: 41, sequence: 1, status: 'PENDING' } }));
        expect(await codeOf(OrderService.releaseFromKitchen(41, 1, 5, 7)))
            .toEqual({ code: 'KITCHEN_BATCH_NOT_READY', status: 409 });
    });

    it('start with no pending items throws KITCHEN_NOTHING_PENDING', async () => {
        useTx(kitchenTx({ pendingCount: 0 }));
        expect(await codeOf(OrderService.startKitchenPreparation(41, 1, 5, 7)))
            .toEqual({ code: 'KITCHEN_NOTHING_PENDING', status: 409 });
    });

    it('unknown kitchenBatchId throws KITCHEN_BATCH_NOT_FOUND', async () => {
        useTx(kitchenTx({ batch: null, released: null }));
        expect(await codeOf(OrderService.markKitchenBatchReady(41, 1, 5, 999)))
            .toEqual({ code: 'KITCHEN_BATCH_NOT_FOUND', status: 404 });
    });

    it('start on a READY batch throws KITCHEN_INVALID_STATE', async () => {
        useTx(kitchenTx({ batch: { id: 7, orderId: 41, sequence: 1, status: 'READY' } }));
        expect(await codeOf(OrderService.startKitchenPreparation(41, 1, 5, 7)))
            .toEqual({ code: 'KITCHEN_INVALID_STATE', status: 409 });
    });
});

describe('kitchen ready controller guard', () => {
    function readyRequest(): Request {
        return {
            params: { id: '41' },
            body: { kitchenBatchId: 7 },
            user: { userId: 5, companyId: 1, branchId: 3, role: 'COCINA', roles: ['COCINA'] },
        } as unknown as Request;
    }

    function stubReady(changed: boolean) {
        jest.spyOn(OrderService, 'getById').mockResolvedValue({ id: 41, branchId: 3 } as never);
        jest.spyOn(OrderService, 'markKitchenBatchReady').mockResolvedValue({
            changed, branchId: 3, kitchenBatchId: 7, order: { id: 41, branchId: 3 },
        } as never);
        const notify = jest.spyOn(KitchenNotificationService, 'notifyReady').mockResolvedValue(undefined as never);
        const ready = jest.spyOn(WebSocketService, 'broadcastOrderReady').mockImplementation(() => undefined as never);
        jest.spyOn(WebSocketService, 'broadcastOrderUpdate').mockImplementation(() => undefined as never);
        return { notify, ready };
    }

    it('repeated ready does not broadcast ORDER_READY but still calls the deduplicated notifyReady', async () => {
        const { notify, ready } = stubReady(false);
        const res = { json: jest.fn() } as unknown as Response;
        await OrderController.markKitchenReady(readyRequest(), res, jest.fn() as unknown as NextFunction);
        expect(notify).toHaveBeenCalledTimes(1);
        expect(ready).not.toHaveBeenCalled();
    });

    it('ready replay after a failed first notification still creates the notification', async () => {
        const { notify } = stubReady(true);
        notify.mockRejectedValueOnce(new Error('transient'));
        const next = jest.fn();
        const res = { json: jest.fn() } as unknown as Response;
        await OrderController.markKitchenReady(readyRequest(), res, next as unknown as NextFunction);
        expect(next).toHaveBeenCalledTimes(1);
        jest.spyOn(OrderService, 'markKitchenBatchReady').mockResolvedValue({
            changed: false, branchId: 3, kitchenBatchId: 7, order: { id: 41, branchId: 3 },
        } as never);
        await OrderController.markKitchenReady(readyRequest(), res, next as unknown as NextFunction);
        expect(notify).toHaveBeenCalledTimes(2);
        expect(res.json).toHaveBeenCalledTimes(1);
    });

    it('first ready emits ORDER_READY and creates the notification', async () => {
        const { notify, ready } = stubReady(true);
        const res = { json: jest.fn() } as unknown as Response;
        await OrderController.markKitchenReady(readyRequest(), res, jest.fn() as unknown as NextFunction);
        expect(notify).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledTimes(1);
    });

    it('forwards a KitchenError untouched so the body carries its code', async () => {
        jest.spyOn(OrderService, 'getById').mockResolvedValue({ id: 41, branchId: 3 } as never);
        const error = new KitchenError('x', 'KITCHEN_BATCH_RELEASED');
        jest.spyOn(OrderService, 'markKitchenBatchReady').mockRejectedValue(error);
        const next = jest.fn();
        const res = { json: jest.fn() } as unknown as Response;
        await OrderController.markKitchenReady(readyRequest(), res, next as unknown as NextFunction);
        expect(next).toHaveBeenCalledWith(error);
    });
});

describe('kitchen recent list and payload', () => {
    it('recent returns RELEASED batches of the last 12 h, newest first, clamped limit, branch-scoped', async () => {
        const findMany = jest.spyOn(prisma.kitchenBatch, 'findMany').mockResolvedValue([] as never);
        const before = Date.now();
        await OrderService.getRecentKitchenBatches(1, 3, 500);
        const args = findMany.mock.calls[0][0] as unknown as { where: Row; orderBy: unknown; take: number };
        expect(args.where).toMatchObject({ companyId: 1, branchId: 3, status: 'RELEASED' });
        const since = (args.where.releasedAt as { gte: Date }).gte.getTime();
        expect(Math.abs(since - (before - 12 * 3600 * 1000))).toBeLessThan(5000);
        expect(args.orderBy).toEqual([{ releasedAt: 'desc' }, { id: 'desc' }]);
        expect(args.take).toBe(30);

        await OrderService.getRecentKitchenBatches(1, undefined, 0);
        const second = findMany.mock.calls[1][0] as unknown as { where: Row; take: number };
        expect(second.where).not.toHaveProperty('branchId');
        expect(second.take).toBe(1);

        await OrderService.getRecentKitchenBatches(1, 3);
        expect((findMany.mock.calls[2][0] as unknown as { take: number }).take).toBe(10);
    });

    it('batch payload includes kitchenReadyAt', async () => {
        const readyAt = new Date('2026-11-20T12:05:00Z');
        jest.spyOn(prisma.kitchenBatch, 'findMany').mockResolvedValue([{
            id: 7, sequence: 1, status: 'READY', sentAt: new Date('2026-11-20T12:00:00Z'),
            startedAt: null, releasedAt: null, readyAt,
            order: { id: 41 }, items: [],
        }] as never);
        const [row] = await OrderService.getKitchenQueue(1, 3) as unknown as Array<{ kitchenReadyAt: Date | null }>;
        expect(row.kitchenReadyAt).toEqual(readyAt);
    });
});
