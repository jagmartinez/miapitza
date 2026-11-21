import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    it('summary builds pending items (unacknowledged schedule, new receipt, swap to answer)', async () => {
        localStorage.clear();
        const hr = api({
            mySchedule: vi.fn().mockResolvedValue({ id: 4, weekStart: '2026-11-16', acknowledgedAt: null, shifts: [] }),
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
});
