import { amountToPercent, clampDiscount, inferTaxRate, newTotal, percentToAmount, taxFromRate, toCents } from './discountMath';

describe('discountMath (server rounding rule)', () => {
    it('percent and amount compute the same new total as the server rule', () => {
        const subtotal = 250.5;
        const amount = percentToAmount(subtotal, 10); // floor(subtotal * 10) / 100
        expect(amount).toBe(25.05);
        // 15% tax over 225.45 = 33.8175 -> 33.82 (half-up in cents), not the float 33.81
        expect(newTotal({ subtotal, discount: amount, taxRate: 15, tip: 0 })).toBe(259.27);
        // typing the amount back gives the same percent and the same total
        expect(amountToPercent(amount, subtotal)).toBe(10);
        expect(newTotal({ subtotal, discount: clampDiscount(25.05, subtotal), taxRate: 15, tip: 0 })).toBe(259.27);
    });

    it('rounds like the server: cents half-up, tax half-up, percent up to 2 decimals', () => {
        expect(toCents(1.005)).toBe(101);
        expect(taxFromRate(1.5, 15)).toBe(0.23); // 0.225 -> 0.23 (float math gives 0.22)
        expect(amountToPercent(1, 3)).toBe(33.34); // never understates the percent
        expect(amountToPercent(0, 100)).toBe(0);
        expect(amountToPercent(10, 0)).toBe(0);
    });

    it('a percent converted to an amount never exceeds that percent', () => {
        for (const subtotal of [33.3, 99.99, 250.5, 1234.56, 7]) {
            for (const p of [5, 10, 15, 20, 33.33, 100]) {
                expect(amountToPercent(percentToAmount(subtotal, p), subtotal)).toBeLessThanOrEqual(p);
            }
        }
    });

    it('mirrors the server float floor on purpose (8.20 x 15 is one cent short there too)', () => {
        // server maxDiscountForLimit: Math.floor(8.2 * 15) / 100 = 1.22, so asking for 1.23 would need a supervisor.
        expect(percentToAmount(8.2, 15)).toBe(1.22);
    });

    it('clamps the discount to the subtotal and never below zero', () => {
        expect(clampDiscount(500, 250.5)).toBe(250.5);
        expect(clampDiscount(-3, 250.5)).toBe(0);
        expect(newTotal({ subtotal: 100, discount: 100, taxRate: 15, tip: 0 })).toBe(0);
        expect(newTotal({ subtotal: 100, discount: 500, taxRate: 15, tip: 0 })).toBe(100 - clampDiscount(500, 100) + 0);
    });

    it('infers the tax rate from the order and is 0 when it cannot', () => {
        expect(inferTaxRate({ subtotal: 200, discount: 0, tax: 30 })).toBe(15);
        expect(inferTaxRate({ subtotal: 200, discount: 50, tax: 22.5 })).toBe(15);
        expect(inferTaxRate({ subtotal: 0, discount: 0, tax: 0 })).toBe(0);
        expect(inferTaxRate({ subtotal: 100, discount: 100, tax: 0 })).toBe(0);
    });
});
