import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../ui/Toast';
import { AccountNavProvider } from '../AccountNav';
import AccountApp from '../AccountApp';
import { HrError, type HrApi } from '../hrApi';
import { fakeApi, session } from '../../../test/helpers';
import type { Services } from '../../../core/services';
import { ApprovalsScreen } from './ApprovalsScreen';

const leave = { id: 1, userId: 9, user: { id: 9, name: 'Luis Gómez' }, leaveType: { name: 'Permiso personal' }, startDate: '2026-12-01', endDate: '2026-12-02', fraction: 'FULL_DAY', reason: 'Trámite', status: 'PENDING' };
const ot = { id: 2, userId: 9, user: { id: 9, name: 'Luis Gómez' }, date: '2026-11-18', requestedMinutes: 90, reason: 'Cierre tarde', status: 'PENDING' };
const corr = { id: 3, userId: 10, user: null, type: 'ADD_PUNCH', requestedAction: 'CHECK_OUT', requestedOccurredAt: '2026-11-19T04:00:00.000Z', requestedTimezone: 'America/Managua', reason: 'Olvidé marcar', status: 'PENDING' };
const swap = { id: 4, status: 'ACCEPTED', requestedBy: { id: 9, name: 'Luis Gómez' }, targetUser: { id: 11, name: 'Rosa Díaz' }, requesterShift: { id: 50, startAt: '2026-11-25T15:00:00.000Z', endAt: '2026-11-25T23:00:00.000Z', timezoneSnapshot: 'America/Guatemala', branch: { id: 1, name: 'Centro' } }, reason: 'Cita' };

function makeHr(over: Record<string, unknown> = {}) {
    return {
        pendingLeave: vi.fn().mockResolvedValue([leave]),
        pendingOvertime: vi.fn().mockResolvedValue([ot]),
        pendingCorrections: vi.fn().mockResolvedValue([corr]),
        pendingSwaps: vi.fn().mockResolvedValue([swap]),
        decideLeave: vi.fn().mockResolvedValue({}),
        decideOvertime: vi.fn().mockResolvedValue({}),
        decideCorrection: vi.fn().mockResolvedValue({}),
        approveSwap: vi.fn().mockResolvedValue({}),
        rejectSwap: vi.fn().mockResolvedValue({}),
        ...over,
    } as unknown as HrApi & Record<string, ReturnType<typeof vi.fn>>;
}
function mount(hr: HrApi) {
    return render(
        <ToastProvider>
            <AccountNavProvider>
                <ApprovalsScreen hr={hr} />
            </AccountNavProvider>
        </ToastProvider>,
    );
}

describe('ApprovalsScreen', () => {
    it('hidden for non-admin even with approve permission', async () => {
        const { http, calls } = fakeApi(() => ({ data: { data: [] } }));
        const user = { ...session.user, accountType: 'INTERNAL', employeeId: 3, permissions: ['hr.workforce.approve', 'hr.schedule.publish'] };
        render(<AccountApp session={{ ...session, user }} services={{ http } as unknown as Services} onLogout={vi.fn()} />);
        await screen.findByText('Solicitar');
        expect(screen.queryByText('Por aprobar')).toBeNull();
        expect(calls.some((c) => String(c.url).includes('/swaps') && !String(c.url).includes('/me/'))).toBe(false);
    });

    it('approve leave sends decision with key', async () => {
        const hr = makeHr();
        mount(hr);
        expect(await screen.findByText('Luis Gómez')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
        await waitFor(() => expect(hr.decideLeave).toHaveBeenCalledWith(1, 'APPROVED', 'Aprobado', expect.objectContaining({ actionId: expect.any(String) })));
    });

    it('reject requires reason', async () => {
        const hr = makeHr();
        mount(hr);
        await screen.findByText('Luis Gómez');
        fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
        const dialog = screen.getByRole('dialog');
        const confirm = within(dialog).getByRole('button', { name: 'Confirmar rechazo' });
        expect(confirm).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText('Motivo'), { target: { value: 'ab' } });
        expect(confirm).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText('Motivo'), { target: { value: 'Sin cupo' } });
        fireEvent.click(confirm);
        await waitFor(() => expect(hr.decideLeave).toHaveBeenCalledWith(1, 'REJECTED', 'Sin cupo', expect.anything()));
    });

    it('overtime approve caps minutes', async () => {
        const hr = makeHr();
        mount(hr);
        await screen.findByText('Luis Gómez');
        fireEvent.click(screen.getByRole('tab', { name: /^Horas extra/ }));
        const input = screen.getByLabelText('Minutos aprobados');
        expect(input).toHaveValue(90);
        fireEvent.change(input, { target: { value: '120' } });
        expect(screen.getByRole('button', { name: 'Aprobar' })).toBeDisabled();
        fireEvent.change(input, { target: { value: '60' } });
        fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
        await waitFor(() => expect(hr.decideOvertime).toHaveBeenCalledWith(2, 'APPROVED', 60, 'Aprobado', expect.anything()));
    });

    it('self approval error message', async () => {
        const hr = makeHr({ decideLeave: vi.fn().mockRejectedValue(new HrError('x', { code: 'HR_SELF_APPROVAL_FORBIDDEN', status: 409, isAmbiguous: true })) });
        mount(hr);
        await screen.findByText('Luis Gómez');
        fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
        expect(await screen.findByText('No puedes aprobar tu propia solicitud')).toBeInTheDocument();
        expect(screen.getByText('Luis Gómez')).toBeInTheDocument();
    });

    it('decided card leaves list', async () => {
        const hr = makeHr();
        mount(hr);
        await screen.findByText('Luis Gómez');
        fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
        await waitFor(() => expect(screen.queryByText('Luis Gómez')).toBeNull());
        expect(screen.getByText('Sin solicitudes pendientes')).toBeInTheDocument();
    });

    it('falls back to Empleado #id and approves swaps', async () => {
        const hr = makeHr();
        mount(hr);
        await screen.findByText('Luis Gómez');
        fireEvent.click(screen.getByRole('tab', { name: /^Correcciones/ }));
        expect(screen.getByText('Empleado #10')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: /^Cambios de turno/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
        await waitFor(() => expect(hr.approveSwap).toHaveBeenCalledWith(4, ''));
    });

    it('correction card shows the requested time in the correction timezone, not UTC', async () => {
        mount(makeHr());
        await screen.findByText('Luis Gómez');
        fireEvent.click(screen.getByRole('tab', { name: /^Correcciones/ }));
        expect(screen.getByText(/salida · 18\/11\/2026 22:00/)).toBeInTheDocument();
    });

    it('shows a retry when a list fails to load', async () => {
        const hr = makeHr({ pendingLeave: vi.fn().mockRejectedValue(new Error('x')) });
        mount(hr);
        expect(await screen.findByText(/No se pudo cargar/)).toBeInTheDocument();
    });
    it('swap card shows the shift date and time in its own timezone', async () => {
        mount(makeHr());
        await screen.findByText('Luis Gómez');
        fireEvent.click(screen.getByRole('tab', { name: /^Cambios de turno/ }));
        expect(screen.getByText(/25\/11\/2026 09:00-17:00/)).toBeInTheDocument();
        expect(screen.getByText(/Centro/)).toBeInTheDocument();
    });

    it('swap reject has no reason field and calls rejectSwap', async () => {
        const hr = makeHr();
        mount(hr);
        await screen.findByText('Luis Gómez');
        fireEvent.click(screen.getByRole('tab', { name: /^Cambios de turno/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByLabelText('Motivo')).toBeNull();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar rechazo' }));
        await waitFor(() => expect(hr.rejectSwap).toHaveBeenCalledWith(4));
    });

    it('overtime reject sends the reason without minutes', async () => {
        const hr = makeHr();
        mount(hr);
        await screen.findByText('Luis Gómez');
        fireEvent.click(screen.getByRole('tab', { name: /^Horas extra/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'No procede' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar rechazo' }));
        await waitFor(() => expect(hr.decideOvertime).toHaveBeenCalledWith(2, 'REJECTED', undefined, 'No procede', expect.anything()));
    });

    it('keeps the typed reason when the reject fails', async () => {
        const hr = makeHr({ decideLeave: vi.fn().mockRejectedValue(new HrError('Sin red', { status: 503, isAmbiguous: true })) });
        mount(hr);
        await screen.findByText('Luis Gómez');
        fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Sin cupo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar rechazo' }));
        const dialog = await screen.findByRole('dialog');
        expect(await within(dialog).findByText('Sin red')).toBeInTheDocument();
        expect(within(dialog).getByLabelText('Motivo')).toHaveValue('Sin cupo');
    });

    it('reloads the tab after a 409 already-decided', async () => {
        const decideLeave = vi.fn().mockRejectedValue(new HrError('Ya fue decidida', { code: 'HR_WORKFLOW_CAS_CONFLICT', status: 409, isAmbiguous: true }));
        const pendingLeave = vi.fn().mockResolvedValueOnce([leave]).mockResolvedValue([]);
        mount(makeHr({ decideLeave, pendingLeave }));
        await screen.findByText('Luis Gómez');
        fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
        await waitFor(() => expect(screen.queryByText('Luis Gómez')).toBeNull());
        expect(pendingLeave).toHaveBeenCalledTimes(2);
    });
});
