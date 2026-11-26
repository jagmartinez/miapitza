import { effectiveLocationAccuracyLimit, MIN_LOCATION_ACCURACY_M } from '../../utils/hr-location';

describe('GPS accuracy floor', () => {
    it('never asks a phone for less than the floor, even with legacy stored values', () => {
        expect(MIN_LOCATION_ACCURACY_M).toBe(10);
        expect(effectiveLocationAccuracyLimit(50, 1)).toBe(10);
        expect(effectiveLocationAccuracyLimit(5, null)).toBe(10);
    });

    it('keeps the strictest configured limit above the floor', () => {
        expect(effectiveLocationAccuracyLimit(50, 30)).toBe(30);
        expect(effectiveLocationAccuracyLimit(25, 40)).toBe(25);
        expect(effectiveLocationAccuracyLimit(50, null)).toBe(50);
    });
});
