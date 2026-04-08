import { describe, expect, it } from 'vitest';
import { calculateTipAmount, calculateTotalWithTip, splitTotalEvenly } from './payment';

describe('payment utils', () => {
    it('prefers custom tip when provided', () => {
        expect(calculateTipAmount(100, 10, '12.5')).toBe(12.5);
    });

    it('calculates percentage-based tip when custom tip is absent', () => {
        expect(calculateTipAmount(80, 15)).toBe(12);
    });

    it('adds tip to order total', () => {
        expect(calculateTotalWithTip(50, 7.5)).toBe(57.5);
    });

    it('splits totals evenly and preserves cents on the last payment', () => {
        expect(splitTotalEvenly(100, 3)).toEqual([33.33, 33.33, 33.34]);
    });
});
