import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountHome } from './AccountHome';
import { AccountNavProvider, useAccountNav } from './AccountNav';
import { ToastProvider } from '../../ui/Toast';
import type { HrApi } from './hrApi';
import { session } from '../../test/helpers';
import type { Session } from '../../core/session';

const linked: Session = { ...session, user: { ...session.user, employeeId: 3, accountType: 'INTERNAL' } };
const admin: Session = { ...linked, user: { ...linked.user, role: { id: 2, name: 'ADMIN' }, roles: ['ADMIN'] } };

function hrWith(today: unknown, over: Record<string, unknown> = {}): HrApi {
    return {
        attendanceToday: vi.fn().mockResolvedValue(today),
        mySchedule: vi.fn().mockResolvedValue(null),
        myReceipts: vi.fn().mockResolvedValue([]),
        mySwaps: vi.fn().mockResolvedValue([]),
        myWorkforce: vi.fn().mockResolvedValue({
            leaveRequests: [],
            overtimeRequests: [],
            corrections: [],
            vacationBalances: [{ id: 1, available: 6, unit: 'DAYS', leaveType: { code: 'VAC', name: 'Vacaciones' } }],
        }),
        myLoans: vi.fn().mockResolvedValue([]),
        loanPolicy: vi.fn().mockResolvedValue({ currency: 'USD', maxAmount: '500', eligible: true }),
        myService: vi.fn().mockResolvedValue({ month: '2026-11', responses: 0, attentionAvg: null, nps: null, rank: null, rankedCount: 0 }),
        ...over,
    } as unknown as HrApi;
}

function Where() {
    const n = useAccountNav();
    return <span data-testid="where">{n.section}</span>;
}

function renderHome(s: Session, hr: HrApi) {
    return render(
        <ToastProvider>
            <AccountNavProvider>
                <AccountHome session={s} hr={hr} onLogout={() => {}} />
                <Where />
            </AccountNavProvider>
        </ToastProvider>,
    );
}

const today = { availableActions: ['CHECK_IN', 'CHECK_OUT'], blockingIssue: null, punches: [] };

describe('AccountHome', () => {
    it('shows the primary mark button from availableActions and opens punch', async () => {
        renderHome(linked, hrWith(today));
        const btn = await screen.findByRole('button', { name: 'Entrada' });
        fireEvent.click(btn);
        expect(screen.getByTestId('where')).toHaveTextContent('punch');
    });

    it('with the real server list [BREAK_START, CHECK_OUT] both actions are available and CHECK_OUT is secondary', async () => {
        renderHome(linked, hrWith({ ...today, availableActions: ['BREAK_START', 'CHECK_OUT'] }));
        const primary = await screen.findByRole('button', { name: 'Iniciar descanso' });
        const exit = screen.getByRole('button', { name: 'Salida' });
        expect(primary).toHaveClass('btn-primary');
        expect(exit).not.toHaveClass('btn-primary');
        fireEvent.click(exit);
        expect(screen.getByTestId('where')).toHaveTextContent('punch');
    });

    it('admin without an employee link still sees Por aprobar next to the unlinked message', () => {
        renderHome({ ...admin, user: { ...admin.user, employeeId: undefined } }, hrWith(today));
        expect(screen.getByText(/no está vinculado/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('Por aprobar'));
        expect(screen.getByTestId('where')).toHaveTextContent('approvals');
    });

    it('PENDING face enrollment replaces the mark button', async () => {
        renderHome(linked, hrWith(today, { biometricStatus: vi.fn().mockResolvedValue({ status: 'PENDING' }) }));
        expect(await screen.findByText('Registro facial pendiente de aprobación')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Entrada' })).toBeNull();
    });

    it('home hides Por aprobar for non-admin', async () => {
        renderHome(linked, hrWith(today));
        await screen.findByRole('button', { name: 'Entrada' });
        expect(screen.queryByText('Por aprobar')).toBeNull();
    });

    it('home shows Por aprobar for admin', async () => {
        renderHome(admin, hrWith(today));
        expect(await screen.findByText('Por aprobar')).toBeInTheDocument();
    });

    it('home without employeeId shows the unlinked message', () => {
        const hr = hrWith(today);
        renderHome(session, hr);
        expect(screen.getByText('Tu usuario no está vinculado a un empleado. Pide a RH que lo vincule.')).toBeInTheDocument();
        expect(screen.getByText('Mi información')).toBeInTheDocument();
        expect(screen.queryByText('Solicitar')).toBeNull();
        expect(hr.attendanceToday).not.toHaveBeenCalled();
    });

    it('stale open attendance shows Corregir marcaje', async () => {
        const stale = { availableActions: [], blockingIssue: { code: 'STALE_OPEN_ATTENDANCE', message: 'x' }, punches: [] };
        renderHome(linked, hrWith(stale));
        expect(await screen.findByText('Tienes una jornada abierta sin cerrar')).toBeInTheDocument();
        const buttons = screen.getAllByRole('button', { name: 'Corregir marcaje' });
        fireEvent.click(buttons[0]);
        expect(screen.getByTestId('where')).toHaveTextContent('correction');
    });

    it('request grid shows vacation days and loan maximum, or "No disponible"', async () => {
        const { unmount } = renderHome(linked, hrWith(today));
        expect(await screen.findByText(/6 días disponibles/)).toBeInTheDocument();
        expect(screen.getByText(/500/)).toBeInTheDocument();
        unmount();
        renderHome(linked, hrWith(today, { loanPolicy: vi.fn().mockResolvedValue({ currency: 'USD', maxAmount: '500', eligible: false }) }));
        expect(await screen.findByText('No disponible')).toBeInTheDocument();
    });

    it('an eligible employee with no cap sees "Disponible", not "No disponible"', async () => {
        renderHome(linked, hrWith(today, { loanPolicy: vi.fn().mockResolvedValue({ currency: 'USD', maxAmount: null, eligible: true }) }));
        expect(await screen.findByText('Disponible')).toBeInTheDocument();
    });

    it('cancel on a pending request calls the matching api once', async () => {
        const cancelOvertime = vi.fn().mockResolvedValue({});
        const hr = hrWith(today, {
            cancelOvertime,
            myWorkforce: vi.fn().mockResolvedValue({
                leaveRequests: [],
                corrections: [],
                vacationBalances: [],
                overtimeRequests: [{ id: 4, status: 'PENDING', date: '2026-11-10', requestedMinutes: 60, createdAt: '2026-11-11T00:00:00Z' }],
            }),
        });
        renderHome(linked, hr);
        fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
        const confirm = screen.getByRole('button', { name: 'Confirmar cancelación' });
        expect(confirm).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Ya no la necesito' } });
        fireEvent.click(confirm);
        fireEvent.click(confirm);
        await waitFor(() => expect(cancelOvertime).toHaveBeenCalledTimes(1));
        expect(cancelOvertime.mock.calls[0][0]).toBe(4);
        expect(cancelOvertime.mock.calls[0][1]).toBe('Ya no la necesito');
    });

    it('links navigate to sections', async () => {
        renderHome(linked, hrWith(today));
        await screen.findByRole('button', { name: 'Entrada' });
        fireEvent.click(screen.getByText('Mi nómina'));
        expect(screen.getByTestId('where')).toHaveTextContent('payroll');
    });

    it('employeeId without an INTERNAL account is unlinked', () => {
        renderHome({ ...linked, user: { ...linked.user, accountType: 'EXTERNAL' } }, hrWith(today));
        expect(screen.getByText(/no está vinculado/)).toBeInTheDocument();
    });

    it('attendanceToday failing shows a retry in the Marcar card, rest still renders', async () => {
        const attendanceToday = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(today);
        renderHome(linked, hrWith(today, { attendanceToday }));
        expect(await screen.findByText(/No se pudo cargar tu marcaje/)).toBeInTheDocument();
        expect(screen.getByText('Solicitar')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByRole('button', { name: 'Entrada' })).toBeInTheDocument();
    });

    it('myWorkforce failing shows an inline error but keeps the other parts', async () => {
        renderHome(linked, hrWith(today, { myWorkforce: vi.fn().mockRejectedValue(new Error('x')) }));
        expect(await screen.findByText(/No se pudo cargar tus permisos y horas extra/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Entrada' })).toBeInTheDocument();
    });
});
