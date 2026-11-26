import { createOfflineQueue } from './offlineQueue';
import { StorageError } from './storage';
import { makeEnv, sessionFor } from './testkit';

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    let t = 1000;
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline, now: () => (t += 10) });
    return { ...env, queue };
}

const add = { url: '/orders/5/items', method: 'POST' as const, data: { menuItemId: 1, quantity: 1 }, operationType: 'ADD_ORDER_ITEM' as const };

describe('offlineQueue fix round 1', () => {
    it('an item enqueued during a run is sent by the same process()', async () => {
        const { queue, seen, reply } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'x1' });
        let first = true;
        reply(async () => {
            if (first) {
                first = false;
                await queue.enqueue({ ...add, url: '/orders/8/items', idempotencyKey: 'x2' });
            }
            return {};
        });
        await queue.process();
        expect(seen.map((s) => s.url)).toEqual(['/orders/5/items', '/orders/8/items']);
        expect(await queue.pendingCount()).toBe(0);
    });

    it('a PIN switch during a run halts owner A and resumes owner B in the same run', async () => {
        const { queue, seen, reply, sessions } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'a1' });
        await queue.enqueue({ ...add, url: '/orders/6/items', idempotencyKey: 'a2' });
        await sessions.save(sessionFor(2));
        await queue.enqueue({ ...add, url: '/orders/9/items', idempotencyKey: 'b1' });
        await sessions.save(sessionFor(1));
        let first = true;
        reply(async () => {
            if (first) {
                first = false;
                await sessions.save(sessionFor(2));
                queue.notifySessionChanged();
            }
            return {};
        });
        await queue.process();
        expect(seen.map((s) => [s.url, s.auth])).toEqual([
            ['/orders/5/items', 'Bearer jwt-1'],
            ['/orders/9/items', 'Bearer jwt-2'],
        ]);
    });

    it('never sends owner A item when the session switches right before the request', async () => {
        const { queue, seen, db, sessions } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'a1' });
        const original = db.syncQueue.update.bind(db.syncQueue);
        vi.spyOn(db.syncQueue, 'update').mockImplementation((async (key: number, changes: { status?: string }) => {
            const r = await original(key, changes as never);
            if (changes.status === 'processing') await sessions.save(sessionFor(2));
            return r;
        }) as never);
        await queue.process();
        expect(seen).toHaveLength(0);
        expect((await db.syncQueue.toArray())[0].status).toBe('pending');
    });

    it('a network error does not consume a retry and pauses the run', async () => {
        const { queue, seen, reply, db } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        await queue.enqueue({ ...add, url: '/orders/6/items', idempotencyKey: 'k2' });
        reply(() => ({ network: true }));
        await queue.process();
        expect(seen).toHaveLength(1); // run paused, second item not hammered
        let [row] = await db.syncQueue.orderBy('id').toArray();
        expect(row).toMatchObject({ status: 'pending', retryCount: 0, networkFailures: 1 });
        for (let i = 0; i < 8; i += 1) {
            await db.syncQueue.toCollection().modify({ nextAttemptAt: 0 });
            await queue.process();
        }
        [row] = await db.syncQueue.orderBy('id').toArray();
        expect(row.status).toBe('pending');
        expect(row.retryCount).toBe(0);
        reply(() => ({}));
        await db.syncQueue.toCollection().modify({ nextAttemptAt: 0 });
        await queue.process();
        expect(await queue.pendingCount()).toBe(0);
    });

    it('discarding a parent fails its dependents', async () => {
        const { queue, db } = await setup();
        const parent = await queue.enqueue({ ...add, entityTempId: 'g', idempotencyKey: 'k1' });
        await queue.enqueue({ url: '/orders/5/send-to-kitchen', method: 'POST', data: undefined, operationType: 'SEND_TO_KITCHEN', dependencyKey: 'g' });
        await queue.discard(parent.id!);
        const rows = await db.syncQueue.toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('failed');
    });

    it('create offline, then add items and send: dependents hit the real order id after replay', async () => {
        const { queue, seen, reply, db } = await setup();
        await queue.enqueue({ url: '/orders', method: 'POST', data: { tableId: 3 }, operationType: 'CREATE_ORDER', entityTempId: 'order-T1', idempotencyKey: 'c1' });
        await queue.enqueue({ url: '/orders/order-T1/items', method: 'POST', data: { menuItemId: 1, quantity: 1 }, operationType: 'ADD_ORDER_ITEM', dependencyKey: 'order-T1', entityTempId: 'g1', idempotencyKey: 'a1' });
        await queue.enqueue({ url: '/orders/order-T1/send-to-kitchen', method: 'POST', data: undefined, operationType: 'SEND_TO_KITCHEN', dependencyKey: 'g1' });
        await queue.enqueue({ url: '/payments', method: 'POST', data: { orderId: 'order-T1', amount: 5 }, operationType: 'CREATE_PAYMENT', dependencyKey: 'order-T1' });
        reply((req) => (req.url === '/orders' ? { data: { success: true, data: { id: 77 } } } : {}));
        await queue.process();
        expect(seen.map((s) => s.url)).toEqual(['/orders', '/orders/77/items', '/orders/77/send-to-kitchen', '/payments']);
        expect(seen[3].data).toEqual({ orderId: 77, amount: 5 });
        expect(await db.syncQueue.count()).toBe(0);
    });

    it('enqueue failure is a StorageError', async () => {
        const { queue, db } = await setup();
        vi.spyOn(db.syncQueue, 'add').mockRejectedValue(new Error('quota'));
        await expect(queue.enqueue({ ...add })).rejects.toBeInstanceOf(StorageError);
    });
});
