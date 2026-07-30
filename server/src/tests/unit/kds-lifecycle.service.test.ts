import { afterEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../../utils/prisma';
import { OrderService } from '../../services/order.service';
import { buildKitchenNotificationDedupKey } from '../../services/kitchen-notification.service';

afterEach(function cleanup(): void {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('durable KDS lifecycle', () => {
    it('keeps unsettled and delivered accounts recoverable while excluding released orders from KDS', async () => {
        const findMany = jest.spyOn(prisma.order, 'findMany').mockResolvedValue([]);

        await OrderService.getActiveOrders(1, 2);
        expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                status: {
                    in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED'],
                },
                financialStatus: { not: 'PAID' },
            })
        }));

        await OrderService.getKitchenQueue(1, 2);
        expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
            where: expect.objectContaining({ kitchenReleasedAt: null })
        }));
    });

    it('projects only the latest sent wave and isolates its kitchen timeline', async () => {
        const firstSentAt = new Date('2026-07-29T12:00:00.000Z');
        const secondSentAt = new Date('2026-07-29T12:30:00.000Z');
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([{
            id: 41,
            companyId: 1,
            branchId: 2,
            status: 'SENT_TO_KITCHEN',
            createdAt: new Date('2026-07-29T11:45:00.000Z'),
            kitchenReleasedAt: null,
            items: [
                {
                    id: 1,
                    sentAt: firstSentAt,
                    startedAt: new Date('2026-07-29T12:02:00.000Z'),
                    finishedAt: new Date('2026-07-29T12:10:00.000Z'),
                    status: 'DONE',
                },
                {
                    id: 2,
                    sentAt: secondSentAt,
                    startedAt: null,
                    finishedAt: null,
                    status: 'PENDING',
                },
            ],
        }] as never);

        const [batch] = await OrderService.getKitchenQueue(1, 2);

        expect(batch.items.map((item) => item.id)).toEqual([2]);
        expect(batch.firstStartedAt).toBeNull();
        expect(batch.readyAt).toBeNull();
    });

    it('starts a new kitchen wave automatically after the previous wave is done', async () => {
        const previousSentAt = new Date('2026-07-29T12:00:00.000Z');
        const nextSentAt = new Date('2026-07-29T12:30:00.000Z');
        jest.useFakeTimers().setSystemTime(nextSentAt);
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 41,
                    branchId: 2,
                    status: 'READY',
                    kitchenReleasedAt: null,
                    items: [
                        { id: 1, sentAt: previousSentAt, status: 'DONE' },
                        { id: 2, sentAt: null, status: 'PENDING' },
                    ],
                })),
                findUnique: jest.fn(async () => ({
                    id: 41,
                    branchId: 2,
                    status: 'READY',
                    kitchenReleasedAt: null,
                    items: [
                        { id: 1, sentAt: previousSentAt, status: 'DONE' },
                        { id: 2, sentAt: nextSentAt, status: 'PENDING' },
                    ],
                })),
                update: jest.fn(async (_args: unknown) => ({
                    id: 41,
                    branchId: 2,
                    status: 'SENT_TO_KITCHEN',
                    kitchenReleasedAt: null,
                    items: [
                        { id: 1, sentAt: previousSentAt, status: 'DONE' },
                        { id: 2, sentAt: nextSentAt, status: 'PENDING' },
                    ],
                })),
            },
            orderItem: { updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })) },
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        const result = await OrderService.sendToKitchen(41, 1);

        expect(tx.orderItem.updateMany).toHaveBeenCalledWith({
            where: { orderId: 41, sentAt: null },
            data: { sentAt: nextSentAt },
        });
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: 'SENT_TO_KITCHEN',
                kitchenReleasedAt: null,
                kitchenStartedAt: null,
            }),
        }));
        expect((result.items as Array<{ id: number }>).map((item) => item.id)).toEqual([2]);
        expect(result.kitchenBatchSent).toBe(true);
    });

    it('keeps new products saved as drafts while the previous kitchen wave is active', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 41,
                    branchId: 2,
                    status: 'IN_PREPARATION',
                    kitchenReleasedAt: null,
                    items: [
                        { id: 1, sentAt: new Date('2026-07-29T12:00:00.000Z'), status: 'IN_PROGRESS' },
                        { id: 2, sentAt: null, status: 'PENDING' },
                    ],
                })),
            },
            orderItem: { updateMany: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        await expect(OrderService.sendToKitchen(41, 1))
            .rejects.toThrow(/productos se agregaron.*tanda activa.*terminar/i);
        expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('keeps the active previous wave visible while newer products remain unsent drafts', async () => {
        const firstSentAt = new Date('2026-07-29T12:00:00.000Z');
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([{
            id: 41,
            companyId: 1,
            branchId: 2,
            status: 'IN_PREPARATION',
            createdAt: new Date('2026-07-29T11:45:00.000Z'),
            kitchenReleasedAt: null,
            items: [
                {
                    id: 1,
                    sentAt: firstSentAt,
                    startedAt: new Date('2026-07-29T12:02:00.000Z'),
                    finishedAt: null,
                    status: 'IN_PROGRESS',
                },
                {
                    id: 2,
                    sentAt: null,
                    startedAt: null,
                    finishedAt: null,
                    status: 'PENDING',
                },
            ],
        }] as never);

        const [batch] = await OrderService.getKitchenQueue(1, 2);

        expect(batch.items.map((item) => item.id)).toEqual([1]);
        expect(batch.firstStartedAt).toBe('2026-07-29T12:02:00.000Z');
    });

    it('treats a repeated send of the current wave as an idempotent no-op', async () => {
        const sentAt = new Date('2026-07-29T12:30:00.000Z');
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 41,
                    branchId: 2,
                    status: 'SENT_TO_KITCHEN',
                    items: [{ id: 2, sentAt, status: 'PENDING' }],
                })),
            },
            orderItem: { updateMany: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        const result = await OrderService.sendToKitchen(41, 1);

        expect((result.items as Array<{ id: number }>).map((item) => item.id)).toEqual([2]);
        expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('deduplicates retries in one READY cycle but permits a later reopened cycle', () => {
        const first = buildKitchenNotificationDedupKey({
            orderId: 41,
            eventType: 'ORDER_READY',
            eventTimestamp: new Date('2026-07-14T12:00:00.000Z')
        });
        const retry = buildKitchenNotificationDedupKey({
            orderId: 41,
            eventType: 'ORDER_READY',
            eventTimestamp: new Date('2026-07-14T12:00:00.000Z')
        });
        const reopenedCycle = buildKitchenNotificationDedupKey({
            orderId: 41,
            eventType: 'ORDER_READY',
            eventTimestamp: new Date('2026-07-14T12:20:00.000Z')
        });

        expect(retry).toBe(first);
        expect(reopenedCycle).not.toBe(first);
    });

    it('starts every pending sent line and stamps the actor atomically on first touch', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 41,
                    branchId: 2,
                    status: 'SENT_TO_KITCHEN',
                    kitchenReleasedAt: null,
                    kitchenStartedAt: null,
                    items: [{ id: 5, sentAt: new Date(), status: 'PENDING' }]
                })),
                update: jest.fn(async (_args: unknown) => ({}))
            },
            orderItem: { updateMany: jest.fn(async (_args: unknown) => ({ count: 1 })) },
            auditLog: { create: jest.fn(async (_args: unknown) => ({})) }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);
        jest.spyOn(OrderService, 'getById').mockResolvedValue({
            id: 41,
            branchId: 2,
            status: 'IN_PREPARATION',
            salesChannel: 'RESTAURANT',
            table: { number: '7' }
        } as never);

        const startKitchenPreparation = OrderService.startKitchenPreparation.bind(OrderService) as (
            orderId: number, companyId: number, actorUserId: number
        ) => Promise<{ changed: boolean }>;
        const result = await startKitchenPreparation(41, 1, 9);

        expect(tx.orderItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { orderId: 41, sentAt: { not: null }, status: 'PENDING' },
            data: { status: 'IN_PROGRESS', startedAt: expect.anything() }
        }));
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: 'IN_PREPARATION',
                kitchenStartedAt: expect.anything(),
                kitchenStartedById: 9
            })
        }));
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'KITCHEN_PREPARATION_STARTED', userId: 9 })
        }));
        expect(result.changed).toBe(true);
    });

    it('requires READY and persists an explicit release instead of deleting the order', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 41,
                    branchId: 2,
                    status: 'READY',
                    kitchenReleasedAt: null,
                    items: []
                })),
                update: jest.fn(async (_args: unknown) => ({}))
            },
            auditLog: { create: jest.fn(async (_args: unknown) => ({})) }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);
        jest.spyOn(OrderService, 'getById').mockResolvedValue({ id: 41, status: 'READY' } as never);

        const releaseFromKitchen = OrderService.releaseFromKitchen.bind(OrderService) as (
            orderId: number, companyId: number, actorUserId: number
        ) => Promise<{ changed: boolean }>;
        const result = await releaseFromKitchen(41, 1, 9);

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 41 },
            data: expect.objectContaining({
                kitchenReleasedAt: expect.anything(),
                kitchenReleasedById: 9
            })
        }));
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'KITCHEN_RELEASED', userId: 9 })
        }));
        expect(result.changed).toBe(true);
    });

    it('reopens the commercial order only after releasing a completed wave with a next draft', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 41,
                    branchId: 2,
                    status: 'READY',
                    kitchenReleasedAt: null,
                    items: [
                        { sentAt: new Date('2026-07-29T12:00:00.000Z') },
                        { sentAt: null },
                    ]
                })),
                update: jest.fn(async (_args: unknown) => ({}))
            },
            auditLog: { create: jest.fn(async (_args: unknown) => ({})) }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);
        jest.spyOn(OrderService, 'getById').mockResolvedValue({ id: 41, status: 'OPEN' } as never);

        const result = await OrderService.releaseFromKitchen(41, 1, 9);

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: 'OPEN',
                kitchenReleasedAt: expect.anything(),
                kitchenReleasedById: 9
            })
        }));
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                action: 'KITCHEN_RELEASED',
                details: expect.objectContaining({ nextDraftPending: true })
            })
        }));
        expect(result.changed).toBe(true);
    });

    it('rejects releasing an order that has not been marked ready', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            order: {
                findFirst: jest.fn(async () => ({
                    id: 41,
                    branchId: 2,
                    status: 'IN_PREPARATION',
                    kitchenReleasedAt: null
                }))
            }
        };
        jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (callback: (db: typeof tx) => unknown) => callback(tx)) as never);

        await expect(OrderService.releaseFromKitchen(41, 1, 9)).rejects.toThrow(/debe estar lista/i);
    });
});

describe('KDS migration contract', () => {
    it('adds release history, notification deduplication and configurable tenant thresholds', () => {
        const sql = fs.readFileSync(path.resolve(
            process.cwd(),
            'prisma/migrations/20260714_add_kds_release_notifications/migration.sql'
        ), 'utf8');

        expect(sql).toContain('`kitchenReleasedAt`');
        expect(sql).toContain('CREATE TABLE `KitchenNotification`');
        expect(sql).toContain('KitchenNotification_companyId_dedupKey_key');
        expect(sql).toContain('_kds_warning_minutes');
        expect(sql).toContain('_kds_urgent_minutes');
    });

    it('reopens only released READY waves and clears prior wave markers on the next send', () => {
        const source = fs.readFileSync(path.resolve(process.cwd(), 'src/services/order.service.ts'), 'utf8');
        expect(source.match(/status: 'OPEN' as const/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(source).toContain('...(hasPreviousBatch ? {');
        expect(source).toContain('kitchenReleasedAt: null');
        expect(source).toContain('kitchenStartedAt: null');
    });
});
