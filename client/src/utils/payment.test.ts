import { describe, expect, it } from 'vitest';
import {
    calculateTipAmount,
    calculateTotalWithTip,
    formatMoneyInput,
    parseMoneyInput,
    splitTotalEvenly,
} from './payment';

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

    it('uses integer cents for totals susceptible to floating-point drift', () => {
        expect(calculateTotalWithTip(0.1, 0.2)).toBe(0.3);
        expect(splitTotalEvenly(10.05, 2)).toEqual([5.02, 5.03]);
    });

    it('keeps editable money parsing separate from grouped presentation', () => {
        expect(parseMoneyInput('2,199.50')).toBe(2199.5);
        expect(parseMoneyInput('12.345')).toBeNull();
        expect(parseMoneyInput('')).toBeNull();
        expect(formatMoneyInput('2199.5')).toBe('2,199.50');
    });
});
