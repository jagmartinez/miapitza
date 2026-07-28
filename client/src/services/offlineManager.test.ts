import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('axios', () => ({
    default: {
        create: () => ({
            request,
            interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
        }),
    },
}));

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
});
Object.defineProperty(globalThis, 'sessionStorage', { value: { getItem: () => null } });
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, serviceWorker: null }, configurable: true });
Object.defineProperty(globalThis, 'window', { value: { addEventListener: vi.fn() }, configurable: true });

let offlineManager: typeof import('./offlineManager').offlineManager;
let db: typeof import('./db').db;

beforeAll(async () => {
    ({ offlineManager } = await import('./offlineManager'));
    ({ db } = await import('./db'));
    await db.open();
});

beforeEach(async () => {
    storage.clear();
    request.mockReset();
    await db.caches.clear();
    await db.syncQueue.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

function login(companyId: number, id: number) {
    storage.set('user', JSON.stringify({ companyId, id }));
    storage.set('token', `token-${companyId}-${id}`);
}

describe('offline ownership and single-flight', () => {
    it('isolates caches, preserves same-owner relogin, and purges explicitly', async () => {
        login(1, 10);
        await offlineManager.putCachedData('/orders', { tenant: 'A' });
        expect(await offlineManager.getCachedData('/orders')).toEqual({ tenant: 'A' });

        login(2, 20);
        expect(await offlineManager.getCachedData('/orders')).toBeNull();
        await offlineManager.putCachedData('/orders', { tenant: 'B' });

        login(1, 10);
        expect(await offlineManager.getCachedData('/orders')).toEqual({ tenant: 'A' });
        await offlineManager.purgeOwnerData('1:10');
        expect(await offlineManager.getCachedData('/orders')).toBeNull();
    });

    it('never exposes or synchronizes legacy unowned records', async () => {
        login(1, 10);
        await db.caches.put({ id: 'legacy', url: '/orders', ownerKey: '', data: 'legacy', timestamp: Date.now() });
        expect(await offlineManager.getCachedData('/orders')).toBeNull();
    });

    it('coalesces concurrent triggers into one HTTP request', async () => {
        login(1, 10);
        await offlineManager.enqueueRequest({ url: '/orders', method: 'POST', data: {}, operationType: 'CREATE_ORDER' });
        let release!: () => void;
        request.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));

        const first = offlineManager.processSyncQueue();
        const second = offlineManager.processSyncQueue();
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
        release();
        await Promise.all([first, second]);
        expect(request).toHaveBeenCalledTimes(1);
        expect(await offlineManager.getPendingCount()).toBe(0);
    });

    it('stops the captured owner batch when the authenticated identity changes', async () => {
        login(1, 10);
        await offlineManager.enqueueRequest({ url: '/orders/1', method: 'POST', data: {}, operationType: 'CREATE_ORDER' });
        await offlineManager.enqueueRequest({ url: '/orders/2', method: 'POST', data: {}, operationType: 'CREATE_ORDER' });
        request.mockImplementationOnce(async () => {
            login(2, 20);
        });

        await offlineManager.processSyncQueue();

        expect(request).toHaveBeenCalledTimes(1);
        login(1, 10);
        expect(await offlineManager.getPendingCount()).toBe(1);
    });

    it('stops the captured owner batch when the authentication token rotates', async () => {
        login(1, 10);
        await offlineManager.enqueueRequest({ url: '/orders/1', method: 'POST', data: {}, operationType: 'CREATE_ORDER' });
        await offlineManager.enqueueRequest({ url: '/orders/2', method: 'POST', data: {}, operationType: 'CREATE_ORDER' });
        request.mockImplementationOnce(async () => {
            storage.set('token', 'rotated-token');
        });

        await offlineManager.processSyncQueue();

        expect(request).toHaveBeenCalledTimes(1);
        expect(await offlineManager.getPendingCount()).toBe(1);
    });

    it('keeps dependency ordering within the same owner partition', async () => {
        login(1, 10);
        await offlineManager.enqueueRequest({ url: '/orders', method: 'POST', data: {}, operationType: 'CREATE_ORDER', entityTempId: 'tmp-order' });
        await offlineManager.enqueueRequest({ url: '/orders/tmp/items', method: 'POST', data: {}, operationType: 'ADD_ORDER_ITEM', dependencyKey: 'tmp-order' });
        request.mockResolvedValue({});
        await offlineManager.processSyncQueue();
        expect(request.mock.calls.map((call) => call[0].url)).toEqual(['/orders', '/orders/tmp/items']);
    });

    it('propagates a terminal parent failure and never sends its dependent request', async () => {
        login(1, 10);
        await offlineManager.enqueueRequest({
            url: '/orders/7/items',
            method: 'POST',
            data: {},
            operationType: 'ADD_ORDER_ITEM',
            entityTempId: 'order-7-kitchen-attempt',
        });
        await offlineManager.enqueueRequest({
            url: '/orders/7/send-to-kitchen',
            method: 'POST',
            data: {},
            operationType: 'SEND_TO_KITCHEN',
            dependencyKey: 'order-7-kitchen-attempt',
        });
        request.mockRejectedValueOnce({ response: { status: 409, data: { message: 'item rejected' } } });

        await offlineManager.processSyncQueue();

        expect(request).toHaveBeenCalledTimes(1);
        const failed = await offlineManager.getFailedItems();
        expect(failed).toHaveLength(2);
        expect(failed.find((item) => item.operationType === 'SEND_TO_KITCHEN')?.lastError)
            .toContain('Dependencia fallida');
    });

    it('counts pending records only for the authenticated owner', async () => {
        login(1, 10);
        await offlineManager.enqueueRequest({ url: '/orders/1', method: 'POST', data: {}, operationType: 'CREATE_ORDER' });
        login(2, 20);
        await offlineManager.enqueueRequest({ url: '/orders/2', method: 'POST', data: {}, operationType: 'CREATE_ORDER' });
        await offlineManager.enqueueRequest({ url: '/orders/3', method: 'POST', data: {}, operationType: 'CREATE_ORDER' });

        expect(await offlineManager.getPendingCount()).toBe(2);
        login(1, 10);
        expect(await offlineManager.getPendingCount()).toBe(1);
    });

    it.each([401, 409])('marks HTTP %s as terminal without retry', async (status) => {
        login(1, 10);
        await offlineManager.enqueueRequest({ url: '/orders', method: 'POST', data: {}, operationType: 'CREATE_ORDER' });
        request.mockRejectedValue({ response: { status, data: { message: 'terminal' } } });
        await offlineManager.processSyncQueue();
        expect(request).toHaveBeenCalledTimes(1);
        expect((await offlineManager.getFailedItems())[0]?.retryCount).toBe(1);
    });

    it('automatically retries 429 with backoff and the same idempotency key', async () => {
        login(1, 10);
        await offlineManager.enqueueRequest({ url: '/orders', method: 'POST', data: {}, operationType: 'CREATE_ORDER' });
        request
            .mockRejectedValueOnce({ response: { status: 429, data: { message: 'retry' } } })
            .mockResolvedValueOnce({});
        await offlineManager.processSyncQueue();
        const firstKey = request.mock.calls[0][0].headers['X-Idempotency-Key'];
        expect(request).toHaveBeenCalledTimes(1);

        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2), { timeout: 4000 });
        expect(request.mock.calls[1][0].headers['X-Idempotency-Key']).toBe(firstKey);
        expect(await offlineManager.getPendingCount()).toBe(0);
    }, 10_000);
});
