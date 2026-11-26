import { describe, expect, it } from 'vitest';
import { kardexHref, kardexUrlFilters } from './kardexLink';

describe('kardexHref', () => {
    it('opens the product in the warehouse from the approval date', () => {
        const href = kardexHref({ productId: 12, warehouseId: 3, from: new Date(2026, 10, 24, 18, 30) });
        expect(href).toBe('/kardex?productId=12&warehouseId=3&dateFrom=2026-11-24');
    });

    it('omits the date when there is none', () => {
        expect(kardexHref({ productId: 12, warehouseId: 3, from: null })).toBe('/kardex?productId=12&warehouseId=3');
    });
});

describe('kardexUrlFilters', () => {
    it('reads product, warehouse and start date', () => {
        expect(kardexUrlFilters('?productId=12&warehouseId=3&dateFrom=2026-11-24')).toEqual({ productId: 12, warehouseId: 3, dateFrom: '2026-11-24' });
    });

    it('ignores malformed values', () => {
        expect(kardexUrlFilters('?productId=abc&warehouseId=-1&dateFrom=24/11/2026')).toEqual({ productId: null, warehouseId: null, dateFrom: null });
        expect(kardexUrlFilters('')).toEqual({ productId: null, warehouseId: null, dateFrom: null });
    });
});
