import { describe, expect, it } from 'vitest';
import { getKdsTimeClass, getKdsWaitMinutes, getKitchenReceivedAt } from './kdsTiming';

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
