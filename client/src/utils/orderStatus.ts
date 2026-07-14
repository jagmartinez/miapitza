import type { Order } from '../types';

export const ACTIVE_ORDER_STATUSES: Order['status'][] = [
    'OPEN',
    'SENT_TO_KITCHEN',
    'IN_PREPARATION',
    'READY',
];

export const KITCHEN_ORDER_STATUSES: Order['status'][] = [
    'SENT_TO_KITCHEN',
    'IN_PREPARATION',
    'READY',
];

export const getOrderStatusLabel = (status: Order['status']): string => {
    switch (status) {
        case 'OPEN':
            return 'Abierta';
        case 'SENT_TO_KITCHEN':
            return 'En cola';
        case 'IN_PREPARATION':
            return 'En preparación';
        case 'READY':
            return 'Lista';
        case 'DELIVERED':
            return 'Entregada';
        case 'CANCELLED':
            return 'Cancelada';
        default:
            return status;
    }
};

export const getOrderStatusClassName = (status: Order['status']): string => {
    switch (status) {
        case 'OPEN':
            return 'status-open';
        case 'SENT_TO_KITCHEN':
            return 'status-kitchen';
        case 'IN_PREPARATION':
            return 'status-preparing';
        case 'READY':
            return 'status-ready';
        case 'DELIVERED':
            return 'status-delivered';
        case 'CANCELLED':
            return 'status-cancelled';
        default:
            return 'status-default';
    }
};

export const getOrderTimeline = (order: Pick<Order, 'createdAt' | 'items' | 'status'>) => {
    const items = order.items || [];
    const startedTimes = items
        .map((item) => item.startedAt)
        .filter((value): value is string => Boolean(value))
        .sort();
    const readyTimes = items
        .map((item) => item.finishedAt)
        .filter((value): value is string => Boolean(value))
        .sort();

    const allItemsFinished = items.length > 0 && readyTimes.length === items.length;
    // If the order has already advanced past kitchen (READY/DELIVERED) but some legacy
    // items lack finishedAt, fall back to the latest available finishedAt instead of "--:--".
    const orderConsideredReady = ['READY', 'DELIVERED'].includes(order.status);
    const readyAt = allItemsFinished
        ? readyTimes[readyTimes.length - 1]
        : (orderConsideredReady && readyTimes.length > 0 ? readyTimes[readyTimes.length - 1] : null);

    return {
        requestedAt: order.createdAt,
        firstStartedAt: startedTimes[0] || null,
        readyAt,
    };
};
