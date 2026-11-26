import { createCache } from './cache';
import { createOfflineQueue } from './offlineQueue';
import { createWaiterApi } from './waiterApi';
import { makeEnv, sessionFor } from './testkit';

describe('waiterApi.orderDetail', () => {
    it('reads the live order (with payments) and never caches it', async () => {
        const env = makeEnv();
        await env.sessions.save(sessionFor(1));
        const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline });
        const api = createWaiterApi({ http: env.http, sessions: env.sessions, cache: createCache(env.db), queue, isOnline: env.isOnline });
        env.reply(() => ({ data: { success: true, data: { id: 5, payments: [{ amount: '100.00', status: 'ACTIVE' }] } } }));
        expect(await api.orderDetail(5)).toMatchObject({ id: 5 });
        await api.orderDetail(5);
        expect(env.seen.map((s) => `${s.method} ${s.url}`)).toEqual(['GET /orders/5', 'GET /orders/5']);
    });
});
