import { createCache, TTL } from './cache';
import { makeEnv } from './testkit';

describe('cache', () => {
    it('menu served from cache then refreshed', async () => {
        const { db } = makeEnv();
        const cache = createCache(db);
        let version = 1;
        const fetchMenu = vi.fn(async () => ({ v: version }));
        const base = { ownerKey: '1:1', url: '/menu-items', params: { branchId: 1, active: true }, ttlMs: TTL.menu, swr: true, fetch: fetchMenu };

        const first = await cache.read(base);
        expect(first).toMatchObject({ data: { v: 1 }, source: 'network' });

        version = 2;
        const onRefresh = vi.fn();
        const second = await cache.read({ ...base, onRefresh });
        expect(second.data).toEqual({ v: 1 }); // instant, from cache
        expect(second.source).toBe('cache');
        await second.refresh;
        expect(onRefresh).toHaveBeenCalledWith({ v: 2 });
        expect((await cache.read({ ...base, fetch: async () => ({ v: 3 }) })).data).toEqual({ v: 2 });
    });

    it('entries are scoped per owner and param order does not matter', async () => {
        const cache = createCache(makeEnv().db);
        const f = (v: number) => async () => v;
        await cache.read({ ownerKey: '1:1', url: '/orders/active', params: { a: 1, b: 2 }, ttlMs: TTL.orders, fetch: f(1) });
        const same = await cache.read({ ownerKey: '1:1', url: '/orders/active', params: { b: 2, a: 1 }, ttlMs: TTL.orders, fetch: f(2) });
        expect(same.data).toBe(1);
        const other = await cache.read({ ownerKey: '1:2', url: '/orders/active', params: { a: 1, b: 2 }, ttlMs: TTL.orders, fetch: f(3) });
        expect(other.data).toBe(3);
    });

    it('non-swr entries expire by TTL and fall back to stale when the network fails', async () => {
        let now = 1000;
        const cache = createCache(makeEnv().db, () => now);
        const o = { ownerKey: '1:1', url: '/orders/active', ttlMs: TTL.orders };
        await cache.read({ ...o, fetch: async () => 'a' });
        now += 59_000;
        expect((await cache.read({ ...o, fetch: async () => 'b' })).data).toBe('a');
        now += 2_000;
        expect((await cache.read({ ...o, fetch: async () => 'b' })).data).toBe('b');
        now += 61_000;
        const stale = await cache.read({
            ...o,
            fetch: async () => {
                throw new Error('offline');
            },
        });
        expect(stale).toMatchObject({ data: 'b', source: 'cache', stale: true });
    });

    it('a failed fetch with no cache rejects', async () => {
        const cache = createCache(makeEnv().db);
        await expect(
            cache.read({
                ownerKey: '1:1',
                url: '/x',
                ttlMs: 1,
                fetch: async () => {
                    throw new Error('offline');
                },
            }),
        ).rejects.toThrow('offline');
    });
});
