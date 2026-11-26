import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountHome } from './AccountHome';
import { AccountNavProvider } from './AccountNav';
import { ToastProvider } from '../../ui/Toast';
import type { HrApi } from './hrApi';
import { session } from '../../test/helpers';
import type { Session } from '../../core/session';

const waiter: Session = { ...session, user: { ...session.user, employeeId: 3, accountType: 'INTERNAL' } };
const admin: Session = { ...waiter, user: { ...waiter.user, role: { id: 2, name: 'ADMIN' }, roles: ['ADMIN'] } };

function hrWith(myService: unknown): HrApi {
    return {
        attendanceToday: vi.fn().mockResolvedValue({ availableActions: [], blockingIssue: null, punches: [] }),
        mySchedule: vi.fn().mockResolvedValue(null),
        myReceipts: vi.fn().mockResolvedValue([]),
        mySwaps: vi.fn().mockResolvedValue([]),
        myWorkforce: vi.fn().mockResolvedValue({ leaveRequests: [], overtimeRequests: [], corrections: [], vacationBalances: [] }),
        myLoans: vi.fn().mockResolvedValue([]),
        loanPolicy: vi.fn().mockResolvedValue({ currency: 'USD', maxAmount: '500', eligible: true }),
        myService,
    } as unknown as HrApi;
}

const renderHome = (s: Session, hr: HrApi) =>
    render(
        <ToastProvider>
            <AccountNavProvider>
                <AccountHome session={s} hr={hr} onLogout={() => {}} />
            </AccountNavProvider>
        </ToastProvider>,
    );

const score = { month: '2026-11', responses: 12, attentionAvg: 4.6, nps: 72, rank: 2, rankedCount: 9 };

describe('Mi servicio card', () => {
    it('waiter sees Mi servicio with attention avg and NPS of the month', async () => {
        renderHome(waiter, hrWith(vi.fn().mockResolvedValue(score)));
        expect(await screen.findByText('Atención 4.6 · NPS 72')).toBeInTheDocument();
        expect(screen.getByText('Puesto 2 de 9')).toBeInTheDocument();
    });

    it('omits the position when not ranked', async () => {
        renderHome(waiter, hrWith(vi.fn().mockResolvedValue({ ...score, rank: null })));
        expect(await screen.findByText('Atención 4.6 · NPS 72')).toBeInTheDocument();
        expect(screen.queryByText(/Puesto/)).toBeNull();
    });

    it('below 3 responses shows Aún no hay suficientes opiniones este mes', async () => {
        renderHome(waiter, hrWith(vi.fn().mockResolvedValue({ month: '2026-11', responses: 2, attentionAvg: null, nps: null, rank: null, rankedCount: 0 })));
        expect(await screen.findByText('Aún no hay suficientes opiniones este mes')).toBeInTheDocument();
    });

    it('non-waiter does not see the card and does not call the endpoint', async () => {
        const myService = vi.fn();
        renderHome(admin, hrWith(myService));
        await screen.findByText('Mi horario');
        expect(screen.queryByText('Mi servicio')).toBeNull();
        expect(myService).not.toHaveBeenCalled();
    });

    it('load error shows inline retry without breaking the home', async () => {
        const myService = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(score);
        renderHome(waiter, hrWith(myService));
        expect(await screen.findByText(/No se pudo cargar tu servicio/)).toBeInTheDocument();
        expect(screen.getByText('Mi horario')).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole('button', { name: 'Reintentar' }).pop()!);
        await waitFor(() => expect(screen.getByText('Atención 4.6 · NPS 72')).toBeInTheDocument());
    });
});
