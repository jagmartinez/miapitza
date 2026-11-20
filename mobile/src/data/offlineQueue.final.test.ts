import { createOfflineQueue, STALE_AFTER_MS } from './offlineQueue';
import { makeEnv, sessionFor } from './testkit';

async function setup(userId = 1) {
    const env = makeEnv();
    await env.sessions.save(sessionFor(userId));
    let clock = 1_000_000;
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline, now: () => clock });
    return { ...env, queue, advance: (ms: number) => (clock += ms) };
}

const add = { url: '/orders/5/items', method: 'POST' as const, data: { menuItemId: 1, quantity: 1 }, operationType: 'ADD_ORDER_ITEM' as const };
const create = { url: '/orders', method: 'POST' as const, data: { tableId: 3 }, operationType: 'CREATE_ORDER' as const };
const HOUR = 3_600_000;

describe('final review: stale queued work (ruling b)', () => {
    it('an item older than 12 h becomes failed, is visible, and is never replayed on its own', async () => {
        const { queue, advance, seen, setOnline } = await setup();
        setOnline(false);
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        advance(STALE_AFTER_MS + 1);
        setOnline(true);
        await queue.process();
        expect(seen).toHaveLength(0);
        const failed = await queue.listFailed();
        expect(failed).toHaveLength(1);
        expect(failed[0].lastError).toMatch(/12 h/);
        expect(queue.getSnapshot()).toEqual({ pending: 0, failed: 1 });
        await queue.process();
        expect(seen).toHaveLength(0); // still not replayed
    });

    it('works offline too: the list shows it as failed without connectivity', async () => {
        const { queue, advance, setOnline } = await setup();
        setOnline(false);
        await queue.enqueue({ ...add });
        advance(13 * HOUR);
        const items = await queue.listItems();
        expect(items.map((i) => i.status)).toEqual(['failed']);
    });

    it('a stale create takes its dependents with it', async () => {
        const { queue, advance, db } = await setup();
        await queue.enqueue({ ...create, entityTempId: 'order-1-aaaaaaaa' });
        await queue.enqueue({ ...add, url: '/orders/order-1-aaaaaaaa/items', dependencyKey: 'order-1-aaaaaaaa' });
        advance(STALE_AFTER_MS + 1);
        await queue.listItems();
        expect((await db.syncQueue.toArray()).map((r) => r.status)).toEqual(['failed', 'failed']);
    });

    it('an item younger than 12 h replays normally', async () => {
        const { queue, advance, seen } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        advance(11 * HOUR);
        await queue.process();
        expect(seen.map((s) => s.url)).toEqual(['/orders/5/items']);
    });

    it('Reintentar on a stale item is the owner\'s explicit review: it is sent once, with its key', async () => {
        const { queue, advance, seen } = await setup();
        await queue.enqueue({ ...add, idempotencyKey: 'k-stale' });
        advance(20 * HOUR);
        await queue.listItems();
        const [row] = await queue.listFailed();
        await queue.retry(row.id!);
        await queue.process();
        expect(seen).toHaveLength(1);
        expect(seen[0].key).toBe('k-stale');
        expect(await queue.listItems()).toHaveLength(0);
    });
});

describe('final review: pending work per user (ruling a)', () => {
    it('counts every user\'s queued items, so the PIN screen can show "N pendientes"', async () => {
        const { queue, sessions, advance } = await setup(1);
        await queue.enqueue({ ...add, idempotencyKey: 'a1' });
        await queue.enqueue({ ...add, idempotencyKey: 'a2' });
        await sessions.save(sessionFor(2));
        await queue.enqueue({ ...add, idempotencyKey: 'b1' });
        await sessions.clear(); // PIN screen: nobody logged in
        expect(await queue.pendingByUser()).toEqual({ 1: { pending: 2, failed: 0 }, 2: { pending: 1, failed: 0 } });
        advance(STALE_AFTER_MS + 10);
        expect(await queue.pendingByUser()).toEqual({ 1: { pending: 0, failed: 2 }, 2: { pending: 0, failed: 1 } });
    });

    it('queued work is never handed to another user: B lists and replays only B\'s items', async () => {
        const { queue, sessions, seen, db } = await setup(1);
        await queue.enqueue({ ...add, idempotencyKey: 'a1' });
        const rowId = (await db.syncQueue.toArray())[0].id!;
        await sessions.save(sessionFor(2));
        expect(await queue.listItems()).toHaveLength(0);
        await queue.process();
        expect(seen).toHaveLength(0);
        await queue.discard(rowId); // B cannot discard A's row either
        await queue.retry(rowId);
        await sessions.save(sessionFor(1));
        expect(await queue.listItems()).toHaveLength(1);
    });
});

describe('final review: list, retry and discard (ruling c)', () => {
    it('lists pending and failed items of the owner, oldest first, with their label', async () => {
        const { queue, setOnline } = await setup();
        setOnline(false);
        await queue.enqueue({ ...add, idempotencyKey: 'k1', meta: { name: 'Coca', label: '2 × Coca' } });
        await queue.enqueue({ ...create, entityTempId: 'order-9-bbbbbbbb' });
        const items = await queue.listItems();
        expect(items.map((i) => [i.operationType, i.status])).toEqual([
            ['ADD_ORDER_ITEM', 'pending'],
            ['CREATE_ORDER', 'pending'],
        ]);
        expect(items[0].meta?.label).toBe('2 × Coca');
    });

    it('Reintentar on a pending item skips its backoff and replays it now', async () => {
        const { queue, seen, reply, db } = await setup();
        reply(() => ({ network: true }));
        await queue.enqueue({ ...add, idempotencyKey: 'k1' });
        await queue.process();
        expect((await db.syncQueue.toArray())[0].nextAttemptAt).toBeGreaterThan(0);
        reply(() => ({}));
        await queue.retry((await db.syncQueue.toArray())[0].id!);
        await queue.process();
        expect(seen).toHaveLength(2);
        expect(await queue.pendingCount()).toBe(0);
    });

    it('Descartar removes a pending item and fails what depended on it', async () => {
        const { queue, db, setOnline } = await setup();
        setOnline(false);
        await queue.enqueue({ ...create, entityTempId: 'order-1-aaaaaaaa' });
        await queue.enqueue({ ...add, url: '/orders/order-1-aaaaaaaa/items', dependencyKey: 'order-1-aaaaaaaa' });
        const [first] = await queue.listItems();
        await queue.discard(first.id!);
        expect((await db.syncQueue.toArray()).map((r) => r.status)).toEqual(['failed']);
    });
});

describe('final review: queued state the screens show (Opus I3, Fable I5)', () => {
    it('pendingCreates lists the owner\'s unsynced creates with their table', async () => {
        const { queue, sessions } = await setup(1);
        await queue.enqueue({ ...create, entityTempId: 'order-1-aaaaaaaa', data: { tableId: 3, guests: 2 } });
        await sessions.save(sessionFor(2));
        await queue.enqueue({ ...create, entityTempId: 'order-2-bbbbbbbb', data: { tableId: 4 } });
        expect(await queue.pendingCreates()).toMatchObject([{ tempId: 'order-2-bbbbbbbb', tableId: 4 }]);
        await sessions.save(sessionFor(1));
        expect(await queue.pendingCreates()).toMatchObject([{ tempId: 'order-1-aaaaaaaa', tableId: 3, guests: 2 }]);
    });

    it('queuedLines returns the owner\'s queued lines of one order, by temp id and, after the create synced, by real id', async () => {
        const { queue, reply } = await setup();
        reply((req) => (req.url === '/orders' ? { data: { success: true, data: { id: 9 } } } : { network: true }));
        await queue.enqueue({ ...create, entityTempId: 'order-1-aaaaaaaa' });
        await queue.enqueue({ ...add, url: '/orders/order-1-aaaaaaaa/items', data: { menuItemId: 4, quantity: 2, notes: 'sin hielo' }, dependencyKey: 'order-1-aaaaaaaa', meta: { name: 'Cola', unitPrice: 30, modifierNames: ['grande'] } });
        await queue.enqueue({ ...add, url: '/orders/77/items', meta: { name: 'Otra' } });
        expect(await queue.queuedLines('order-1-aaaaaaaa')).toMatchObject([{ menuItemId: 4, quantity: 2, notes: 'sin hielo', name: 'Cola', unitPrice: 30, modifierNames: ['grande'], status: 'blocked' }].map((l) => ({ ...l, status: expect.any(String) })));
        await queue.process(); // the create syncs, the line then fails on the network and stays queued under the real id
        const lines = await queue.queuedLines(9);
        expect(lines).toHaveLength(1);
        expect(lines[0].name).toBe('Cola');
        expect(await queue.queuedLines(77)).toHaveLength(1);
    });
});
