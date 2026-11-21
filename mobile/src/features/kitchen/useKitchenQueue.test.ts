import { act, renderHook } from '@testing-library/react';
import type { KitchenApi } from './kitchenApi';
import { useKitchenQueue } from './useKitchenQueue';
import type { KitchenBatch } from './kitchenTypes';

const line = (over: object = {}) => ({ id: 1, quantity: 1, sentAt: '2026-11-21T10:00:00.000Z', ...over });
const mk = (id: number, batchId: number, over: Partial<KitchenBatch> = {}): KitchenBatch => ({
    id,
    kitchenBatchId: batchId,
    status: 'SENT_TO_KITCHEN',
    orderType: 'DINE_IN',
    createdAt: '2026-11-21T09:00:00.000Z',
    items: [line()],
    ...over,
});

type Handler = (payload: unknown) => void;
function fakeRealtime() {
    const subs = new Map<string, Set<Handler>>();
    return {
        subscribe(type: string, fn: Handler) {
            if (!subs.has(type)) subs.set(type, new Set());
            subs.get(type)!.add(fn);
            return () => subs.get(type)!.delete(fn);
        },
        emit(type: string, payload?: unknown) {
            [...(subs.get(type) ?? [])].forEach((fn) => fn(payload));
        },
    };
}

function setup(queue: () => Promise<KitchenBatch[]>) {
    const api = {
        queue: vi.fn(queue),
        config: vi.fn(async () => ({ warningMinutes: 3, urgentMinutes: 10 })),
    } as unknown as KitchenApi;
    const rt = fakeRealtime();
    const hook = renderHook(() => useKitchenQueue(api, rt));
    return { api, rt, hook, queue: api.queue as unknown as ReturnType<typeof vi.fn> };
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('useKitchenQueue', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('loads, orders oldest received first and hides voided lines and empty batches', async () => {
        const newer = mk(1, 1, { items: [line({ sentAt: '2026-11-21T10:05:00.000Z' })] });
        const older = mk(2, 1, { items: [line({ sentAt: '2026-11-21T10:00:00.000Z' }), line({ id: 2, quantity: 0, voidedQuantity: 1 })] });
        const allVoided = mk(3, 1, { items: [line({ quantity: 0, voidedQuantity: 1 })] });
        const { hook } = setup(async () => [newer, older, allVoided]);
        await flush();
        expect(hook.result.current.status).toBe('ready');
        expect(hook.result.current.batches.map((b) => b.id)).toEqual([2, 1]);
        expect(hook.result.current.batches[0].items).toHaveLength(1);
        expect(hook.result.current.config).toEqual({ warningMinutes: 3, urgentMinutes: 10 });
    });

    it('debounces a burst of 5 events into one fetch within 250 ms', async () => {
        const { rt, queue } = setup(async () => [mk(1, 1)]);
        await flush();
        queue.mockClear();
        for (let i = 0; i < 5; i++) {
            rt.emit('ORDER_READY');
            await tick(50);
        }
        expect(queue).not.toHaveBeenCalled();
        await tick(250);
        expect(queue).toHaveBeenCalledTimes(1);
    });

    it('ignores ITEMS_CHANGED', async () => {
        const { rt, queue } = setup(async () => [mk(1, 1)]);
        await flush();
        queue.mockClear();
        rt.emit('ORDER_UPDATE', { status: 'ITEMS_CHANGED' });
        rt.emit('ORDER_UPDATE', { status: 'GUESTS_CHANGED' });
        await tick(500);
        expect(queue).not.toHaveBeenCalled();
        rt.emit('ORDER_UPDATE', { status: 'KITCHEN_READY' });
        await tick(300);
        expect(queue).toHaveBeenCalledTimes(1);
    });

    it('refetches on CONNECTED', async () => {
        const { rt, queue } = setup(async () => [mk(1, 1)]);
        await flush();
        queue.mockClear();
        rt.emit('CONNECTED');
        await tick(300);
        expect(queue).toHaveBeenCalledTimes(1);
    });

    it('drops a stale response', async () => {
        const resolvers: Array<(v: KitchenBatch[]) => void> = [];
        const { hook, rt } = setup(() => new Promise((r) => resolvers.push(r)));
        await flush();
        await act(async () => resolvers[0]([mk(1, 1)]));
        rt.emit('ORDER_READY');
        await tick(260); // request 2 in flight
        rt.emit('ORDER_READY');
        await tick(260); // request 3 in flight
        await act(async () => resolvers[2]([mk(3, 1)]));
        await act(async () => resolvers[1]([mk(2, 1)])); // late, stale
        expect(hook.result.current.batches.map((b) => b.id)).toEqual([3]);
    });

    it('keeps last data on error', async () => {
        let fail = false;
        const { hook, rt } = setup(async () => {
            if (fail) throw new Error('boom');
            return [mk(1, 1)];
        });
        await flush();
        fail = true;
        rt.emit('ORDER_READY');
        await tick(300);
        expect(hook.result.current.status).toBe('error');
        expect(hook.result.current.error).toBeTruthy();
        expect(hook.result.current.batches).toHaveLength(1);
    });

    it('reports new keys even when the count does not grow', async () => {
        let data = [mk(1, 1)];
        const { hook, rt } = setup(async () => data);
        const cb = vi.fn();
        await flush();
        act(() => {
            hook.result.current.onNewBatches(cb);
        });
        data = [mk(2, 1)];
        rt.emit('ORDER_SENT_TO_KITCHEN');
        await tick(300);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0].map((b: KitchenBatch) => b.id)).toEqual([2]);
    });

    it('reports the first batch after an empty queue', async () => {
        let data: KitchenBatch[] = [];
        const { hook, rt } = setup(async () => data);
        const cb = vi.fn();
        await flush();
        act(() => {
            hook.result.current.onNewBatches(cb);
        });
        data = [mk(1, 1)];
        rt.emit('ORDER_SENT_TO_KITCHEN');
        await tick(300);
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('does not report on the initial load', async () => {
        const cb = vi.fn();
        const api = { queue: vi.fn(async () => [mk(1, 1)]), config: vi.fn(async () => ({ warningMinutes: 3, urgentMinutes: 10 })) } as unknown as KitchenApi;
        const rt = fakeRealtime();
        const hook = renderHook(() => {
            const q = useKitchenQueue(api, rt);
            q.onNewBatches(cb);
            return q;
        });
        await flush();
        expect(hook.result.current.batches).toHaveLength(1);
        expect(cb).not.toHaveBeenCalled();
    });

    it('two batches of one order are two entries', async () => {
        const { hook } = setup(async () => [mk(5, 1), mk(5, 2)]);
        await flush();
        expect(hook.result.current.batches).toHaveLength(2);
    });

    it('a throwing new-batch listener does not fail the load nor skip other listeners', async () => {
        let data = [mk(1, 1)];
        const { hook, rt } = setup(async () => data);
        await flush();
        const bad = vi.fn(() => {
            throw new Error('x');
        });
        const good = vi.fn();
        act(() => {
            hook.result.current.onNewBatches(bad);
            hook.result.current.onNewBatches(good);
        });
        data = [mk(2, 1)];
        rt.emit('ORDER_SENT_TO_KITCHEN');
        await tick(300);
        expect(good).toHaveBeenCalledTimes(1);
        expect(hook.result.current.status).toBe('ready');
        expect(hook.result.current.batches.map((b) => b.id)).toEqual([2]);
    });

    it('uses Spanish error text for 403 and network failures', async () => {
        let err: unknown = { response: { status: 403 } };
        const { hook, rt } = setup(async () => {
            if (err) throw err;
            return [];
        });
        await flush();
        expect(hook.result.current.error).toBe('Sin permiso para ver la cocina');
        err = new Error('Network Error');
        rt.emit('ORDER_READY');
        await tick(300);
        expect(hook.result.current.error).toBe('Sin conexión con el servidor');
    });

    it('unmount unsubscribes realtime and clears timers', async () => {
        const { hook, rt, queue } = setup(async () => [mk(1, 1)]);
        await flush();
        queue.mockClear();
        rt.emit('ORDER_READY');
        hook.unmount();
        await tick(500);
        expect(queue).not.toHaveBeenCalled();
        rt.emit('ORDER_READY');
        await tick(500);
        expect(queue).not.toHaveBeenCalled();
    });

    it('queue refetches every 60 s', async () => {
        const { queue } = setup(async () => []);
        await flush();
        expect(queue).toHaveBeenCalledTimes(1);
        await tick(60_000);
        expect(queue).toHaveBeenCalledTimes(2);
        await tick(60_000);
        expect(queue).toHaveBeenCalledTimes(3);
    });

    it('safety refetch is skipped while a load is in flight', async () => {
        let release!: () => void;
        const { queue } = setup(() => new Promise<KitchenBatch[]>((r) => (release = () => r([]))));
        await flush();
        await tick(60_000);
        expect(queue).toHaveBeenCalledTimes(1);
        await act(async () => release());
    });

    it('no queue request before the first session', async () => {
        const api = { queue: vi.fn(async () => []), config: vi.fn(async () => ({ warningMinutes: 3, urgentMinutes: 10 })) } as unknown as KitchenApi;
        const rt = fakeRealtime();
        const hook = renderHook(({ enabled }) => useKitchenQueue(api, rt, { enabled }), { initialProps: { enabled: false } });
        await tick(70_000);
        expect(api.queue).not.toHaveBeenCalled();
        expect(hook.result.current.status).toBe('loading');
        hook.rerender({ enabled: true });
        await flush();
        expect(api.queue).toHaveBeenCalledTimes(1);
        expect(hook.result.current.status).toBe('ready');
    });
});
