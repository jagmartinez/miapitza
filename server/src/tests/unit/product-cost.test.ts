import { effectiveUnitCost } from '../../utils/product-cost';

describe('effectiveUnitCost', () => {
    it('prefers a positive weighted-average cost', () => {
        expect(effectiveUnitCost(12.5, 9)).toBe(12.5);
    });

    it('uses the catalog reference when average cost is zero or absent', () => {
        expect(effectiveUnitCost(0, 9)).toBe(9);
        expect(effectiveUnitCost(null, 9)).toBe(9);
    });

    it('never returns an invalid or negative cost', () => {
        expect(effectiveUnitCost(Number.NaN, -2)).toBe(0);
        expect(effectiveUnitCost('not-a-number', undefined)).toBe(0);
    });
});
