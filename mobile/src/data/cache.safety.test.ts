import { appEvents } from '../core/events';
import { createCache, TTL } from './cache';
import { StorageError } from './storage';
import { makeEnv } from './testkit';

describe('cache safety', () => {
    it('drops a response when the session changed during the fetch', async () => {
        const { db } = makeEnv();
        const cache = createCache(db);
        let current = true;
        const onRefresh = vi.fn();
        await expect(
            cache.read({
                ownerKey: '1:1',
                url: '/menu-items',
                ttlMs: TTL.menu,
                fetch: async () => {
                    current = false; // PIN switch while the request is in flight
                    return 'B data';
                },
                isCurrent: async () => current,
                onRefresh,
            }),
        ).rejects.toThrow();
        expect(await db.caches.count()).toBe(0);

        // a background refresh is dropped too: nothing stored, onRefresh not called
        await cache.read({ ownerKey: '1:1', url: '/m', ttlMs: 1, fetch: async () => 'old' });
        current = true;
        const r = await cache.read({
            ownerKey: '1:1',
            url: '/m',
            ttlMs: 1,
            swr: true,
            fetch: async () => {
                current = false;
                return 'B';
            },
            isCurrent: async () => current,
            onRefresh,
        });
        await r.refresh;
        expect(onRefresh).not.toHaveBeenCalled();
        expect((await db.caches.get('1:1|/m'))?.data).toBe('old');
    });

    it('invalidate removes only the owner rows under the given prefixes', async () => {
        const { db } = makeEnv();
        const cache = createCache(db);
        const f = async () => 1;
        await cache.read({ ownerKey: '1:1', url: '/orders/active', params: { branchId: 1 }, ttlMs: 9e9, fetch: f });
        await cache.read({ ownerKey: '1:1', url: '/tables/plan/1', ttlMs: 9e9, fetch: f });
        await cache.read({ ownerKey: '1:1', url: '/menu-items', ttlMs: 9e9, fetch: f });
        await cache.read({ ownerKey: '1:2', url: '/orders/active', params: { branchId: 1 }, ttlMs: 9e9, fetch: f });
        await cache.invalidate('1:1', ['/orders/active', '/tables/plan']);
        expect((await db.caches.toArray()).map((r) => r.id).sort()).toEqual(['1:1|/menu-items', '1:2|/orders/active?branchId=1']);
    });

    it('purgeExpired drops rows older than 24 h; clearOwner drops an owner', async () => {
        let now = 0;
        const { db } = makeEnv();
        const cache = createCache(db, () => now);
        const f = async () => 1;
        await cache.read({ ownerKey: '1:1', url: '/old', ttlMs: 1, fetch: f });
        now = 23 * 3_600_000;
        await cache.read({ ownerKey: '1:1', url: '/new', ttlMs: 1, fetch: f });
        await cache.read({ ownerKey: '1:2', url: '/other', ttlMs: 1, fetch: f });
        now = 25 * 3_600_000;
        await cache.purgeExpired();
        expect((await db.caches.toArray()).map((r) => r.url).sort()).toEqual(['/new', '/other']);
        await cache.clearOwner('1:2');
        expect((await db.caches.toArray()).map((r) => r.url)).toEqual(['/new']);
    });

    it('a storage failure is reported and the network data is still returned', async () => {
        const { db } = makeEnv();
        const cache = createCache(db);
        vi.spyOn(db.caches, 'get').mockRejectedValue(new Error('closed'));
        vi.spyOn(db.caches, 'put').mockRejectedValue(new Error('quota'));
        const fn = vi.fn();
        const off = appEvents.on('storage-error', fn);
        const r = await cache.read({ ownerKey: '1:1', url: '/x', ttlMs: 1, fetch: async () => 'ok' });
        off();
        expect(r.data).toBe('ok');
        expect(fn).toHaveBeenCalledWith(expect.objectContaining({ scope: 'cache', error: expect.any(StorageError) }));
    });
});
