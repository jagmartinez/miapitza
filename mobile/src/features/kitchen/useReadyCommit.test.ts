import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appEvents } from '../../core/events';
import { KitchenActionError } from './kitchenApi';
import type { KitchenBatch } from './kitchenTypes';
import { useReadyCommit } from './useReadyCommit';

let authStatus = 'online';
vi.mock('../../core/kitchenAuth', () => ({ kitchenAuthStatus: () => authStatus }));

const mk = (id: number, kitchenBatchId = 1): KitchenBatch => ({
    id, kitchenBatchId, status: 'IN_PREPARATION', table: { number: id }, user: { id: 1, name: 'Luis' },
    orderType: 'DINE_IN', createdAt: '2026-01-01T00:00:00Z', items: [],
});

function setup() {
    const calls: string[] = [];
    const api = {
        ready: vi.fn(async (b: KitchenBatch, _k: string) => { calls.push(`ready:${b.id}:${b.kitchenBatchId}`); }),
        release: vi.fn(async (b: KitchenBatch, _k: string) => { calls.push(`release:${b.id}:${b.kitchenBatchId}`); }),
    };
    const hook = renderHook(() => useReadyCommit(api as never));
    return { api, calls, hook };
}

describe('useReadyCommit', () => {
    beforeEach(() => { vi.useFakeTimers(); authStatus = 'online'; });
    afterEach(() => vi.useRealTimers());

    it('hides the card immediately and sends nothing before 5 s', async () => {
        const { api, hook } = setup();
        act(() => hook.result.current.markReady(mk(1)));
        expect(hook.result.current.hiddenKeys.has('1:1')).toBe(true);
        expect(hook.result.current.pending).toHaveLength(1);
        expect(hook.result.current.pending[0]).toMatchObject({ key: '1:1', label: 'M1', waiter: 'Luis' });
        await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
        expect(api.ready).not.toHaveBeenCalled();
    });

    it('undo within 5 s restores the card and sends nothing', async () => {
        const { api, hook } = setup();
        act(() => hook.result.current.markReady(mk(1)));
        act(() => hook.result.current.undo('1:1'));
        expect(hook.result.current.hiddenKeys.size).toBe(0);
        expect(hook.result.current.pending).toHaveLength(0);
        await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
        expect(api.ready).not.toHaveBeenCalled();
    });

    it('after 5 s sends ready then release in order with stable keys', async () => {
        const { api, calls, hook } = setup();
        act(() => hook.result.current.markReady(mk(1)));
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(calls).toEqual(['ready:1:1', 'release:1:1']);
        expect(api.ready.mock.calls[0][1]).not.toBe(api.release.mock.calls[0][1]);
        expect(hook.result.current.committed.map((b) => b.id)).toEqual([1]);
        expect(hook.result.current.pending).toHaveLength(0);
        expect(api.ready).toHaveBeenCalledTimes(1);
    });

    it('hides only the committed batch key', async () => {
        const { hook } = setup();
        act(() => hook.result.current.markReady(mk(1, 1)));
        expect([...hook.result.current.hiddenKeys]).toEqual(['1:1']);
        expect(hook.result.current.hiddenKeys.has('1:2')).toBe(false);
    });

    it('keeps a committed key hidden until the queue no longer contains it', async () => {
        const { hook } = setup();
        act(() => hook.result.current.markReady(mk(1)));
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(hook.result.current.hiddenKeys.has('1:1')).toBe(true);
        act(() => hook.result.current.syncQueue(new Set(['1:1'])));
        expect(hook.result.current.hiddenKeys.has('1:1')).toBe(true);
        act(() => hook.result.current.syncQueue(new Set()));
        expect(hook.result.current.hiddenKeys.has('1:1')).toBe(false);
    });

    it('retries after network error with the same keys', async () => {
        const { api, hook } = setup();
        api.ready.mockRejectedValueOnce(new KitchenActionError('network', 'x'));
        act(() => hook.result.current.markReady(mk(1)));
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(hook.result.current.hiddenKeys.has('1:1')).toBe(true);
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(api.ready).toHaveBeenCalledTimes(2);
        expect(api.ready.mock.calls[0][1]).toBe(api.ready.mock.calls[1][1]);
        expect(api.release).toHaveBeenCalledTimes(1);
        expect(hook.result.current.committed).toHaveLength(1);
    });

    it('treats already-released as success', async () => {
        const { api, hook } = setup();
        api.ready.mockRejectedValueOnce(new KitchenActionError('already-done', 'x'));
        api.release.mockRejectedValueOnce(new KitchenActionError('already-done', 'x'));
        act(() => hook.result.current.markReady(mk(1)));
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(api.release).toHaveBeenCalledTimes(1);
        expect(hook.result.current.committed).toHaveLength(1);
        expect(hook.result.current.failures).toHaveLength(0);
    });

    it('resumes pending commits after the session returns', async () => {
        const { api, hook } = setup();
        api.ready.mockRejectedValueOnce(new KitchenActionError('auth', 'x'));
        act(() => hook.result.current.markReady(mk(1)));
        authStatus = 'renewing';
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
        expect(api.ready).toHaveBeenCalledTimes(1);
        authStatus = 'online';
        await act(async () => { appEvents.emit('kitchen-auth-status', 'online'); await vi.advanceTimersByTimeAsync(0); });
        expect(api.ready).toHaveBeenCalledTimes(2);
        expect(api.ready.mock.calls[0][1]).toBe(api.ready.mock.calls[1][1]);
        expect(api.release).toHaveBeenCalledTimes(1);
        expect(hook.result.current.committed).toHaveLength(1);
    });

    it('rejected restores the card and reports a failure', async () => {
        const { api, hook } = setup();
        api.ready.mockRejectedValueOnce(new KitchenActionError('rejected', 'No se puede'));
        act(() => hook.result.current.markReady(mk(1)));
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(hook.result.current.hiddenKeys.has('1:1')).toBe(false);
        expect(hook.result.current.failures).toEqual([{ key: '1:1', message: 'No se puede' }]);
        expect(api.release).not.toHaveBeenCalled();
    });

    it('two cards marked 1 s apart commit independently', async () => {
        const { calls, hook } = setup();
        act(() => hook.result.current.markReady(mk(1)));
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        act(() => hook.result.current.markReady(mk(2)));
        await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
        expect(calls).toEqual(['ready:1:1', 'release:1:1']);
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(calls).toEqual(['ready:1:1', 'release:1:1', 'ready:2:1', 'release:2:1']);
    });

    it('committed keeps the last 10', async () => {
        const { hook } = setup();
        for (let i = 1; i <= 12; i++) act(() => hook.result.current.markReady(mk(i)));
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        const ids = hook.result.current.committed.map((b) => b.id);
        expect(ids).toHaveLength(10);
        expect(new Set(ids).size).toBe(10);
    });
});
