import { MobileDB } from './cache';
import { createPaymentPlans } from './paymentPlans';

let n = 0;
const base = { orderId: 5, mode: 'split' as const, payable: 230, plan: { persons: [] }, allIds: ['a', 'b'], changeOf: {}, methodOf: {}, legs: { a: { key: 'k1', fingerprint: 'f', spec: { paymentMethodId: 1, amount: 115, payerName: 'Ana' } } }, confirmed: [] };

describe('paymentPlans', () => {
    it('keeps a plan per owner and order and clears it', async () => {
        const plans = createPaymentPlans(new MobileDB(`plans-${++n}`));
        await plans.save('1:7', base);
        expect((await plans.load('1:7', 5))?.legs.a.key).toBe('k1');
        expect(await plans.load('1:8', 5)).toBeNull(); // another cashier
        expect(await plans.load('1:7', 6)).toBeNull();
        await plans.clear('1:7', 5);
        expect(await plans.load('1:7', 5)).toBeNull();
    });

    it('drops a plan older than 24 hours', async () => {
        const db = new MobileDB(`plans-${++n}`);
        let t = 1_000_000;
        const plans = createPaymentPlans(db, () => t);
        await plans.save('1:7', base);
        t += 25 * 60 * 60_000;
        expect(await plans.load('1:7', 5)).toBeNull();
    });
});
