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

describe('offlineQueue', () => {
    it('replays in timestamp order with the stored idempotency key and the session bearer', async () => {
        const { queue, seen } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        await queue.enqueue({ ...add, url: '/orders/6/items', idempotencyKey: 'k2' });
        await queue.process();
        expect(seen.map((s) => [s.url, s.key, s.auth])).toEqual([
            ['/orders/5/items', 'k1', 'Bearer jwt-1'],
            ['/orders/6/items', 'k2', 'Bearer jwt-1'],
        ]);
        expect(await queue.pendingCount()).toBe(0);
    });

    it('send-to-kitchen waits for its dependency', async () => {
        const { queue, seen, reply, db } = await setup();
        await queue.enqueue({ ...add, entityTempId: 'order-5-kitchen-a', idempotencyKey: 'k1' });
        await queue.enqueue({ url: '/orders/5/send-to-kitchen', method: 'POST', data: undefined, operationType: 'SEND_TO_KITCHEN', dependencyKey: 'order-5-kitchen-a' });
        reply((req) => (req.url.endsWith('/items') ? { status: 500 } : {}));
        await queue.process();
        expect(seen.map((s) => s.url)).toEqual(['/orders/5/items']); // send did not go
        const rows = await db.syncQueue.toArray();
        expect(rows.find((r) => r.operationType === 'SEND_TO_KITCHEN')?.status).toBe('blocked');
        const addRow = rows.find((r) => r.operationType === 'ADD_ORDER_ITEM')!;
        expect(addRow.retryCount).toBe(1);
        expect(addRow.nextAttemptAt! - Date.now()).toBeLessThanOrEqual(2000); // 1000 * 2^1 backoff
        reply(() => ({}));
        await db.syncQueue.update(addRow.id!, { nextAttemptAt: 0 });
        await queue.process();
        expect(seen.map((s) => s.url)).toEqual(['/orders/5/items', '/orders/5/items', '/orders/5/send-to-kitchen']);
        expect(await queue.pendingCount()).toBe(0);
    });

    it('a permanent failure fails its dependents and stays for manual retry', async () => {
        const { queue, reply, db } = await setup();
        await queue.enqueue({ ...add, entityTempId: 'g', idempotencyKey: 'k1' });
        await queue.enqueue({ url: '/orders/5/send-to-kitchen', method: 'POST', data: undefined, operationType: 'SEND_TO_KITCHEN', dependencyKey: 'g' });
        reply(() => ({ status: 422 }));
        await queue.process();
        const rows = await db.syncQueue.toArray();
        expect(rows.map((r) => r.status)).toEqual(['failed', 'failed']);
        expect(queue.getSnapshot().failed).toBe(2);
        expect(await queue.pendingCount()).toBe(0);
        // manual retry puts the root back with its idempotency key
        await queue.retry(rows[0].id!);
        expect((await db.syncQueue.get(rows[0].id!))?.status).toBe('pending');
    });

    it('retries transient 409 but fails after 5 attempts', async () => {
        const { queue, reply, db } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        reply(() => ({ status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' }));
        for (let i = 0; i < 5; i += 1) {
            await db.syncQueue.toCollection().modify({ nextAttemptAt: 0 });
            await queue.process();
        }
        const row = (await db.syncQueue.toArray())[0];
        expect(row.status).toBe('failed');
        expect(row.retryCount).toBe(5);
    });

    it('replay stops when the session owner changes and resumes for that owner', async () => {
        const { queue, seen, reply, sessions } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'a1' });
        await queue.enqueue({ ...add, url: '/orders/6/items', idempotencyKey: 'a2' });
        reply(async () => {
            await sessions.save(sessionFor(2)); // PIN switch while the first request is in flight
            return {};
        });
        await queue.process();
        expect(seen.map((s) => s.url)).toEqual(['/orders/5/items']);
        expect(await queue.pendingCount()).toBe(0); // owner 2 sees nothing of owner 1
        await queue.enqueue({ ...add, url: '/orders/9/items', idempotencyKey: 'b1' });
        expect(await queue.pendingCount()).toBe(1);
        reply(() => ({}));
        await queue.process(); // only owner 2's item
        expect(seen.map((s) => s.url)).toEqual(['/orders/5/items', '/orders/9/items']);
        await sessions.save(sessionFor(1));
        queue.notifySessionChanged();
        await queue.process();
        expect(seen.map((s) => s.url)).toEqual(['/orders/5/items', '/orders/9/items', '/orders/6/items']);
    });

    it('does not replay while offline and keeps a 401 item pending', async () => {
        const { queue, seen, setOnline, reply, db } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        setOnline(false);
        await queue.process();
        expect(seen).toHaveLength(0);
        setOnline(true);
        reply(() => ({ status: 401 }));
        await queue.process();
        const row = (await db.syncQueue.toArray())[0];
        expect(row.status).toBe('pending');
        expect(row.retryCount).toBe(0);
    });

    it('pendingCount is observable', async () => {
        const { queue } = await setup();
        const counts: number[] = [];
        queue.subscribe(() => counts.push(queue.getSnapshot().pending));
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        await queue.process();
        expect(counts).toContain(1);
        expect(counts[counts.length - 1]).toBe(0);
    });
});
