import { describe, expect, it } from '@jest/globals';
import { selectLatestKitchenBatch } from '../../services/kitchen-batch';

describe('sequential kitchen batch projection', () => {
    it('keeps only the latest sent wave and its products', () => {
        const items = [
            { id: 1, sentAt: new Date('2026-07-29T12:00:00.000Z'), status: 'DONE' },
            { id: 2, sentAt: new Date('2026-07-29T12:30:00.000Z'), status: 'PENDING' },
            { id: 3, sentAt: new Date('2026-07-29T12:30:00.000Z'), status: 'PENDING' },
        ];

        expect(selectLatestKitchenBatch(items).map((item) => item.id)).toEqual([2, 3]);
    });

    it('keeps an active sent wave visible instead of replacing it with unsent drafts', () => {
        const items = [
            { id: 1, sentAt: new Date('2026-07-29T12:00:00.000Z'), status: 'IN_PROGRESS' },
            { id: 2, sentAt: null, status: 'PENDING' },
        ];

        expect(selectLatestKitchenBatch(items).map((item) => item.id)).toEqual([1]);
    });

    it('fails visible for legacy records without persisted send timestamps', () => {
        const items = [{ id: 1, sentAt: null }, { id: 2, sentAt: null }];
        expect(selectLatestKitchenBatch(items)).toEqual(items);
    });
});
