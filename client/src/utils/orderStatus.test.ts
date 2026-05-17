import { describe, expect, it } from 'vitest';
import type { MenuItem } from '../types';
import { ACTIVE_ORDER_STATUSES, getOrderStatusClassName, getOrderStatusLabel, getOrderTimeline } from './orderStatus';

const stubMenuItem: MenuItem = {
    id: 0,
    name: '',
    price: 0,
    categoryId: 0,
    category: { id: 0, name: '' },
    active: true,
};

describe('order status utils', () => {
    it('includes in-preparation and delivered in active statuses', () => {
        expect(ACTIVE_ORDER_STATUSES).toContain('IN_PREPARATION');
        expect(ACTIVE_ORDER_STATUSES).toContain('DELIVERED');
    });

    it('maps kitchen statuses to user-friendly labels and classes', () => {
        expect(getOrderStatusLabel('IN_PREPARATION')).toBe('En preparación');
        expect(getOrderStatusClassName('IN_PREPARATION')).toBe('status-preparing');
        expect(getOrderStatusLabel('READY')).toBe('Lista');
    });

    it('builds the operational timeline from order item timestamps', () => {
        const timeline = getOrderTimeline({
            status: 'OPEN',
            createdAt: '2026-04-02T16:00:00.000Z',
            items: [
                {
                    id: 1,
                    orderId: 10,
                    menuItemId: 1,
                    menuItem: stubMenuItem,
                    quantity: 1,
                    price: 100,
                    subtotal: 100,
                    status: 'DONE',
                    startedAt: '2026-04-02T16:05:00.000Z',
                    finishedAt: '2026-04-02T16:12:00.000Z',
                },
                {
                    id: 2,
                    orderId: 10,
                    menuItemId: 2,
                    menuItem: stubMenuItem,
                    quantity: 1,
                    price: 120,
                    subtotal: 120,
                    status: 'DONE',
                    startedAt: '2026-04-02T16:07:00.000Z',
                    finishedAt: '2026-04-02T16:18:00.000Z',
                },
            ],
        });

        expect(timeline.requestedAt).toBe('2026-04-02T16:00:00.000Z');
        expect(timeline.firstStartedAt).toBe('2026-04-02T16:05:00.000Z');
        expect(timeline.readyAt).toBe('2026-04-02T16:18:00.000Z');
    });

    it('leaves readyAt empty until all items are finished', () => {
        const timeline = getOrderTimeline({
            status: 'OPEN',
            createdAt: '2026-04-02T16:00:00.000Z',
            items: [
                {
                    id: 1,
                    orderId: 10,
                    menuItemId: 1,
                    menuItem: stubMenuItem,
                    quantity: 1,
                    price: 100,
                    subtotal: 100,
                    status: 'DONE',
                    startedAt: '2026-04-02T16:05:00.000Z',
                    finishedAt: '2026-04-02T16:12:00.000Z',
                },
                {
                    id: 2,
                    orderId: 10,
                    menuItemId: 2,
                    menuItem: stubMenuItem,
                    quantity: 1,
                    price: 120,
                    subtotal: 120,
                    status: 'IN_PROGRESS',
                    startedAt: '2026-04-02T16:07:00.000Z',
                },
            ],
        });

        expect(timeline.firstStartedAt).toBe('2026-04-02T16:05:00.000Z');
        expect(timeline.readyAt).toBeNull();
    });
});
