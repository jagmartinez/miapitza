import { describe, expect, it } from 'vitest';
import {
    calculateTipAmount,
    calculateTotalWithTip,
    canUsePaymentMethodInMixed,
    formatMoneyInput,
    formatMoneyAmount,
    hasUniqueNormalizedPayerNames,
    normalizePayerName,
    parseMoneyInput,
    splitTotalEvenly,
    summarizePaymentAllocation,
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

    it('formats monetary display with grouping and the configured symbol', () => {
        expect(formatMoneyAmount(2199, 'C$', 'en-US')).toBe('C$2,199.00');
        expect(formatMoneyAmount(1234567.8, '$', 'en-US')).toBe('$1,234,567.80');
    });

    it('validates mixed allocations in integer cents', () => {
        expect(summarizePaymentAllocation(100, [25, 25, 50])).toEqual({
            targetCents: 10000,
            allocatedCents: 10000,
            differenceCents: 0,
            exact: true,
        });
        expect(summarizePaymentAllocation(10.05, [5.02, 5.02])).toMatchObject({
            differenceCents: 1,
            exact: false,
        });
    });

    it('includes active cash in mixed payment only when the cash shift is usable', () => {
        expect(canUsePaymentMethodInMixed('CASH', true)).toBe(true);
        expect(canUsePaymentMethodInMixed('CASH', false)).toBe(false);
        expect(canUsePaymentMethodInMixed('CARD', false)).toBe(true);
        expect(canUsePaymentMethodInMixed('BANK_TRANSFER', false)).toBe(true);
        expect(canUsePaymentMethodInMixed('OTHER', true)).toBe(false);
    });

    it('normalizes payer names and rejects case-insensitive collisions', () => {
        expect(normalizePayerName('  Ana  ')).toBe('Ana');
        expect(hasUniqueNormalizedPayerNames([' Ana ', 'Beto'])).toBe(true);
        expect(hasUniqueNormalizedPayerNames([' Ana ', 'ana'])).toBe(false);
        expect(hasUniqueNormalizedPayerNames(['Ana', '   '])).toBe(false);
    });
});
