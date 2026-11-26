import { describe, expect, it } from 'vitest';
import { purchaseOrderDateVisibility, purchaseOrderPayable, remainingQuantity } from './purchaseOrderReceipt';

describe('purchaseOrderReceipt helpers', () => {
    it('computes the remaining quantity without float noise and never below zero', () => {
        expect(remainingQuantity({ quantity: 10, receivedQuantity: 4 })).toBe(6);
        expect(remainingQuantity({ quantity: '0.3', receivedQuantity: '0.1' })).toBe(0.2);
        expect(remainingQuantity({ quantity: 5, receivedQuantity: 5 })).toBe(0);
        expect(remainingQuantity({ quantity: 5 })).toBe(5);
    });

    it('uses the received value as payable while the order is partially received', () => {
        expect(purchaseOrderPayable({ status: 'PARTIALLY_RECEIVED', total: 100, receivedTotal: 40 })).toBe(40);
        expect(purchaseOrderPayable({ status: 'RECEIVED', total: 100, receivedTotal: 100 })).toBe(100);
    });

    describe('purchaseOrderDateVisibility', () => {
        const range = { startDate: '2026-11-01', endDate: '2026-11-30' };
        const old = '2026-09-10T15:00:00';

        it('applies the range to ordinary orders', () => {
            expect(purchaseOrderDateVisibility({ status: 'RECEIVED', date: '2026-11-10T15:00:00' }, { ...range, statusFilter: 'all' }))
                .toEqual({ visible: true, outOfRange: false });
            expect(purchaseOrderDateVisibility({ status: 'ISSUED', date: old }, { ...range, statusFilter: 'all' }))
                .toEqual({ visible: false, outOfRange: false });
        });

        it('keeps partially received orders with a pending balance visible and flagged outside the range', () => {
            expect(purchaseOrderDateVisibility({ status: 'PARTIALLY_RECEIVED', date: old }, { ...range, statusFilter: 'all' }))
                .toEqual({ visible: true, outOfRange: true });
            expect(purchaseOrderDateVisibility({ status: 'PARTIALLY_RECEIVED', date: old }, { ...range, statusFilter: 'PARTIALLY_RECEIVED' }))
                .toEqual({ visible: true, outOfRange: true });
            expect(purchaseOrderDateVisibility({ status: 'PARTIALLY_RECEIVED', date: '2026-11-05T10:00:00' }, { ...range, statusFilter: 'all' }))
                .toEqual({ visible: true, outOfRange: false });
        });

        it('hides them when the user explicitly filters by another status', () => {
            expect(purchaseOrderDateVisibility({ status: 'PARTIALLY_RECEIVED', date: old }, { ...range, statusFilter: 'ISSUED' }).visible).toBe(false);
        });

        it('never hides orders without a range or with an unparseable date', () => {
            expect(purchaseOrderDateVisibility({ status: 'ISSUED', date: old }, { statusFilter: 'all' }).visible).toBe(true);
            expect(purchaseOrderDateVisibility({ status: 'ISSUED', date: undefined }, { ...range, statusFilter: 'all' }).visible).toBe(true);
        });
    });
});
