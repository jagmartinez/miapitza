import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

    it('keeps dependency ordering within the same owner partition', async () => {
        login(1, 10);
        await offlineManager.enqueueRequest({ url: '/orders', method: 'POST', data: {}, operationType: 'CREATE_ORDER', entityTempId: 'tmp-order' });
        await offlineManager.enqueueRequest({ url: '/orders/tmp/items', method: 'POST', data: {}, operationType: 'ADD_ORDER_ITEM', dependencyKey: 'tmp-order' });
        request.mockResolvedValue({});
        await offlineManager.processSyncQueue();
        expect(request.mock.calls.map((call) => call[0].url)).toEqual(['/orders', '/orders/tmp/items']);
    });

    it.each([401, 409])('marks HTTP %s as terminal without retry', async (status) => {
        login(1, 10);
        await offlineManager.enqueueRequest({ url: '/orders', method: 'POST', data: {}, operationType: 'CREATE_ORDER' });
        request.mockRejectedValue({ response: { status, data: { message: 'terminal' } } });
        await offlineManager.processSyncQueue();
        expect(request).toHaveBeenCalledTimes(1);
        expect((await offlineManager.getFailedItems())[0]?.retryCount).toBe(1);
    });

    it('keeps 429 retryable with the same idempotency key', async () => {
        login(1, 10);
        await offlineManager.enqueueRequest({ url: '/orders', method: 'POST', data: {}, operationType: 'CREATE_ORDER' });
        request.mockRejectedValueOnce({ response: { status: 429, data: { message: 'retry' } } });
        await offlineManager.processSyncQueue();
        const firstKey = request.mock.calls[0][0].headers['X-Idempotency-Key'];
        request.mockResolvedValueOnce({});
        await offlineManager.processSyncQueue();
        expect(request.mock.calls[1][0].headers['X-Idempotency-Key']).toBe(firstKey);
    }, 10_000);
});
