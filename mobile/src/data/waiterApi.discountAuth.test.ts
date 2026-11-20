import { createCache } from './cache';
import { createOfflineQueue } from './offlineQueue';
import { createWaiterApi } from './waiterApi';
import { makeEnv, sessionFor } from './testkit';

const PIN = '4321';
const body = { supervisorUserId: 3, pin: PIN, discount: 20, discountReason: 'Cortesía' };

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline });
    const api = createWaiterApi({ http: env.http, sessions: env.sessions, cache: createCache(env.db), queue, isOnline: env.isOnline });
    return { ...env, queue, api };
}

describe('authorizeDiscount over the real http client (PIN hygiene)', () => {
    it('every attempt uses a fresh idempotency key, even after an ambiguous failure with the same body', async () => {
        const { api, reply, seen } = await setup();
        reply(() => ({ network: true }));
        await expect(api.authorizeDiscount(5, body)).rejects.toBeTruthy();
        await expect(api.authorizeDiscount(5, body)).rejects.toBeTruthy();
        const keys = seen.filter((s) => s.url.includes('/discount/authorize')).map((s) => s.key);
        expect(keys).toHaveLength(2);
        expect(keys[0]).toBeTruthy();
        expect(keys[0]).not.toBe(keys[1]); // a retry map keyed by the body would reuse the first key (and hold the PIN)
    });

    it('the PIN is not left on the error the caller receives', async () => {
        const { api, reply } = await setup();
        for (const r of [{ status: 401 }, { network: true }, { status: 500 }]) {
            reply(() => r);
            const error = await api.authorizeDiscount(5, body).then(
                () => null,
                (e) => e,
            );
            expect(error).toBeTruthy();
            expect(String(error?.config?.data ?? '')).not.toContain(PIN);
            expect(JSON.stringify(error?.response?.config?.data ?? '')).not.toContain(PIN);
        }
    });

    it('is never queued, offline included, and leaves the queue empty', async () => {
        const { api, reply, setOnline, db, seen } = await setup();
        setOnline(false);
        reply(() => ({ network: true }));
        const result = await api.authorizeDiscount(5, body).then(
            (r) => r,
            () => 'rejected',
        );
        expect(result).toBe('rejected'); // not a { _offline: true } marker
        expect(await db.table('syncQueue').count()).toBe(0);
        expect(seen.some((s) => s.url.includes('/discount/authorize'))).toBe(true); // tried live, once
        for (const table of db.tables) expect(JSON.stringify(await table.toArray())).not.toContain(PIN);
    });

    it('a real 401 (wrong PIN) leaves the session intact', async () => {
        const { api, reply, sessions } = await setup();
        reply(() => ({ status: 401 }));
        await expect(api.authorizeDiscount(5, body)).rejects.toMatchObject({ response: { status: 401 } });
        expect((await sessions.load())?.token).toBe('jwt-1');
    });

    it('success resolves the order and does not store the PIN anywhere', async () => {
        const { api, reply, db } = await setup();
        reply(() => ({ data: { success: true, data: { id: 5, discount: '20.00' } } }));
        await expect(api.authorizeDiscount(5, body)).resolves.toMatchObject({ id: 5 });
        for (const table of db.tables) expect(JSON.stringify(await table.toArray())).not.toContain(PIN);
    });
});
