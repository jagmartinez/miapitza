import { createCache } from './cache';
import { createOfflineQueue } from './offlineQueue';
import { createWaiterApi, OrderNotSyncedError } from './waiterApi';
import { makeEnv, sessionFor } from './testkit';

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline });
    const api = createWaiterApi({ http: env.http, sessions: env.sessions, cache: createCache(env.db), queue, isOnline: env.isOnline });
    return { ...env, queue, api };
}

const realIdFor = (id: number) => (req: { url: string }) => (req.url === '/orders' ? { data: { success: true, data: { id } } } : {});

describe('waiterApi temp order ids (fix round 2)', () => {
    it('createPayment with a temp id queues behind the create even when online, and syncs with the real id', async () => {
        const { api, queue, setOnline, seen, reply, db } = await setup();
        setOnline(false);
        const created = await api.createOrder({ tableId: 3 });
        const temp = (created as { entityTempId: string }).entityTempId;
        setOnline(true);
        await api.createPayment({ orderId: temp, paymentMethodId: 1, amount: 5 });
        expect(seen.filter((s) => s.url === '/payments')).toHaveLength(0); // not sent with a temp id
        const rows = await db.syncQueue.orderBy('id').toArray();
        expect(rows[1]).toMatchObject({ operationType: 'CREATE_PAYMENT', dependencyKey: temp });
        reply(realIdFor(33));
        await queue.process();
        expect(seen.map((s) => s.url)).toEqual(['/orders', '/payments']);
        expect(seen[1].data).toMatchObject({ orderId: 33 });
    });

    it('addItem and sendToKitchen need no hand-written dependency', async () => {
        const { api, db, setOnline } = await setup();
        setOnline(false);
        const created = await api.createOrder({ tableId: 3 });
        const temp = (created as { entityTempId: string }).entityTempId;
        await api.addItem(temp, { menuItemId: 1, quantity: 1 });
        await api.sendToKitchen(temp);
        await api.setGuests(temp, 2);
        const rows = await db.syncQueue.orderBy('id').toArray();
        expect(rows.slice(1).map((r) => [r.operationType, r.dependencyKey])).toEqual([
            ['ADD_ORDER_ITEM', temp],
            ['SEND_TO_KITCHEN', temp],
            ['GENERIC_MUTATION', temp],
        ]);
    });

    it('operations that cannot be deferred refuse a temp id instead of sending it', async () => {
        const { api, seen, setOnline } = await setup();
        setOnline(false);
        const created = await api.createOrder({ tableId: 3 });
        const temp = (created as { entityTempId: string }).entityTempId;
        const calls = [
            () => api.deliverItems(temp, [1]),
            () => api.pricing(temp, { discount: 1, discountReason: 'abc' }),
            () => api.authorizeDiscount(temp, { supervisorUserId: 1, pin: '1234', discount: 1, discountReason: 'abc' }),
            () => api.transfer({ sourceTableId: 1, destinationTableId: 2, orderId: temp }),
            () => api.preinvoice(temp),
            () => api.splitEvenly(temp, 2),
            () => api.splitByItems(temp, []),
            () => api.splitByAmount(temp, []),
        ];
        for (const call of calls) await expect(call()).rejects.toBeInstanceOf(OrderNotSyncedError);
        expect(seen).toHaveLength(0);
    });

    it('after the create synced, every order-id call resolves a known temp id to the real id', async () => {
        const { api, queue, seen, reply, setOnline } = await setup();
        setOnline(false);
        const created = await api.createOrder({ tableId: 3 });
        const temp = (created as { entityTempId: string }).entityTempId;
        setOnline(true);
        reply(realIdFor(44));
        await queue.process();
        seen.length = 0;
        await api.addItem(temp, { menuItemId: 1, quantity: 1 });
        await api.pricing(temp, { discount: 1, discountReason: 'abc' });
        await api.createPayment({ orderId: temp, paymentMethodId: 1, amount: 5 });
        await api.preinvoice(temp);
        expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(['POST /orders/44/items', 'PATCH /orders/44/pricing', 'POST /payments', 'POST /invoices/44/preinvoice']);
        expect(seen[2].data).toMatchObject({ orderId: 44 });
    });
});
