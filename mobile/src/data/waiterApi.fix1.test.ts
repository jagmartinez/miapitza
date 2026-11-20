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

describe('waiterApi fix round 1', () => {
    it('mutations invalidate the owner active orders and floor plan', async () => {
        const { api, reply, db } = await setup();
        reply((req) => ({ data: { success: true, data: req.url.includes('plan') ? { areas: [] } : [] } }));
        const calls: Array<() => Promise<unknown>> = [
            () => api.createOrder({ tableId: 3 }),
            () => api.addItem(5, { menuItemId: 1, quantity: 1 }),
            () => api.updateItem(9, { quantity: 2 }),
            () => api.removeItem(9),
            () => api.sendToKitchen(5),
            () => api.deliverItems(5, [1]),
            () => api.setGuests(5, 2),
            () => api.transfer({ sourceTableId: 1, destinationTableId: 2, orderId: 5 }),
            () => api.groupTables({ primaryTableId: 1, memberTableIds: [2] }),
            () => api.pricing(5, { discount: 1, discountReason: 'abc' }),
            () => api.authorizeDiscount(5, { supervisorUserId: 3, pin: '1234', discount: 1, discountReason: 'abc' }),
            () => api.createPayment({ orderId: 5, paymentMethodId: 1, amount: 5 }),
        ];
        for (const call of calls) {
            await api.activeOrders(1);
            await api.floorPlan(1);
            await api.menu(1);
            expect((await db.caches.toArray()).map((r) => r.url).sort()).toEqual(['/menu-items', '/orders/active', '/tables/plan/1']);
            await call();
            expect((await db.caches.toArray()).map((r) => r.url)).toEqual(['/menu-items']);
        }
    });

    it('invalidates after a queued item is applied by replay', async () => {
        const { api, queue, setOnline, db } = await setup();
        await api.activeOrders(1);
        setOnline(false);
        await api.addItem(5, { menuItemId: 1, quantity: 1 });
        expect(await db.caches.count()).toBe(1); // nothing applied yet
        setOnline(true);
        await queue.process();
        expect(await db.caches.count()).toBe(0);
    });

    it('a temp order ref queues behind its create and syncs with the real id', async () => {
        const { api, queue, setOnline, seen, reply } = await setup();
        setOnline(false);
        const created = await api.createOrder({ tableId: 3 });
        const tempId = (created as { entityTempId: string }).entityTempId;
        await api.addItem(tempId, { menuItemId: 1, quantity: 1 }, { entityTempId: 'g1' });
        await api.sendToKitchen(tempId, { dependencyKey: 'g1' });
        setOnline(true);
        reply((req) => (req.url === '/orders' ? { data: { success: true, data: { id: 41 } } } : {}));
        await queue.process();
        expect(seen.map((s) => s.url)).toEqual(['/orders', '/orders/41/items', '/orders/41/send-to-kitchen']);
    });

    it('ambiguous-failure keys are scoped by owner', async () => {
        const { api, seen, reply, sessions } = await setup();
        reply(() => ({ status: 500 }));
        await expect(api.addItem(5, { menuItemId: 1, quantity: 1 })).rejects.toBeTruthy();
        await sessions.save(sessionFor(2));
        await expect(api.addItem(5, { menuItemId: 1, quantity: 1 })).rejects.toBeTruthy();
        expect(seen[0].key).not.toBe(seen[1].key);
    });

    it('a cached read is dropped when the session changes during the fetch', async () => {
        const { api, reply, sessions, db } = await setup();
        reply(async () => {
            await sessions.save(sessionFor(2));
            return { data: { success: true, data: [{ id: 1 }] } };
        });
        await expect(api.activeOrders(1)).rejects.toBeTruthy();
        expect(await db.caches.count()).toBe(0);
    });
});
