/**
 * Manual-discount arithmetic, a line-by-line mirror of the server so the preview equals what is stored.
 * The server is always the authority: the order it returns replaces whatever this computes.
 *
 * Server rules mirrored here (server/src/):
 * - services/order.service.ts:152  toCents       non-negative money -> integer cents, half-up
 * - services/order.service.ts:158  calculateFinalTotal  (subtotal - discount) + tax + tip, in cents
 * - services/order.service.ts:168  taxFromRate   discounted subtotal x rate%, in cents, half-up
 * - services/order.service.ts:3202 nextDiscount  min(max(0, d), subtotal) rounded to cents
 * - services/discount-authorization.service.ts:48  discountPercentOf   discount / subtotal in %, rounded UP to 2 decimals
 * - services/discount-authorization.service.ts:54  maxDiscountForLimit floor(subtotal x percent) / 100
 */

export const QUICK_PERCENTS = [5, 10, 15, 20] as const;
export const REASONS = ['Cortesía', 'Cliente frecuente', 'Error de cocina', 'Demora', 'Otro'] as const;
export type Reason = (typeof REASONS)[number];

/** order.service.ts:152 */
export function toCents(value: number): number {
    const safe = Math.max(0, Number(value) || 0);
    return Math.round(Number((safe * 100).toFixed(6)));
}

/** order.service.ts:3202 */
export function clampDiscount(discount: number, subtotal: number): number {
    return Math.round(Math.min(Math.max(0, Number(discount) || 0), Math.max(0, Number(subtotal) || 0)) * 100) / 100;
}

/** discount-authorization.service.ts:54: the largest amount a percent allows (so "10 %" always fits a 10 % limit). */
export function percentToAmount(subtotal: number, percent: number): number {
    const safeSubtotal = Math.max(0, Number(subtotal) || 0);
    return clampDiscount(Math.floor(safeSubtotal * Math.max(0, Number(percent) || 0)) / 100, safeSubtotal);
}

/** discount-authorization.service.ts:48 */
export function amountToPercent(discount: number, subtotal: number): number {
    if (!(subtotal > 0) || !(discount > 0)) return 0;
    return Math.ceil((discount / subtotal) * 10000 - 1e-9) / 100;
}

/** order.service.ts:168 (a rate outside 0..100 is treated as 0 here instead of throwing). */
export function taxFromRate(discountedSubtotal: number, ratePercent: number): number {
    const rate = Number(ratePercent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return 0;
    const baseCents = toCents(discountedSubtotal);
    const scaledRate = Math.round(Number((rate * 10_000).toFixed(6)));
    const denominator = 100 * 10_000;
    return Math.floor((baseCents * scaledRate + denominator / 2) / denominator) / 100;
}

/** order.service.ts:158 with tax repriced over the discounted subtotal. */
export function newTotal(input: { subtotal: number; discount: number; taxRate: number; tip: number }): number {
    const discount = clampDiscount(input.discount, input.subtotal);
    const discountedCents = Math.max(0, toCents(input.subtotal) - toCents(discount));
    const tax = taxFromRate(discountedCents / 100, input.taxRate);
    return (discountedCents + toCents(tax) + toCents(input.tip)) / 100;
}

/**
 * The company rate is not sent to the tablet; it is read back from the order itself (tax over the discounted
 * subtotal, up to 4 decimals like the server keeps). 0 when the order has no taxable base.
 */
export function inferTaxRate(order: { subtotal: number; discount: number; tax: number }): number {
    const base = Math.max(0, order.subtotal - Math.max(0, order.discount));
    if (!(base > 0) || !(order.tax > 0)) return 0;
    const raw = (order.tax / base) * 100;
    // The shortest rate that reproduces the stored tax (15, not 15.0011) keeps the preview exact for a new base.
    for (let decimals = 0; decimals <= 4; decimals++) {
        const rate = Number(raw.toFixed(decimals));
        if (taxFromRate(base, rate) === Math.round(order.tax * 100) / 100) return rate;
    }
    return Number(raw.toFixed(4));
}
