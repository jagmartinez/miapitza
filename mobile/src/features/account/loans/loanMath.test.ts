import { describe, expect, it } from 'vitest';
import { installmentPlan, toCents } from './loanMath';

describe('installmentPlan', () => {
    it('installmentPlan 1000/3 = 333.33,333.33,333.34', () => {
        expect(installmentPlan('1000', 3)).toEqual(['333.33', '333.33', '333.34']);
    });
    it('installmentPlan 100/1 = 100.00', () => {
        expect(installmentPlan('100', 1)).toEqual(['100.00']);
    });
    it('installmentPlan sums exactly for 0.05/2', () => {
        const plan = installmentPlan('0.05', 2);
        expect(plan).toEqual(['0.02', '0.03']);
        expect(plan.reduce((s, p) => s + toCents(p)!, 0)).toBe(5);
    });
    it('rejects invalid input', () => {
        expect(installmentPlan('abc', 3)).toEqual([]);
        expect(installmentPlan('100', 0)).toEqual([]);
    });
    it('parses grouped decimals without float drift', () => {
        expect(toCents('1,234.5')).toBe(123450);
        expect(toCents('19.99')).toBe(1999);
    });
});
