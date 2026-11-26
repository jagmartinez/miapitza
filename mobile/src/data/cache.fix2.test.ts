import { createCache, TTL } from './cache';
import { makeEnv } from './testkit';

describe('cache fix round 2', () => {
    it('M5: a fetch started before an invalidation does not store its pre-mutation data', async () => {
        const { db } = makeEnv();
        const cache = createCache(db);
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        let started!: () => void;
        const fetchStarted = new Promise<void>((r) => (started = r));
        const pending = cache.read({
            ownerKey: '1:1',
            url: '/orders/active',
            ttlMs: TTL.orders,
            fetch: async () => {
                started();
                await gate;
                return ['before mutation'];
            },
        });
        await fetchStarted;
        await cache.invalidate('1:1', ['/orders/active']); // a mutation landed meanwhile
        release();
        expect((await pending).data).toEqual(['before mutation']); // the caller still gets its answer
        expect(await db.caches.count()).toBe(0); // but it is not kept
    });

    it('purgeExpired also drops old temp id mappings', async () => {
        let now = 0;
        const { db } = makeEnv();
        const cache = createCache(db, () => now);
        await db.tempIds.bulkPut([
            { id: '1:1|order-old', ownerKey: '1:1', tempId: 'order-old', realId: 1, timestamp: 0 },
            { id: '1:1|order-new', ownerKey: '1:1', tempId: 'order-new', realId: 2, timestamp: 24 * 3_600_000 },
        ]);
        now = 25 * 3_600_000;
        await cache.purgeExpired();
        expect((await db.tempIds.toArray()).map((r) => r.tempId)).toEqual(['order-new']);
    });
});
