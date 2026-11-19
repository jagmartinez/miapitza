import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { WebSocketService } from './websocket.service';

type ReadyNotificationInput = {
    companyId: number;
    orderId: number;
    kitchenBatchId?: number;
    itemId?: number;
    complete: boolean;
};

type ReleasedNotificationInput = {
    companyId: number;
    orderId: number;
    kitchenBatchId?: number;
    released: true;
};

export function buildKitchenNotificationDedupKey(input: {
    orderId: number;
    eventType: 'ORDER_ITEM_READY' | 'ORDER_READY' | 'ORDER_RELEASED';
    eventTimestamp: Date;
    kitchenBatchId?: number;
    itemId?: number;
}): string {
    const cycleToken = input.eventTimestamp.toISOString();
    const batchToken = input.kitchenBatchId ? `:batch:${input.kitchenBatchId}` : '';
    if (input.eventType === 'ORDER_RELEASED') {
        return `order:${input.orderId}${batchToken}:released:${cycleToken}`;
    }
    if (input.eventType === 'ORDER_READY') {
        return `order:${input.orderId}${batchToken}:ready:${cycleToken}`;
    }
    return `order:${input.orderId}${batchToken}:item:${input.itemId}:ready:${cycleToken}`;
}

const RECONCILE_READY_LIMIT = 50;

export class KitchenNotificationService {
    private static async create(input: ReadyNotificationInput | ReleasedNotificationInput) {
        const released = 'released' in input;
        const itemBatchId = !released && input.itemId
            ? (await prisma.orderItem.findFirst({
                where: { id: input.itemId, orderId: input.orderId },
                select: { kitchenBatchId: true },
            }))?.kitchenBatchId
            : undefined;
        const resolvedBatchId = input.kitchenBatchId ?? itemBatchId ?? undefined;
        const batch = await prisma.kitchenBatch.findFirst({
            where: {
                ...(resolvedBatchId ? { id: resolvedBatchId } : {}),
                orderId: input.orderId,
                companyId: input.companyId,
                ...(released
                    ? { status: 'RELEASED' as const }
                    : input.complete
                        ? { status: 'READY' as const }
                        : {}),
            },
            include: {
                order: {
                    include: {
                        table: { select: { number: true } },
                        user: { select: { id: true, name: true } },
                    },
                },
                items: {
                    include: {
                        menuItem: { select: { name: true } },
                    },
                },
            },
            orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        });
        if (!batch) throw new Error('Tanda no encontrada al crear notificación KDS');
        const order = batch.order;

        const item = !released && input.itemId
            ? batch.items.find((candidate) => candidate.id === input.itemId)
            : undefined;
        const eventType = released
            ? 'ORDER_RELEASED' as const
            : input.complete
                ? 'ORDER_READY' as const
                : 'ORDER_ITEM_READY' as const;
        const eventTimestamp = released
            ? batch.releasedAt
            : item?.finishedAt ?? batch.readyAt;
        if (!eventTimestamp) throw new Error('El evento KDS no tiene un timestamp persistido');

        const dedupKey = buildKitchenNotificationDedupKey({
            orderId: order.id,
            eventType,
            eventTimestamp,
            kitchenBatchId: batch.id,
            itemId: !released ? input.itemId : undefined,
        });
        const readyProducts = item
            ? [{ id: item.id, name: item.menuItem.name, quantity: item.quantity }]
            : batch.items.map((candidate) => ({
                id: candidate.id,
                name: candidate.menuItem.name,
                quantity: candidate.quantity,
            }));
        const tableLabel = order.table?.number ? `Mesa ${order.table.number}` : 'Pedido sin mesa';
        const message = released
            ? `${tableLabel}: tanda ${batch.sequence} de la orden #${order.id} liberada por cocina`
            : input.complete
                ? `${tableLabel}: tanda ${batch.sequence} de la orden #${order.id} completa y lista`
                : `${tableLabel}: ${item?.menuItem.name ?? 'producto'} listo de la tanda ${batch.sequence}, orden #${order.id}`;

        let notification;
        try {
            notification = await prisma.kitchenNotification.create({
                data: {
                    companyId: order.companyId,
                    branchId: order.branchId,
                    orderId: order.id,
                    userId: order.userId,
                    eventType,
                    dedupKey,
                    tableNumber: order.table?.number,
                    message,
                    payload: {
                        complete: !released && input.complete,
                        released,
                        orderNumber: order.id,
                        kitchenBatchId: batch.id,
                        kitchenBatchSequence: batch.sequence,
                        waiterName: order.user.name,
                        readyProducts,
                    } satisfies Prisma.InputJsonValue,
                },
            });
        } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
                throw error;
            }
            return prisma.kitchenNotification.findFirst({
                where: { companyId: order.companyId, dedupKey },
            });
        }

        WebSocketService.broadcastKitchenNotification(notification, {
            companyId: order.companyId,
            branchId: order.branchId,
            userIds: [order.userId],
        });
        return notification;
    }

    static notifyReady(input: ReadyNotificationInput) {
        return this.create(input);
    }

    static notifyReleased(companyId: number, orderId: number, kitchenBatchId?: number) {
        return this.create({ companyId, orderId, kitchenBatchId, released: true });
    }

    /**
     * Repairs notifications if a process stopped after committing READY but
     * before publishing its side effect. The unique dedup key makes this safe.
     */
    static async reconcileReadyForUser(companyId: number, userId: number) {
        // Only live orders: delivered/cancelled orders may keep historical READY
        // batches (legacy migration, deliver without release) that must never
        // resurface as fresh notifications. Batches without readyAt cannot build
        // a dedup key, so they are skipped instead of failing the whole list.
        const batches = await prisma.kitchenBatch.findMany({
            where: {
                companyId,
                status: 'READY',
                readyAt: { not: null },
                order: { userId, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
            },
            select: { id: true, orderId: true },
            orderBy: [{ readyAt: 'desc' }, { id: 'desc' }],
            take: RECONCILE_READY_LIMIT,
        });
        const results = await Promise.allSettled(batches.map((batch) => this.notifyReady({
            companyId,
            orderId: batch.orderId,
            kitchenBatchId: batch.id,
            complete: true,
        })));
        for (const result of results) {
            if (result.status === 'rejected') {
                console.error('[KDS] No se pudo reconciliar notificación de tanda lista:', result.reason);
            }
        }
    }

    static async list(companyId: number, userId: number, options?: { includeAttended?: boolean; limit?: number }) {
        await this.reconcileReadyForUser(companyId, userId);
        const requestedLimit = options?.limit;
        const limit = Number.isInteger(requestedLimit) && requestedLimit! > 0
            ? Math.min(requestedLimit!, 100)
            : 30;
        return prisma.kitchenNotification.findMany({
            where: {
                companyId,
                userId,
                ...(options?.includeAttended ? {} : { status: { not: 'ATTENDED' as const } }),
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }

    static async markSeen(companyId: number, userId: number, id: number) {
        const changed = await prisma.kitchenNotification.updateMany({
            where: { id, companyId, userId, status: 'UNREAD' },
            data: { status: 'SEEN', seenAt: new Date() },
        });
        if (changed.count === 0) {
            const existing = await prisma.kitchenNotification.findFirst({
                where: { id, companyId, userId },
            });
            if (!existing) throw new Error('Notificación no encontrada');
        }
        return prisma.kitchenNotification.findUnique({ where: { id } });
    }

    static async markAttended(companyId: number, userId: number, id: number) {
        const now = new Date();
        const changed = await prisma.kitchenNotification.updateMany({
            where: { id, companyId, userId, status: { not: 'ATTENDED' } },
            data: { status: 'ATTENDED', seenAt: now, attendedAt: now },
        });
        if (changed.count === 0) {
            const existing = await prisma.kitchenNotification.findFirst({
                where: { id, companyId, userId },
            });
            if (!existing) throw new Error('Notificación no encontrada');
        }
        return prisma.kitchenNotification.findUnique({ where: { id } });
    }
}
