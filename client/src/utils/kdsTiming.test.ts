import { describe, expect, it } from 'vitest';
import { getKdsTimeClass, getKdsWaitMinutes, getKitchenReceivedAt, summarizeKds } from './kdsTiming';

describe('KDS persistent timing', () => {
    const order = {
        createdAt: '2026-07-14T12:00:00.000Z',
        items: [
            { sentAt: '2026-07-14T12:07:00.000Z' },
            { sentAt: '2026-07-14T12:09:00.000Z' }
        ]
    };

    it('starts the SLA at the first persisted kitchen reception timestamp', () => {
        expect(getKitchenReceivedAt(order)).toBe('2026-07-14T12:07:00.000Z');
        expect(getKdsWaitMinutes(order, new Date('2026-07-14T12:12:30.000Z').getTime())).toBe(5);
    });

    it('uses tenant thresholds at their exact boundaries', () => {
        const config = { warningMinutes: 3, urgentMinutes: 10 };
        expect(getKdsTimeClass(2, config)).toBe('time-normal');
        expect(getKdsTimeClass(3, config)).toBe('time-warning');
        expect(getKdsTimeClass(10, config)).toBe('time-urgent');
    });

    it('falls back to order creation only for legacy lines without sentAt', () => {
        expect(getKitchenReceivedAt({ createdAt: order.createdAt, items: [{}] })).toBe(order.createdAt);
    });
});

describe('KDS summary indicators', () => {
    const now = new Date('2026-07-14T13:00:00.000Z').getTime();
    const mk = (status: string, minutesAgo: number, released = false) => ({
        status,
        kitchenReleasedAt: released ? 'x' : null,
        createdAt: new Date(now - minutesAgo * 60_000).toISOString(),
        items: [] as Array<{ sentAt?: string }>,
    });

    it('averages only active orders and counts the ones past the urgent threshold', () => {
        const s = summarizeKds([mk('SENT_TO_KITCHEN', 12), mk('IN_PREPARATION', 4), mk('READY', 40)], { warningMinutes: 3, urgentMinutes: 10 }, now);
        expect(s.activeCount).toBe(2);
        expect(s.avgMinutes).toBe(8);
        expect(s.lateCount).toBe(1);
        expect(s.targetMinutes).toBe(3);
    });

    it('ignores old CANCELLED/DELIVERED orders that still carry kitchen timestamps', () => {
        const s = summarizeKds([mk('CANCELLED', 180), mk('DELIVERED', 240), mk('IN_PREPARATION', 4)], { warningMinutes: 3, urgentMinutes: 10 }, now);
        expect(s.activeCount).toBe(1);
        expect(s.avgMinutes).toBe(4);
        expect(s.lateCount).toBe(0);
    });

    it('reports N/D (null) instead of zero when there is nothing active or no thresholds', () => {
        expect(summarizeKds([mk('READY', 5)], { warningMinutes: 3, urgentMinutes: 10 }, now).avgMinutes).toBeNull();
        const s = summarizeKds([mk('IN_PREPARATION', 5)], null, now);
        expect(s.lateCount).toBeNull();
        expect(s.targetMinutes).toBeNull();
    });
});
