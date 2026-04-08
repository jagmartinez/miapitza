import type { Order } from '../types';

export const ACTIVE_ORDER_STATUSES: Order['status'][] = [
    'OPEN',
    'SENT_TO_KITCHEN',
    'IN_PREPARATION',
    'READY',
    'DELIVERED',
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
        case 'PAID':
            return 'Pagada';
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
        case 'PAID':
            return 'status-paid';
        case 'CANCELLED':
            return 'status-cancelled';
        default:
            return 'status-default';
    }
};

export const getOrderTimeline = (order: Pick<Order, 'createdAt' | 'items'>) => {
    const startedTimes = (order.items || [])
        .map((item) => item.startedAt)
        .filter((value): value is string => Boolean(value))
        .sort();
    const readyTimes = (order.items || [])
        .map((item) => item.finishedAt)
        .filter((value): value is string => Boolean(value))
        .sort();

    return {
        requestedAt: order.createdAt,
        firstStartedAt: startedTimes[0] || null,
        readyAt: readyTimes.length === (order.items || []).length ? readyTimes[readyTimes.length - 1] : null,
    };
};
