import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { appEvents } from '../../core/events';
import { act } from '@testing-library/react';
import { useAccountSummary, markReceiptsSeen } from './useAccountSummary';
import type { HrApi } from './hrApi';

function api(over: Partial<Record<keyof HrApi, unknown>> = {}): HrApi {
    return {
        attendanceToday: vi.fn().mockResolvedValue({ availableActions: ['CHECK_IN'], blockingIssue: null, punches: [] }),
        mySchedule: vi.fn().mockResolvedValue(null),
        myReceipts: vi.fn().mockResolvedValue([]),
        mySwaps: vi.fn().mockResolvedValue([]),
        myWorkforce: vi.fn().mockResolvedValue({ leaveRequests: [], overtimeRequests: [], corrections: [], vacationBalances: [] }),
        myLoans: vi.fn().mockResolvedValue([]),
        loanPolicy: vi.fn().mockResolvedValue({ currency: 'USD', maxAmount: '500', eligible: true }),
        ...over,
    } as unknown as HrApi;
}

describe('useAccountSummary', () => {
    it('reloads when the same user logs in again over the kept tree', async () => {
        const attendanceToday = vi.fn().mockRejectedValueOnce(new Error('401')).mockResolvedValue({ availableActions: ['CHECK_IN'], blockingIssue: null, punches: [] });
        const hr = api({ attendanceToday, mySchedule: vi.fn().mockRejectedValue(new Error('401')) });
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.failed).toContain('today'));
        act(() => appEvents.emit('account-session-restored'));
        await waitFor(() => expect(result.current.today?.availableActions).toEqual(['CHECK_IN']));
    });

    it('summary builds pending items (unacknowledged schedule, new receipt, swap to answer)', async () => {
        localStorage.clear();
        const hr = api({
            mySchedule: vi.fn().mockResolvedValue({ id: 4, weekStart: '2026-11-16T00:00:00.000Z', acknowledgedAt: null, shifts: [{ id: 1 }] }),
            myReceipts: vi.fn().mockResolvedValue([{ id: 11, periodLabel: 'Nov Q1' }, { id: 12, periodLabel: 'Nov Q2' }]),
            mySwaps: vi.fn().mockResolvedValue([
                { id: 8, status: 'PENDING', requestedById: 2, targetUserId: 7, requestedBy: { id: 2, name: 'Luis' }, createdAt: 'x' },
                { id: 9, status: 'PENDING', requestedById: 7, targetUserId: 2, createdAt: 'x' },
            ]),
        });
        markReceiptsSeen(7, [12]);
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const titles = result.current.pendingForYou.map((p) => p.title);
        expect(titles).toContain('Confirma tu horario');
        expect(result.current.pendingForYou.find((p) => p.kind === 'schedule')?.detail).toBe('Semana del 16/11/2026');
        expect(titles.filter((t) => t === 'Recibo nuevo')).toHaveLength(1);
        expect(titles).toContain('Responde cambio de turno');
        expect(result.current.pendingForYou.find((p) => p.kind === 'swap')?.refId).toBe(8);
        expect(result.current.pendingForYou.find((p) => p.kind === 'receipt')?.refId).toBe(11);
    });

    it('myRequests lists cancellable pending requests of every kind', async () => {
        const hr = api({
            myWorkforce: vi.fn().mockResolvedValue({
                leaveRequests: [{ id: 1, status: 'PENDING', startDate: '2026-12-01', endDate: '2026-12-02', createdAt: '2026-11-01T00:00:00Z', leaveType: { name: 'Vacaciones' } }],
                overtimeRequests: [{ id: 2, status: 'APPROVED', date: '2026-11-10', requestedMinutes: 90, createdAt: '2026-11-11T00:00:00Z' }],
                corrections: [{ id: 3, status: 'REJECTED', type: 'ADD_PUNCH', createdAt: '2026-11-12T00:00:00Z' }],
                vacationBalances: [],
            }),
            myLoans: vi.fn().mockResolvedValue([{ id: 5, status: 'REQUESTED', requestedAmount: '100', currency: 'USD', requestedAt: '2026-11-13T00:00:00Z' }]),
            mySwaps: vi.fn().mockResolvedValue([{ id: 6, status: 'PENDING', requestedById: 7, targetUserId: 2, createdAt: '2026-11-14T00:00:00Z' }]),
        });
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const by = (k: string) => result.current.myRequests.find((r) => r.kind === k)!;
        expect(by('leave').cancellable).toBe(true);
        expect(by('overtime').cancellable).toBe(false);
        expect(by('correction').cancellable).toBe(false);
        expect(by('loan').cancellable).toBe(true);
        expect(by('swap').cancellable).toBe(true);
        expect(result.current.myRequests[0].kind).toBe('swap'); // newest first
    });

    it('a DRAFT leave left behind is shown as Borrador and can be cancelled', async () => {
        const hr = api({
            myWorkforce: vi.fn().mockResolvedValue({
                leaveRequests: [{ id: 1, status: 'DRAFT', startDate: '2026-12-01', endDate: '2026-12-02', createdAt: '2026-11-01T00:00:00Z', leaveType: { name: 'Vacaciones' } }],
                overtimeRequests: [], corrections: [], vacationBalances: [],
            }),
        });
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.myRequests[0]).toMatchObject({ statusLabel: 'Borrador', cancellable: true });
    });

    it('status is error only when everything failed', async () => {
        const boom = vi.fn().mockRejectedValue(new Error('x'));
        const hr = api({ attendanceToday: boom, mySchedule: boom, myReceipts: boom, mySwaps: boom, myWorkforce: boom, myLoans: boom, loanPolicy: boom });
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.status).toBe('error'));
    });

    it('does not fetch when disabled', async () => {
        const hr = api();
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7, enabled: false }));
        expect(result.current.status).toBe('idle');
        expect(hr.attendanceToday).not.toHaveBeenCalled();
    });

    it('first install seeds receipts as seen; later ones are new', async () => {
        localStorage.clear();
        const receipts = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
        const hr1 = api({ myReceipts: receipts });
        const first = renderHook(() => useAccountSummary(hr1, { userId: 7 }));
        await waitFor(() => expect(first.result.current.status).toBe('ready'));
        expect(first.result.current.pendingForYou).toHaveLength(0);
        first.unmount();
        const later = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3, periodLabel: 'P3' }]);
        const hr2 = api({ myReceipts: later });
        const second = renderHook(() => useAccountSummary(hr2, { userId: 7 }));
        await waitFor(() => expect(second.result.current.status).toBe('ready'));
        expect(second.result.current.pendingForYou.map((p) => p.refId)).toEqual([3]);
    });

    it('a published week with none of my shifts creates no "Confirma tu horario"', async () => {
        const hr = api({ mySchedule: vi.fn().mockResolvedValue({ id: 4, weekStart: '2026-11-16T00:00:00.000Z', acknowledgedAt: null, status: 'PUBLISHED', shifts: [] }) });
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.pendingForYou).toHaveLength(0);
    });

    it('the swap to answer carries the requester shift (in its own zone), the offered shift and the reason', async () => {
        const shift = (id: number, a: string, b: string) => ({ id, startAt: a, endAt: b, timezoneSnapshot: 'America/Managua', branch: { id: 1, name: 'Matriz' } });
        const hr = api({
            mySwaps: vi.fn().mockResolvedValue([
                {
                    id: 8, status: 'PENDING', requestedById: 2, targetUserId: 7, requestedBy: { id: 2, name: 'Luis' }, reason: 'Cita médica', createdAt: 'x',
                    requesterShift: shift(1, '2026-11-25T15:00:00.000Z', '2026-11-25T23:00:00.000Z'),
                    offeredShift: shift(2, '2026-11-26T15:00:00.000Z', '2026-11-26T23:00:00.000Z'),
                },
            ]),
        });
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const p = result.current.pendingForYou[0];
        expect(p.detail).toBe('De Luis · 25/11/2026 09:00-17:00 · Matriz');
        expect(p.lines).toEqual(['Turno que te piden: 25/11/2026 09:00-17:00 · Matriz', 'A cambio de: 26/11/2026 09:00-17:00 · Matriz', 'Motivo: Cita médica']);
    });

    it('request cards format overtime time, loan money and ISO dates', async () => {
        const hr = api({
            myWorkforce: vi.fn().mockResolvedValue({
                leaveRequests: [{ id: 1, status: 'PENDING', startDate: '2026-12-01T00:00:00.000Z', endDate: '2026-12-02T00:00:00.000Z', createdAt: '2026-11-01T00:00:00Z', leaveType: { name: 'Vacaciones' } }],
                overtimeRequests: [{ id: 2, status: 'APPROVED', date: '2026-11-10T00:00:00.000Z', requestedMinutes: 100, createdAt: '2026-11-11T00:00:00Z' }],
                corrections: [],
                vacationBalances: [],
            }),
            myLoans: vi.fn().mockResolvedValue([{ id: 5, status: 'REQUESTED', requestedAmount: '5000.00', currency: 'NIO', requestedAt: '2026-11-13T00:00:00Z' }]),
        });
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const by = (k: string) => result.current.myRequests.find((r) => r.kind === k)!;
        expect(by('overtime').detail).toBe('10/11/2026 · 1 h 40 min');
        expect(by('leave').detail).toBe('01/12/2026 al 02/12/2026');
        expect(by('loan').detail).toMatch(/5[.,\s]?000/);
        expect(by('loan').detail).not.toBe('NIO 5000.00');
    });

    it('unpublished week creates no pending item', async () => {
        const hr = api();
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.pendingForYou).toHaveLength(0);
    });

    it('reports failed parts and keeps the rest', async () => {
        const hr = api({ myWorkforce: vi.fn().mockRejectedValue(new Error('x')) });
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.failed).toEqual(['workforce']);
        expect(result.current.today).not.toBeNull();
    });

    it('account-user-changed clears the previous data immediately', async () => {
        const hr = api({ mySwaps: vi.fn().mockResolvedValue([{ id: 8, status: 'PENDING', requestedById: 2, targetUserId: 7, createdAt: 'x' }]) });
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.pendingForYou).toHaveLength(1));
        act(() => appEvents.emit('account-user-changed'));
        expect(result.current.today).toBeNull();
        expect(result.current.pendingForYou).toHaveLength(0);
    });

    it('myRequests shows loan requests, not active or paid loans', async () => {
        const hr = api({
            myLoans: vi.fn().mockResolvedValue([
                { id: 1, status: 'ACTIVE', requestedAmount: '1', currency: 'USD', requestedAt: 'a' },
                { id: 2, status: 'PAID', requestedAmount: '1', currency: 'USD', requestedAt: 'a' },
                { id: 3, status: 'REJECTED', requestedAmount: '1', currency: 'USD', requestedAt: 'a' },
            ]),
        });
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.myRequests.map((r) => r.refId)).toEqual([3]);
    });

    it('asks the server to skip the slow daily attendance summaries it does not use', async () => {
        const hr = api();
        const { result } = renderHook(() => useAccountSummary(hr, { userId: 7 }));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(hr.myWorkforce).toHaveBeenCalledWith(expect.objectContaining({ summaries: false }));
    });
});
