import { createCache } from './cache';
import { createOfflineQueue } from './offlineQueue';
import { createWaiterApi } from './waiterApi';
import { makeEnv, sessionFor } from './testkit';

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline });
    const api = createWaiterApi({ http: env.http, sessions: env.sessions, cache: createCache(env.db), queue, isOnline: env.isOnline });
    return { ...env, queue, api };
}

const A = '1:1';
const line = { menuItemId: 5, quantity: 2 };

describe('final review: work started by one user never runs under another (I2, ruling f)', () => {
    it('online: a call bound to A is refused once B holds the session, and nothing is sent', async () => {
        const { api, sessions, seen } = await setup();
        await sessions.save(sessionFor(2)); // A locked, B logged in
        await expect(api.addItem(7, line, { owner: A })).rejects.toMatchObject({ name: 'SessionChangedError' });
        await expect(api.sendToKitchen(7, { owner: A })).rejects.toMatchObject({ name: 'SessionChangedError' });
        expect(seen).toHaveLength(0);
    });

    it('offline: a call bound to A never lands in B\'s queue', async () => {
        const { api, sessions, db, setOnline } = await setup();
        setOnline(false);
        await sessions.save(sessionFor(2));
        await expect(api.addItem(7, line, { owner: A })).rejects.toMatchObject({ name: 'SessionChangedError' });
        await expect(api.createOrder({ tableId: 3 }, { owner: A })).rejects.toMatchObject({ name: 'SessionChangedError' });
        expect(await db.syncQueue.count()).toBe(0);
    });

    it('locked with nobody logged in: refused too', async () => {
        const { api, sessions, seen } = await setup();
        await sessions.clear();
        await expect(api.addItem(7, line, { owner: A })).rejects.toMatchObject({ name: 'SessionChangedError' });
        expect(seen).toHaveLength(0);
    });

    it('the request carries the token of the session the call started with', async () => {
        const { api, seen } = await setup();
        await api.addItem(7, line, { owner: A });
        expect(seen[0].auth).toBe('Bearer jwt-1');
    });

    it('the queue refuses an item bound to an owner who is no longer the session', async () => {
        const { queue, sessions, db } = await setup();
        await sessions.save(sessionFor(2));
        await expect(queue.enqueue({ url: '/orders/1/items', method: 'POST', data: {}, operationType: 'ADD_ORDER_ITEM', ownerKey: A })).rejects.toMatchObject({ name: 'SessionChangedError' });
        expect(await db.syncQueue.count()).toBe(0);
    });

    it('queued work of A is never replayed under B (no hand-off between users)', async () => {
        const { api, queue, sessions, setOnline, seen, db } = await setup();
        setOnline(false);
        await api.addItem(7, line);
        await sessions.save(sessionFor(2));
        setOnline(true);
        await queue.process();
        expect(seen.filter((s) => s.url.startsWith('/orders'))).toHaveLength(0);
        expect((await db.syncQueue.toArray())[0].ownerKey).toBe(A);
        await sessions.save(sessionFor(1));
        await queue.process();
        expect(seen.filter((s) => s.url === '/orders/7/items')).toHaveLength(1);
    });
});

describe('final review: a retry key belongs to one action (Fable I1)', () => {
    const lost = { network: true } as const;

    it('an identical new action after an unretried ambiguous failure gets a new key', async () => {
        const { api, seen, reply } = await setup();
        reply(() => lost);
        await expect(api.addItem(12, line, { actionId: 'line-1' })).rejects.toBeDefined();
        reply(() => ({}));
        await api.addItem(12, line, { actionId: 'line-2' }); // the waiter re-added the same product later
        expect(seen[1].key).not.toBe(seen[0].key);
    });

    it('the retry of the same action still reuses its key', async () => {
        const { api, seen, reply } = await setup();
        reply(() => lost);
        await expect(api.addItem(12, line, { actionId: 'line-1' })).rejects.toBeDefined();
        reply(() => ({}));
        await api.addItem(12, line, { actionId: 'line-1' });
        expect(seen[1].key).toBe(seen[0].key);
    });

    it('createOrder: a later open of the same table is a new action, a retry of the same open is not', async () => {
        const { api, seen, reply } = await setup();
        reply(() => lost);
        await expect(api.createOrder({ tableId: 5, guests: 2 }, { actionId: 'open-1' })).rejects.toBeDefined();
        await expect(api.createOrder({ tableId: 5, guests: 2 }, { actionId: 'open-1' })).rejects.toBeDefined();
        expect(seen[1].key).toBe(seen[0].key);
        reply(() => ({ data: { success: true, data: { id: 9 } } }));
        await api.createOrder({ tableId: 5, guests: 2 }, { actionId: 'open-2' });
        expect(seen[2].key).not.toBe(seen[0].key);
    });

    it('a later success on the same route drops the key of an abandoned ambiguous attempt (PATCH quantity 2, then 3, then 2)', async () => {
        const { api, seen, reply } = await setup();
        reply(() => lost);
        await expect(api.updateItem(4, { quantity: 2 })).rejects.toBeDefined();
        reply(() => ({}));
        await api.updateItem(4, { quantity: 3 });
        await api.updateItem(4, { quantity: 2 });
        expect(seen[2].key).not.toBe(seen[0].key);
    });

    it('sending the batch to the kitchen closes the open attempts of that order', async () => {
        const { api, seen, reply } = await setup();
        reply(() => lost);
        await expect(api.addItem(12, line)).rejects.toBeDefined();
        reply(() => ({}));
        await api.sendToKitchen(12, { nonce: 'n1' });
        await api.addItem(12, line);
        expect(seen[2].key).not.toBe(seen[0].key);
    });
});

describe('final review: a table with a local order cannot get a second one (Opus I3)', () => {
    it('createOrder refuses a table that already has a queued create, naming the temp order to open instead', async () => {
        const { api, db, setOnline } = await setup();
        setOnline(false);
        const first = (await api.createOrder({ tableId: 5, guests: 2 })) as { entityTempId: string };
        await expect(api.createOrder({ tableId: 5, guests: 4 })).rejects.toMatchObject({ name: 'TableHasLocalOrderError', tempId: first.entityTempId });
        expect(await db.syncQueue.count()).toBe(1);
        await api.createOrder({ tableId: 6 }); // another table is fine
        expect(await db.syncQueue.count()).toBe(2);
    });

    it('once the create synced, or if it failed, the table is not held any more', async () => {
        const { api, queue, db, setOnline, reply } = await setup();
        setOnline(false);
        await api.createOrder({ tableId: 5 });
        setOnline(true);
        reply((req) => (req.url === '/orders' ? { data: { success: true, data: { id: 9 } } } : {}));
        await queue.process();
        expect(await db.syncQueue.count()).toBe(0);
        setOnline(false);
        await expect(api.createOrder({ tableId: 5 })).resolves.toMatchObject({ _offline: true });
        const [row] = await db.syncQueue.toArray();
        await db.syncQueue.update(row.id!, { status: 'failed' });
        await expect(api.createOrder({ tableId: 5 })).resolves.toMatchObject({ _offline: true });
    });
});
