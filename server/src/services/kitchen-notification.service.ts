import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { WebSocketService } from './websocket.service';

type ReadyNotificationInput = {
    companyId: number;
    orderId: number;
    itemId?: number;
    complete: boolean;
};

export function buildKitchenNotificationDedupKey(input: {
    orderId: number;
    eventType: 'ORDER_ITEM_READY' | 'ORDER_READY' | 'ORDER_RELEASED';
    eventTimestamp: Date;
    itemId?: number;
}): string {
    const cycleToken = input.eventTimestamp.toISOString();
    if (input.eventType === 'ORDER_RELEASED') return `order:${input.orderId}:released:${cycleToken}`;
    if (input.eventType === 'ORDER_READY') return `order:${input.orderId}:ready:${cycleToken}`;
    return `order:${input.orderId}:item:${input.itemId}:ready:${cycleToken}`;
}

export class KitchenNotificationService {
    private static async create(input: ReadyNotificationInput | (Omit<ReadyNotificationInput, 'itemId' | 'complete'> & { released: true })) {
        const order = await prisma.order.findFirst({
            where: { id: input.orderId, companyId: input.companyId },
            include: {
                table: { select: { number: true } },
                user: { select: { id: true, name: true } },
                items: { include: { menuItem: { select: { name: true } } } }
            }
        });
        if (!order) throw new Error('Orden no encontrada al crear notificación KDS');

        const released = 'released' in input;
        const item = !released && input.itemId
            ? order.items.find((candidate) => candidate.id === input.itemId)
            : undefined;
        const eventType = released
            ? 'ORDER_RELEASED' as const
            : input.complete
                ? 'ORDER_READY' as const
                : 'ORDER_ITEM_READY' as const;
        const readyAt = order.items.reduce<Date | null>((latest, candidate) => {
            if (!candidate.finishedAt) return latest;
            return !latest || candidate.finishedAt > latest ? candidate.finishedAt : latest;
        }, null);
        const eventTimestamp = released
            ? order.kitchenReleasedAt
            : item?.finishedAt ?? readyAt;
        if (!eventTimestamp) throw new Error('El evento KDS no tiene un timestamp persistido');
        const dedupKey = buildKitchenNotificationDedupKey({
            orderId: order.id,
            eventType,
            eventTimestamp,
            itemId: !released ? input.itemId : undefined
        });
        const readyProducts = item
            ? [{ id: item.id, name: item.menuItem.name, quantity: item.quantity }]
            : order.items.map((candidate) => ({
                id: candidate.id,
                name: candidate.menuItem.name,
                quantity: candidate.quantity
            }));
        const tableLabel = order.table?.number ? `Mesa ${order.table.number}` : 'Pedido sin mesa';
        const message = released
            ? `${tableLabel}: orden #${order.id} liberada por cocina`
            : !released && input.complete
                ? `${tableLabel}: orden #${order.id} completa y lista`
                : `${tableLabel}: ${item?.menuItem.name ?? 'producto'} listo de la orden #${order.id}`;

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
                        waiterName: order.user.name,
                        readyProducts
                    } satisfies Prisma.InputJsonValue
                }
            });
        } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
            return prisma.kitchenNotification.findFirst({
                where: { companyId: order.companyId, dedupKey }
            });
        }

        WebSocketService.broadcastKitchenNotification(notification, {
            companyId: order.companyId,
            branchId: order.branchId,
            userIds: [order.userId]
        });
        return notification;
    }

    static notifyReady(input: ReadyNotificationInput) {
        return this.create(input);
    }

    static notifyReleased(companyId: number, orderId: number) {
        return this.create({ companyId, orderId, released: true });
    }

    /**
     * Repairs notifications if a process stopped after committing READY but
     * before publishing its side effect. The unique dedup key makes this safe.
     */
    static async reconcileReadyForUser(companyId: number, userId: number) {
        const orders = await prisma.order.findMany({
            where: { companyId, userId, status: 'READY' },
            select: { id: true }
        });
        await Promise.all(orders.map((order) => this.notifyReady({
            companyId,
            orderId: order.id,
            complete: true
        })));
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
                ...(options?.includeAttended ? {} : { status: { not: 'ATTENDED' as const } })
            },
            orderBy: { createdAt: 'desc' },
            take: limit
        });
    }

    static async markSeen(companyId: number, userId: number, id: number) {
        const changed = await prisma.kitchenNotification.updateMany({
            where: { id, companyId, userId, status: 'UNREAD' },
            data: { status: 'SEEN', seenAt: new Date() }
        });
        if (changed.count === 0) {
            const existing = await prisma.kitchenNotification.findFirst({ where: { id, companyId, userId } });
            if (!existing) throw new Error('Notificación no encontrada');
        }
        return prisma.kitchenNotification.findUnique({ where: { id } });
    }

    static async markAttended(companyId: number, userId: number, id: number) {
        const now = new Date();
        const changed = await prisma.kitchenNotification.updateMany({
            where: { id, companyId, userId, status: { not: 'ATTENDED' } },
            data: { status: 'ATTENDED', seenAt: now, attendedAt: now }
        });
        if (changed.count === 0) {
            const existing = await prisma.kitchenNotification.findFirst({ where: { id, companyId, userId } });
            if (!existing) throw new Error('Notificación no encontrada');
        }
        return prisma.kitchenNotification.findUnique({ where: { id } });
    }
}
