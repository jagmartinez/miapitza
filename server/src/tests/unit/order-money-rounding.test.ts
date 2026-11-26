import { describe, expect, it } from '@jest/globals';
import { OrderService } from '../../services/order.service';

type Money = {
    taxFromRate: (base: number, ratePercent: number) => number;
    calculateFinalTotal: (subtotal: number, discount: number, tax: number, tip: number) => number;
};
const money = OrderService as unknown as Money;

describe('OrderService integer-cent tax and totals', () => {
    it.each([
        [1.5, 15, 0.23],     // 0.225 -> 0.23 (float math gave 0.22)
        [0.1, 15, 0.02],     // 0.015 -> 0.02
        [32.5, 15, 4.88],    // 4.875 -> 4.88
        [29.25, 15, 4.39],   // 4.3875 -> 4.39
        [10, 0, 0],
        [100, 7.5, 7.5],
        [3.33, 12.345, 0.41] // 0.41108… -> 0.41 (rates keep up to 4 decimals)
    ])('tax of %p at %p%% = %p', (base, rate, expected) => {
        expect(money.taxFromRate(base, rate)).toBe(expected);
    });

    it('rejects an invalid rate', () => {
        expect(() => money.taxFromRate(10, -1)).toThrow(/tasa de impuesto/);
        expect(() => money.taxFromRate(10, 101)).toThrow(/tasa de impuesto/);
    });

    it('sums totals in cents without float drift and clamps the discount at the subtotal', () => {
        expect(money.calculateFinalTotal(0.1, 0, 0.2, 0)).toBe(0.3);
        expect(money.calculateFinalTotal(1.5, 0, 0.23, 0)).toBe(1.73);
        expect(money.calculateFinalTotal(10, 15, 0, 1)).toBe(1);
    });
});
