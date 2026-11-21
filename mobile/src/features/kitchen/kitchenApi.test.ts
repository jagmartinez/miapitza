import type { AxiosInstance } from 'axios';
import { createKitchenApi } from './kitchenApi';

const batch = { id: 7, kitchenBatchId: 3 };
const httpWith = (post: unknown, get: unknown = vi.fn()) => ({ post, get }) as unknown as AxiosInstance;
const fail = (status: number | undefined, data?: object) => Object.assign(new Error('x'), status ? { response: { status, data } } : {});

describe('kitchenApi', () => {
    it('sends kitchenBatchId and idempotency header', async () => {
        const post = vi.fn(async () => ({ data: { success: true, data: {} } }));
        await createKitchenApi(httpWith(post)).ready(batch, 'k-1');
        expect(post).toHaveBeenCalledWith('/orders/7/kitchen/ready', { kitchenBatchId: 3 }, { headers: { 'X-Idempotency-Key': 'k-1' } });
    });

    it('maps KITCHEN_BATCH_RELEASED to already-done', async () => {
        const post = vi.fn(async () => {
            throw fail(409, { code: 'KITCHEN_BATCH_RELEASED', message: 'ya liberada' });
        });
        await expect(createKitchenApi(httpWith(post)).release(batch, 'k')).rejects.toMatchObject({ kind: 'already-done', code: 'KITCHEN_BATCH_RELEASED' });
        await expect(createKitchenApi(httpWith(post)).start(batch, 'k')).rejects.toMatchObject({ kind: 'rejected' });
    });

    it('a 200 with the real {success,data} body (order in data) resolves', async () => {
        const post = vi.fn(async () => ({ data: { success: true, message: 'x', data: { id: 1 } } }));
        await expect(createKitchenApi(httpWith(post)).start(batch, 'k')).resolves.toBeUndefined();
    });

    it('maps 401 to auth, timeout/5xx to network, other 4xx to rejected', async () => {
        const run = (e: unknown) =>
            createKitchenApi(
                httpWith(
                    vi.fn(async () => {
                        throw e;
                    }),
                ),
            ).ready(batch, 'k');
        await expect(run(fail(401))).rejects.toMatchObject({ kind: 'auth' });
        await expect(run(fail(undefined))).rejects.toMatchObject({ kind: 'network' });
        await expect(run(fail(503))).rejects.toMatchObject({ kind: 'network' });
        await expect(run(fail(409, { code: 'KITCHEN_BATCH_NOT_READY', message: 'm' }))).rejects.toMatchObject({
            kind: 'rejected',
            code: 'KITCHEN_BATCH_NOT_READY',
        });
    });

    it('maps IDEMPOTENCY_IN_PROGRESS to retryable network', async () => {
        const post = vi.fn(async () => {
            throw fail(409, { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'en curso' });
        });
        await expect(createKitchenApi(httpWith(post)).ready(batch, 'k')).rejects.toMatchObject({ kind: 'network' });
    });

    it('reads config, queue and recent', async () => {
        const get = vi.fn(async (url: string) => ({
            data: { data: url.endsWith('config') ? { warningMinutes: 3, urgentMinutes: 10, clockStartsAt: 'x' } : [{ id: 1 }] },
        }));
        const api = createKitchenApi(httpWith(vi.fn(), get));
        expect(await api.config()).toEqual({ warningMinutes: 3, urgentMinutes: 10 });
        expect(await api.queue()).toHaveLength(1);
        await api.recent();
        expect(get).toHaveBeenLastCalledWith('/orders/kitchen/recent', { params: { limit: 10 } });
    });
});
