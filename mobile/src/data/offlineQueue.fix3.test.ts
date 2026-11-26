import { createOfflineQueue } from './offlineQueue';
import { makeEnv, sessionFor } from './testkit';

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline });
    return { ...env, queue };
}

const add = { url: '/orders/5/items', method: 'POST' as const, data: { menuItemId: 1, quantity: 1 }, operationType: 'ADD_ORDER_ITEM' as const };
const create = { url: '/orders', method: 'POST' as const, data: { tableId: 3 }, operationType: 'CREATE_ORDER' as const };

describe('offlineQueue fix round 3', () => {
    it('I4: enqueue reads the id map and inserts in one transaction over tempIds and syncQueue', async () => {
        const { queue, db } = await setup();
        const spy = vi.spyOn(db, 'transaction');
        await queue.enqueue({ ...add });
        const call = spy.mock.calls.find((c) => (c as unknown[]).some((x) => x === db.tempIds) && (c as unknown[]).some((x) => x === db.syncQueue));
        expect(call?.[0]).toBe('rw');
    });

    it('I4: dependents enqueued while the create is syncing never keep the temp id', async () => {
        for (let delay = 0; delay < 14; delay += 1) {
            const { queue, db, seen, reply } = await setup();
            await queue.enqueue({ ...create, entityTempId: 'order-100-aaaaaaaa', idempotencyKey: 'c' });
            reply((req) => (req.url === '/orders' ? { data: { success: true, data: { id: 9 } } } : {}));
            const run = queue.process();
            for (let i = 0; i < delay; i += 1) await new Promise((r) => setTimeout(r, 0));
            await queue.enqueue({ url: '/orders/order-100-aaaaaaaa/items', method: 'POST', data: { menuItemId: 1, quantity: 1 }, operationType: 'ADD_ORDER_ITEM', dependencyKey: 'order-100-aaaaaaaa', idempotencyKey: `late${delay}` });
            await run;
            await queue.process();
            expect(seen.some((s) => s.url.includes('order-100')), `delay ${delay}`).toBe(false);
            expect((await db.syncQueue.toArray()).filter((r) => r.status === 'failed'), `delay ${delay}`).toHaveLength(0);
            expect(seen.map((s) => s.url)).toEqual(['/orders', '/orders/9/items']);
        }
    });

    it('a dirty flag set during a failing run is honoured', async () => {
        const { queue, seen, db } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        vi.spyOn(db.syncQueue, 'get').mockImplementationOnce((() => {
            void queue.process(); // request arriving while the run is failing
            return Promise.reject(new Error('db'));
        }) as never);
        await queue.process();
        expect(seen).toHaveLength(1);
    });

    it('a create response without an id fails the item with a clear error and fails its dependents', async () => {
        const { queue, db, reply } = await setup();
        await queue.enqueue({ ...create, entityTempId: 'order-200-bbbbbbbb', idempotencyKey: 'c' });
        await queue.enqueue({ url: '/orders/order-200-bbbbbbbb/items', method: 'POST', data: {}, operationType: 'ADD_ORDER_ITEM', dependencyKey: 'order-200-bbbbbbbb', idempotencyKey: 'a' });
        reply(() => ({ data: { success: true, data: {} } }));
        await queue.process();
        const rows = await db.syncQueue.orderBy('id').toArray();
        expect(rows.map((r) => r.status)).toEqual(['failed', 'failed']);
        expect(rows[0].lastError).toMatch(/id del pedido/);
        expect(await db.tempIds.count()).toBe(0);
    });

    it('a dependent enqueued after its parent was discarded is created failed', async () => {
        const { queue, db } = await setup();
        const parent = await queue.enqueue({ ...create, entityTempId: 'order-300-cccccccc', idempotencyKey: 'c' });
        await queue.discard(parent.id!);
        const late = await queue.enqueue({ url: '/orders/order-300-cccccccc/items', method: 'POST', data: {}, operationType: 'ADD_ORDER_ITEM', dependencyKey: 'order-300-cccccccc' });
        expect((await db.syncQueue.get(late.id!))?.status).toBe('failed');
        expect(await queue.resolveTemp('order-300-cccccccc')).toBeNull();
    });

    it('a dependent enqueued after its parent failed is created failed', async () => {
        const { queue, db, reply } = await setup();
        await queue.enqueue({ ...create, entityTempId: 'order-400-dddddddd', idempotencyKey: 'c' });
        reply(() => ({ status: 422 }));
        await queue.process();
        const late = await queue.enqueue({ url: '/orders/order-400-dddddddd/items', method: 'POST', data: {}, operationType: 'ADD_ORDER_ITEM', dependencyKey: 'order-400-dddddddd' });
        expect((await db.syncQueue.get(late.id!))?.status).toBe('failed');
    });
});
