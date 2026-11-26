import { createCache } from './cache';
import { makeEnv } from './testkit';

describe('purgeExpired also sweeps abandoned payment plans (Opus M8)', () => {
    it('drops plans of orders nobody reopened in 24 h, keeps the recent ones', async () => {
        let now = 0;
        const { db } = makeEnv();
        const cache = createCache(db, () => now);
        const plan = (orderId: number, timestamp: number) => ({ id: `1:7|${orderId}`, ownerKey: '1:7', orderId, timestamp, mode: 'single' as const, payable: 10, plan: null, allIds: ['single'], changeOf: {}, methodOf: {}, legs: {}, confirmed: [] });
        await db.paymentPlans.bulkPut([plan(1, 0), plan(2, 24 * 3_600_000)]);
        now = 25 * 3_600_000;
        await cache.purgeExpired();
        expect((await db.paymentPlans.toArray()).map((p) => p.orderId)).toEqual([2]);
    });
});
