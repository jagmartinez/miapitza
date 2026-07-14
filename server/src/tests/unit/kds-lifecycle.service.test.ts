import { afterEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../../utils/prisma';
import { OrderService } from '../../services/order.service';
import { buildKitchenNotificationDedupKey } from '../../services/kitchen-notification.service';

afterEach(function cleanup(): void {
    jest.restoreAllMocks();
});

describe('durable KDS lifecycle', () => {
    it('keeps released READY orders in the operational active query but excludes them from the KDS queue', async () => {
        const findMany = jest.spyOn(prisma.order, 'findMany').mockResolvedValue([]);

        await OrderService.getActiveOrders(1, 2);
        expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
            where: expect.not.objectContaining({ kitchenReleasedAt: null })
        }));

        await OrderService.getKitchenQueue(1, 2);
        expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
            where: expect.objectContaining({ kitchenReleasedAt: null })
        }));
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
                    kitchenReleasedAt: null
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
            data: { kitchenReleasedAt: expect.anything(), kitchenReleasedById: 9 }
        }));
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'KITCHEN_RELEASED', userId: 9 })
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

    it('clears release/start markers when a READY order receives a new item cycle', () => {
        const source = fs.readFileSync(path.resolve(process.cwd(), 'src/services/order.service.ts'), 'utf8');
        const reopenedMarkers = source.match(/status: 'SENT_TO_KITCHEN' as const,[\s\S]{0,260}kitchenReleasedAt: null,[\s\S]{0,260}kitchenStartedAt: null/g) ?? [];
        expect(reopenedMarkers).toHaveLength(2);
    });
});
