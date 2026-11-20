import { createCache } from './cache';
import { createOfflineQueue } from './offlineQueue';
import { createWaiterApi, isQueuedOffline } from './waiterApi';
import { makeEnv, sessionFor } from './testkit';

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline });
    const api = createWaiterApi({ http: env.http, sessions: env.sessions, cache: createCache(env.db), queue, isOnline: env.isOnline });
    return { ...env, queue, api };
}

describe('waiterApi', () => {
    it('create-order offline queues with entityTempId and resolves _offline', async () => {
        const { api, setOnline, seen, db } = await setup();
        setOnline(false);
        const res = await api.createOrder({ tableId: 3, items: [{ menuItemId: 1, quantity: 2 }] });
        expect(isQueuedOffline(res)).toBe(true);
        expect(res).toMatchObject({ _offline: true });
        const tempId = (res as { entityTempId: string }).entityTempId;
        expect(tempId).toMatch(/^order-/);
        expect(seen).toHaveLength(0);
        const [row] = await db.syncQueue.toArray();
        expect(row).toMatchObject({ operationType: 'CREATE_ORDER', url: '/orders', method: 'POST', ownerKey: '1:1', status: 'pending' });
        expect(row.entityTempId).toBe(tempId);
        expect(row.idempotencyKey).toBeTruthy();
        expect(JSON.stringify(row)).not.toContain('jwt-1');
    });

    it('online create returns the unwrapped order with an idempotency key', async () => {
        const { api, seen, reply } = await setup();
        reply(() => ({ data: { success: true, data: { id: 7 } } }));
        expect(await api.createOrder({ tableId: 3 })).toEqual({ id: 7 });
        expect(seen[0].key).toBeTruthy();
    });

    it('ambiguous failure reuses the same idempotency key, a new action gets a new key', async () => {
        const { api, seen, reply } = await setup();
        reply(() => ({ status: 500 }));
        await expect(api.addItem(5, { menuItemId: 1, quantity: 1 })).rejects.toBeTruthy();
        reply(() => ({ network: true }));
        await expect(api.addItem(5, { menuItemId: 1, quantity: 1 })).rejects.toBeTruthy();
        reply(() => ({}));
        await api.addItem(5, { menuItemId: 1, quantity: 1 });
        expect(new Set(seen.map((s) => s.key)).size).toBe(1);
        await api.addItem(5, { menuItemId: 2, quantity: 1 }); // different action
        await api.addItem(5, { menuItemId: 1, quantity: 1 }); // same payload after success = new action
        expect(new Set(seen.map((s) => s.key)).size).toBe(3);
    });

    it('a definitive rejection does not keep its key', async () => {
        const { api, seen, reply } = await setup();
        reply(() => ({ status: 422 }));
        await expect(api.addItem(5, { menuItemId: 1, quantity: 1 })).rejects.toBeTruthy();
        reply(() => ({}));
        await api.addItem(5, { menuItemId: 1, quantity: 1 });
        expect(seen[0].key).not.toBe(seen[1].key);
    });

    it('send-to-kitchen queues with its dependency, even online when forced', async () => {
        const { api, db } = await setup();
        await api.sendToKitchen(5, { dependencyKey: 'order-5-kitchen-a', forceQueue: true });
        const [row] = await db.syncQueue.toArray();
        expect(row).toMatchObject({ operationType: 'SEND_TO_KITCHEN', dependencyKey: 'order-5-kitchen-a', url: '/orders/5/send-to-kitchen' });
    });

    it('non-queueable mutations fail offline instead of queueing', async () => {
        const { api, setOnline, reply, db } = await setup();
        setOnline(false);
        reply(() => ({ network: true }));
        await expect(api.setGuests(5, 3)).rejects.toBeTruthy();
        expect(await db.syncQueue.count()).toBe(0);
    });

    it('routes match the server contracts', async () => {
        const { api, seen } = await setup();
        await api.updateItem(9, { quantity: 2 });
        await api.removeItem(9);
        await api.deliverItems(5, [1, 2]);
        await api.setGuests(5, 4);
        await api.pricing(5, { discount: 10, discountReason: 'cortesia' });
        await api.authorizeDiscount(5, { supervisorUserId: 3, pin: '1234', discount: 10, discountReason: 'cortesia' });
        await api.supervisors();
        await api.discountLimit();
        await api.markNotificationSeen(4);
        expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
            'PATCH /orders/items/9',
            'DELETE /orders/items/9',
            'POST /orders/5/items/deliver',
            'PATCH /orders/5/guests',
            'PATCH /orders/5/pricing',
            'POST /orders/5/discount/authorize',
            'GET /orders/discount/supervisors',
            'GET /auth/me/discount-limit',
            'PATCH /kitchen-notifications/4/seen',
        ]);
        expect(seen[2].data).toEqual({ itemIds: [1, 2] });
    });

    it('menu is served from cache then refreshed', async () => {
        const { api, reply, seen } = await setup();
        let v = 1;
        reply(() => ({ data: { success: true, data: [{ id: v }] } }));
        expect((await api.menu(1)).data).toEqual([{ id: 1 }]);
        v = 2;
        const second = await api.menu(1);
        expect(second.data).toEqual([{ id: 1 }]);
        await second.refresh;
        expect(seen.filter((s) => s.url === '/menu-items')).toHaveLength(2);
    });
});
