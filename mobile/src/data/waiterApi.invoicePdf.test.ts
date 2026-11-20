import { createCache } from './cache';
import { createOfflineQueue } from './offlineQueue';
import { createWaiterApi } from './waiterApi';
import { makeEnv, sessionFor } from './testkit';
import { SessionChangedError } from './types';

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline });
    const api = createWaiterApi({ http: env.http, sessions: env.sessions, cache: createCache(env.db), queue, isOnline: env.isOnline });
    return { ...env, api };
}

describe('waiterApi.invoicePdf', () => {
    it('GETs /invoices/:orderId/pdf as a blob with the session token', async () => {
        const { api, seen, reply } = await setup();
        let responseType: unknown;
        reply((_req, config) => {
            responseType = config.responseType;
            return { data: new Blob(['%PDF'], { type: 'application/pdf' }) };
        });
        const blob = await api.invoicePdf(102);
        expect(blob).toBeInstanceOf(Blob);
        expect(seen[0]).toMatchObject({ method: 'GET', url: '/invoices/102/pdf', auth: 'Bearer jwt-1' });
        expect(responseType).toBe('blob');
    });

    it('needs a connection and a server order id', async () => {
        const { api, seen, setOnline } = await setup();
        setOnline(false);
        await expect(api.invoicePdf(102)).rejects.toThrow('Requiere conexión');
        expect(seen).toHaveLength(0);
        setOnline(true);
        await expect(api.invoicePdf('order-temp-1')).rejects.toBeTruthy(); // still only in the offline queue
    });

    it('a session change while it downloads refuses the answer', async () => {
        const { api, reply, sessions } = await setup();
        reply(async () => {
            await sessions.save(sessionFor(2));
            return { data: new Blob(['%PDF']) };
        });
        await expect(api.invoicePdf(102)).rejects.toBeInstanceOf(SessionChangedError);
    });
});
