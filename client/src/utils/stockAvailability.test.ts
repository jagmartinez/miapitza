import { describe, expect, it } from 'vitest';
import { indexAvailability, stockBadgeFor } from './stockAvailability';

describe('stockBadgeFor', () => {
    it('labels out-of-stock and low-stock items, and nothing otherwise', () => {
        expect(stockBadgeFor({ status: 'OUT', portions: 0 })).toEqual({ tone: 'out', label: 'Agotado' });
        expect(stockBadgeFor({ status: 'LOW', portions: 3 })).toEqual({ tone: 'low', label: 'Quedan 3' });
        expect(stockBadgeFor({ status: 'AVAILABLE', portions: 40 })).toBeNull();
        expect(stockBadgeFor({ status: 'UNTRACKED', portions: null })).toBeNull();
        expect(stockBadgeFor({ status: 'UNKNOWN', portions: null })).toBeNull();
        expect(stockBadgeFor(undefined)).toBeNull();
    });

    it('indexes availability rows by menu item id', () => {
        const map = indexAvailability({
            branchId: 1, warehouseId: 5, reason: null, lowThreshold: 5,
            items: [{ menuItemId: 7, status: 'LOW', portions: 2, limitingProductId: 4 }]
        });
        expect(map.get(7)?.portions).toBe(2);
        expect(indexAvailability(null).size).toBe(0);
    });
});
