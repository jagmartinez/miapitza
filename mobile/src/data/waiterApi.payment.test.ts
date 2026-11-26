import { createCache } from './cache';
import { createOfflineQueue } from './offlineQueue';
import { createWaiterApi } from './waiterApi';
import { makeEnv, sessionFor } from './testkit';

async function setup(online = true) {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: () => online });
    const api = createWaiterApi({ http: env.http, sessions: env.sessions, cache: createCache(env.db), queue, isOnline: () => online });
    return { env, api, queue };
}

describe('waiterApi.payLeg', () => {
    it('posts with the explicit idempotency key and returns the whole envelope (fiscal invoice included)', async () => {
        const { env, api } = await setup();
        env.reply(() => ({ status: 201, data: { success: true, data: { id: 9 }, fiscalInvoice: { invoiceNumber: 'F-1' }, fiscalInvoiceError: null } }));
        const res = await api.payLeg({ orderId: 5, paymentMethodId: 2, amount: 50, payerName: 'Ana' }, 'leg-key-1');
        expect(res).toMatchObject({ data: { id: 9 }, fiscalInvoice: { invoiceNumber: 'F-1' } });
        expect(env.seen).toHaveLength(1);
        expect(env.seen[0]).toMatchObject({ method: 'POST', url: '/payments', key: 'leg-key-1' });
        expect(env.seen[0].data).toMatchObject({ orderId: 5, paymentMethodId: 2, amount: 50, payerName: 'Ana' });
    });

    it('never queues: offline it fails and nothing is stored', async () => {
        const { env, api, queue } = await setup(false);
        env.reply(() => ({ network: true }));
        await expect(api.payLeg({ orderId: 5, paymentMethodId: 2, amount: 50 }, 'k')).rejects.toBeTruthy();
        expect(queue.getSnapshot().pending).toBe(0);
    });

    it('refuses an order that exists only in the offline queue', async () => {
        const { env, api } = await setup();
        await expect(api.payLeg({ orderId: 'order-123-abcd1234', paymentMethodId: 2, amount: 50 }, 'k')).rejects.toMatchObject({ name: 'OrderNotSyncedError' });
        expect(env.seen).toHaveLength(0);
    });
});

describe('waiterApi payment reads and fiscal customer', () => {
    it('reads the payment summary and the settings live', async () => {
        const { env, api } = await setup();
        env.reply(() => ({ data: { success: true, data: { remaining: 12.5 } } }));
        expect(await api.paymentSummary(5)).toEqual({ remaining: 12.5 });
        await api.settings();
        expect(env.seen.map((s) => `${s.method} ${s.url}`)).toEqual(['GET /payments/order/5/summary', 'GET /settings']);
    });

    it('patches the fiscal customer of a synced order', async () => {
        const { env, api } = await setup();
        env.reply(() => ({ data: { success: true, data: { id: 5 } } }));
        await api.updateFiscalCustomer(5, { customerName: 'Ana', customerTaxId: 'J1', customerTaxIdType: 'RUC' });
        expect(env.seen[0]).toMatchObject({ method: 'PATCH', url: '/orders/5/fiscal-customer' });
        await expect(api.updateFiscalCustomer('order-123-abcd1234', { customerName: 'x' })).rejects.toMatchObject({ name: 'OrderNotSyncedError' });
    });
});
