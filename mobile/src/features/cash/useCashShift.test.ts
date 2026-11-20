import { act, renderHook, waitFor } from '@testing-library/react';
import { createCashApi, type CashApi } from '../../data/cashApi';
import { makeEnv, sessionFor } from '../../data/testkit';
import type { ActiveShiftStatus } from '../../data/cashTypes';
import { useCashShift } from './useCashShift';

const open = (id: number): ActiveShiftStatus => ({
    hasActiveShift: true,
    shift: { id, cashRegisterId: 1, userId: 1, startDate: 'x', endDate: null, startAmount: 100 },
    requiresClose: false,
    message: null,
});

const fakeApi = (activeStatus: () => Promise<ActiveShiftStatus>) => ({ activeStatus }) as unknown as CashApi;

describe('useCashShift', () => {
    afterEach(() => vi.useRealTimers());

    it('loads the active shift, re-polls every 30 s and on focus', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const activeStatus = vi.fn(async () => open(5));
        const api = fakeApi(activeStatus);
        const { result } = renderHook(() => useCashShift(api, '1:1'));
        await waitFor(() => expect(result.current.status?.shift?.id).toBe(5));
        const base = activeStatus.mock.calls.length;
        await act(async () => {
            await vi.advanceTimersByTimeAsync(30_000);
        });
        expect(activeStatus.mock.calls.length).toBe(base + 1);
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });
        expect(activeStatus.mock.calls.length).toBe(base + 2);
    });

    it('user switch clears the active shift state', async () => {
        let release: (s: ActiveShiftStatus) => void = () => undefined;
        const calls: Array<(s: ActiveShiftStatus) => void> = [];
        const activeStatus = vi.fn(
            () =>
                new Promise<ActiveShiftStatus>((resolve) => {
                    calls.push(resolve);
                    release = resolve;
                }),
        );
        const api = fakeApi(activeStatus);
        const { result, rerender } = renderHook(({ owner }) => useCashShift(api, owner), { initialProps: { owner: '1:1' as string | null } });
        await waitFor(() => expect(calls).toHaveLength(1));
        await act(async () => calls[0](open(5)));
        expect(result.current.status?.shift?.id).toBe(5);

        // Another poll is in flight for user 1 when the tablet locks and user 2 logs in.
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });
        const staleCall = calls.length - 1;
        rerender({ owner: '1:2' });
        expect(result.current.status).toBeNull(); // cleared in the same render, before any new data
        await act(async () => calls[staleCall](open(5))); // user 1's late answer
        expect(result.current.status).toBeNull();
        void release;
        // User 2's own answer is accepted.
        await waitFor(() => expect(calls.length).toBeGreaterThan(staleCall + 1));
        await act(async () => calls[calls.length - 1](open(9)));
        expect(result.current.status?.shift?.id).toBe(9);
    });

    it('lock (no owner) clears and stops polling', async () => {
        const activeStatus = vi.fn(async () => open(5));
        const api = fakeApi(activeStatus);
        const { result, rerender } = renderHook(({ owner }) => useCashShift(api, owner), { initialProps: { owner: '1:1' as string | null } });
        await waitFor(() => expect(result.current.status).not.toBeNull());
        rerender({ owner: null });
        expect(result.current.status).toBeNull();
        const n = activeStatus.mock.calls.length;
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });
        expect(activeStatus.mock.calls.length).toBe(n);
    });

    it('a failed poll keeps the last state and exposes the error', async () => {
        let fail = false;
        const activeStatus = vi.fn(async () => {
            if (fail) throw new Error('boom');
            return open(5);
        });
        const api = fakeApi(activeStatus);
        const { result } = renderHook(() => useCashShift(api, '1:1'));
        await waitFor(() => expect(result.current.status?.shift?.id).toBe(5));
        fail = true;
        await act(async () => {
            await result.current.refresh();
        });
        expect(result.current.status?.shift?.id).toBe(5);
        expect(result.current.error).toBeInstanceOf(Error);
    });

    it('close retry after lost response resolves alreadyClosed and loads the report', async () => {
        const env = makeEnv();
        await env.sessions.save(sessionFor(1));
        const api = createCashApi({ http: env.http, sessions: env.sessions, isOnline: env.isOnline });
        let closeAttempts = 0;
        env.reply((req) => {
            if (req.url.endsWith('/close')) {
                closeAttempts += 1;
                return closeAttempts === 1 ? { network: true } : { status: 409, code: 'CASH_SHIFT_ALREADY_CLOSED', data: { closedByMe: true } };
            }
            if (req.url.endsWith('/report')) return { data: { success: true, data: { report: { title: 'REPORTE DE CIERRE DE CAJA', summary: 'ok', generatedAt: 'x' } } } };
            return { data: { success: true, data: { hasActiveShift: false, shift: null, requiresClose: false, message: null } } };
        });
        const { result } = renderHook(() => useCashShift(api, '1:1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const payload = { endAmount: 5, bills: [], coins: [] };
        await act(async () => {
            await expect(result.current.close(9, payload, { actionId: 'c1' })).rejects.toBeTruthy();
        });
        let done: Awaited<ReturnType<typeof result.current.close>> | undefined;
        await act(async () => {
            done = await result.current.close(9, payload, { actionId: 'c1' });
        });
        expect(done?.alreadyClosed).toBe(true);
        expect(done?.report?.report.title).toBe('REPORTE DE CIERRE DE CAJA');
        expect(env.seen.filter((s) => s.url.endsWith('/close')).map((s) => s.key)).toHaveLength(2);
        expect(new Set(env.seen.filter((s) => s.url.endsWith('/close')).map((s) => s.key)).size).toBe(1);
    });

    it('refreshes after each mutation', async () => {
        const env = makeEnv();
        await env.sessions.save(sessionFor(1));
        const api = createCashApi({ http: env.http, sessions: env.sessions, isOnline: env.isOnline });
        env.reply(() => ({ data: { success: true, data: {} } }));
        const { result } = renderHook(() => useCashShift(api, '1:1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const before = env.seen.filter((s) => s.url.endsWith('/active-status')).length;
        await act(async () => {
            await result.current.openShift({ cashRegisterId: 1, startAmount: 10 });
            await result.current.addMovement(1, { type: 'IN', amount: 5, description: 'x' });
        });
        expect(env.seen.filter((s) => s.url.endsWith('/active-status')).length).toBe(before + 2);
    });

    it('a mutation that settles after a user switch leaves the next user clean and not loading', async () => {
        let releaseOpen: () => void = () => undefined;
        const calls: Array<(s: ActiveShiftStatus) => void> = [];
        const api = {
            openShift: vi.fn(() => new Promise((resolve) => (releaseOpen = () => resolve({ id: 1 })))),
            activeStatus: vi.fn(() => new Promise<ActiveShiftStatus>((resolve) => calls.push(resolve))),
        } as unknown as CashApi;
        const { result, rerender } = renderHook(({ owner }) => useCashShift(api, owner), { initialProps: { owner: '1:1' as string | null } });
        await waitFor(() => expect(calls).toHaveLength(1));
        await act(async () => calls[0](open(5)));
        let mutation: Promise<unknown> = Promise.resolve();
        act(() => {
            mutation = result.current.openShift({ cashRegisterId: 1, startAmount: 1 });
        });
        rerender({ owner: '1:2' }); // lock + switch while A's mutation is in flight
        await waitFor(() => expect(calls).toHaveLength(2)); // B's own load
        await act(async () => {
            releaseOpen();
            await mutation;
        });
        expect(calls).toHaveLength(2); // A's continuation did not fetch under B
        expect(result.current.status).toBeNull();
        expect(result.current.loading).toBe(true); // B's load is still the only pending one
        await act(async () => calls[1](open(9)));
        expect(result.current.status?.shift?.id).toBe(9);
        expect(result.current.loading).toBe(false);
    });

    it('overlapping polls are not stacked', async () => {
        const calls: Array<(s: ActiveShiftStatus) => void> = [];
        const api = { activeStatus: vi.fn(() => new Promise<ActiveShiftStatus>((resolve) => calls.push(resolve))) } as unknown as CashApi;
        renderHook(() => useCashShift(api, '1:1'));
        await waitFor(() => expect(calls).toHaveLength(1));
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            window.dispatchEvent(new Event('focus'));
        });
        expect(calls).toHaveLength(1);
        await act(async () => calls[0](open(1)));
        await act(async () => {
            window.dispatchEvent(new Event('focus'));
        });
        expect(calls).toHaveLength(2);
    });
});
