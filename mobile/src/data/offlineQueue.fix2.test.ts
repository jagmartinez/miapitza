import { appEvents } from '../core/events';
import { createOfflineQueue } from './offlineQueue';
import { makeEnv, sessionFor } from './testkit';

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    let t = 1000;
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline, now: () => (t += 10) });
    return { ...env, queue };
}

const add = { url: '/orders/5/items', method: 'POST' as const, data: { menuItemId: 1, quantity: 1 }, operationType: 'ADD_ORDER_ITEM' as const };
const create = { url: '/orders', method: 'POST' as const, data: { tableId: 3 }, operationType: 'CREATE_ORDER' as const };

describe('offlineQueue fix round 2', () => {
    it('I1: an item enqueued while the run is finishing (counts refresh) is still replayed', async () => {
        const { queue, seen, reply, sessions } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        let sent = false;
        let loadsAfterSent = 0;
        let fired = false;
        reply(() => {
            sent = true;
            return {};
        });
        const load = sessions.load.bind(sessions);
        vi.spyOn(sessions, 'load').mockImplementation(async () => {
            if (sent && !fired && ++loadsAfterSent >= 2) {
                fired = true;
                await queue.enqueue({ ...add, url: '/orders/8/items', idempotencyKey: 'late' });
                void queue.process();
            }
            return load();
        });
        await queue.process();
        expect(fired).toBe(true);
        expect(seen.map((s) => s.url)).toEqual(['/orders/5/items', '/orders/8/items']);
        expect(await queue.pendingCount()).toBe(0);
    });

    it('I3: parent delete, id map and dependent rewrites are one transaction', async () => {
        const { queue, db, reply } = await setup();
        await queue.enqueue({ ...create, entityTempId: 'order-aaaa', idempotencyKey: 'c1' });
        await queue.enqueue({ url: '/orders/order-aaaa/items', method: 'POST', data: { menuItemId: 1, quantity: 1 }, operationType: 'ADD_ORDER_ITEM', dependencyKey: 'order-aaaa', idempotencyKey: 'a1' });
        reply(() => ({ data: { success: true, data: { id: 90 } } }));
        // Crash while rewriting the dependent: nothing of the resolution may be left half-done.
        const realUpdate = db.syncQueue.update.bind(db.syncQueue);
        let crash = true;
        vi.spyOn(db.syncQueue, 'update').mockImplementation(((key: number, changes: { url?: string }) => {
            if (crash && changes.url) return Promise.reject(new Error('killed'));
            return realUpdate(key, changes as never);
        }) as never);
        await queue.process().catch(() => undefined);
        const rows = await db.syncQueue.orderBy('id').toArray();
        const parentGone = !rows.some((r) => r.operationType === 'CREATE_ORDER');
        const dependent = rows.find((r) => r.operationType === 'ADD_ORDER_ITEM')!;
        const rewritten = dependent.url === '/orders/90/items';
        expect(parentGone).toBe(rewritten); // all or nothing
        crash = false;
    });

    it('I3: the temp->real map is persisted and applied to a dependent enqueued after the create synced', async () => {
        const { queue, db, reply, seen } = await setup();
        await queue.enqueue({ ...create, entityTempId: 'order-bbbb', idempotencyKey: 'c1' });
        reply(() => ({ data: { success: true, data: { id: 91 } } }));
        await queue.process();
        expect((await db.tempIds.toArray())[0]).toMatchObject({ ownerKey: '1:1', tempId: 'order-bbbb', realId: 91 });
        expect(await queue.resolveTemp('order-bbbb')).toBe(91);
        await queue.enqueue({ url: '/orders/order-bbbb/items', method: 'POST', data: { menuItemId: 2, quantity: 1 }, operationType: 'ADD_ORDER_ITEM', dependencyKey: 'order-bbbb', idempotencyKey: 'late' });
        await queue.enqueue({ url: '/payments', method: 'POST', data: { orderId: 'order-bbbb', amount: 1 }, operationType: 'CREATE_PAYMENT', dependencyKey: 'order-bbbb' });
        const rows = await db.syncQueue.orderBy('id').toArray();
        expect(rows.map((r) => [r.url, r.dependencyKey])).toEqual([
            ['/orders/91/items', null],
            ['/payments', null],
        ]);
        await queue.process();
        expect(seen.map((s) => s.url)).toEqual(['/orders', '/orders/91/items', '/payments']);
        expect(seen[2].data).toEqual({ orderId: 91, amount: 1 });
    });

    it('I3: temp ids match whole path segments and exact values, never substrings', async () => {
        const { queue, db, reply } = await setup();
        await queue.enqueue({ ...create, entityTempId: 'order-1', idempotencyKey: 'c1' });
        await queue.enqueue({ url: '/orders/order-12/items', method: 'POST', data: { note: 'order-1', other: 'order-12', list: ['order-1'] }, operationType: 'ADD_ORDER_ITEM', idempotencyKey: 'a1' });
        await queue.enqueue({ url: '/orders/order-1/items', method: 'POST', data: { note: 'xorder-1' }, operationType: 'ADD_ORDER_ITEM', idempotencyKey: 'a2' });
        reply((req) => (req.url === '/orders' ? { data: { success: true, data: { id: 5 } } } : { status: 500 }));
        await queue.process();
        const rows = await db.syncQueue.orderBy('id').toArray();
        expect(rows[0].url).toBe('/orders/order-12/items');
        expect(rows[0].data).toEqual({ note: 5, other: 'order-12', list: [5] });
        expect(rows[1].url).toBe('/orders/5/items');
        expect(rows[1].data).toEqual({ note: 'xorder-1' });
    });

    it('M2: a replay 401 with a changed token for the same owner resumes with the new token', async () => {
        const { queue, seen, reply, sessions } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        let first = true;
        reply(async () => {
            if (first) {
                first = false;
                await sessions.save(sessionFor(1, 1, 'jwt-new')); // re-login while the request was in flight
                return { status: 401 };
            }
            return {};
        });
        await queue.process();
        expect(seen.map((s) => s.auth)).toEqual(['Bearer jwt-1', 'Bearer jwt-new']);
    });

    it('a replay 401 on the current token clears the session and emits session-expired', async () => {
        const { queue, reply, sessions } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        reply(() => ({ status: 401 }));
        const fn = vi.fn();
        const off = appEvents.on('session-expired', fn);
        await queue.process();
        off();
        expect(fn).toHaveBeenCalledTimes(1);
        expect(await sessions.load()).toBeNull();
    });

    it('M4: a failing listener or db error neither fails the item as a network error nor rejects process()', async () => {
        const { queue, db, reply } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        queue.onSynced(() => {
            throw new Error('listener');
        });
        await expect(queue.process()).resolves.toBeUndefined();
        expect(await db.syncQueue.count()).toBe(0); // it was applied and removed
        await queue.enqueue({ ...add, idempotencyKey: 'k2' });
        vi.spyOn(db.syncQueue, 'get').mockRejectedValue(new Error('db'));
        reply(() => ({}));
        await expect(queue.process()).resolves.toBeUndefined();
    });
});
