import { createCache } from './cache';
import { createOfflineQueue } from './offlineQueue';
import { createWaiterApi } from './waiterApi';
import { isTempOrderId } from './types';
import { makeEnv, sessionFor } from './testkit';

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline });
    const api = createWaiterApi({ http: env.http, sessions: env.sessions, cache: createCache(env.db), queue, isOnline: env.isOnline });
    return { ...env, queue, api };
}

describe('waiterApi order id format (fix round 3)', () => {
    it('only ids in the temp format are temp ids', () => {
        expect(isTempOrderId('order-1700000000000-ab12cd34')).toBe(true);
        expect(isTempOrderId('123')).toBe(false);
        expect(isTempOrderId('order-x')).toBe(false);
    });

    it('a numeric-string route id is a real order id', async () => {
        const { api, seen, db } = await setup();
        await api.pricing('123', { discount: 1, discountReason: 'abc' });
        await api.addItem('123', { menuItemId: 1, quantity: 1 });
        expect(seen.map((s) => s.url)).toEqual(['/orders/123/pricing', '/orders/123/items']);
        expect(await db.syncQueue.count()).toBe(0);
    });

    it('a malformed id string is rejected instead of being sent', async () => {
        const { api, seen } = await setup();
        await expect(api.addItem('../x', { menuItemId: 1, quantity: 1 })).rejects.toThrow();
        expect(seen).toHaveLength(0);
    });

    it('createOrder temp ids match the temp format', async () => {
        const { api, setOnline } = await setup();
        setOnline(false);
        const created = (await api.createOrder({ tableId: 1 })) as { entityTempId: string };
        expect(isTempOrderId(created.entityTempId)).toBe(true);
    });
});
