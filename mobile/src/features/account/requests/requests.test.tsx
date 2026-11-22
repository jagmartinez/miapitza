import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatLocalDateInput } from '@web/utils/dateInput';
import { ToastProvider } from '../../../ui/Toast';
import { AccountNavProvider, useAccountNav, type SectionParams } from '../AccountNav';
import { AccountHome } from '../AccountHome';
import { HrError, createHrApi, type HrApi } from '../hrApi';
import { fakeApi, session } from '../../../test/helpers';
import type { Session } from '../../../core/session';
import { CorrectionForm } from './CorrectionForm';
import { LeaveForm } from './LeaveForm';
import { MyRequests } from './MyRequests';
import { OvertimeForm } from './OvertimeForm';
import { PendingForYou } from './PendingForYou';
import { SwapForm } from './SwapForm';

function Where() {
    const n = useAccountNav();
    return <span data-testid="where">{n.section}</span>;
}
function Go({ params }: { params?: SectionParams }) {
    const n = useAccountNav();
    return <button onClick={() => n.navigate('correction', params)}>go</button>;
}
function Params({ hr }: { hr: HrApi }) {
    const n = useAccountNav();
    return n.section === 'correction' ? <CorrectionForm hr={hr} /> : null;
}

function mount(ui: React.ReactNode) {
    return render(
        <ToastProvider>
            <AccountNavProvider>
                {ui}
                <Where />
            </AccountNavProvider>
        </ToastProvider>,
    );
}
const api = (o: Record<string, unknown>) => o as unknown as HrApi;
const summaryBase = { attendanceToday: vi.fn().mockResolvedValue({}), loanPolicy: vi.fn().mockResolvedValue(null), biometricStatus: vi.fn().mockResolvedValue(null), mySchedule: vi.fn().mockResolvedValue(null), myReceipts: vi.fn().mockResolvedValue([]) };

const types = [
    { id: 1, code: 'VAC', name: 'Vacaciones', paid: true, active: true, balanceTracked: true, unit: 'DAYS' },
    { id: 2, code: 'MED', name: 'Incapacidad médica', paid: true, active: true, balanceTracked: false, unit: 'DAYS', requiresAttachment: true },
    { id: 3, code: 'PER', name: 'Permiso personal', paid: false, active: true, balanceTracked: false, unit: 'DAYS' },
];
const workforce = { vacationBalances: [{ id: 1, leaveTypeId: 1, leaveType: { id: 1, code: 'VAC', name: 'Vacaciones' }, available: 6, unit: 'DAYS' }] };
const leaveApi = (createLeave: unknown) => api({ leaveTypes: vi.fn().mockResolvedValue(types), myWorkforce: vi.fn().mockResolvedValue(workforce), createLeave });

function fillLeave(typeId = '3') {
    fireEvent.change(screen.getByLabelText('Tipo de permiso'), { target: { value: typeId } });
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-12-02' } });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Trámite personal' } });
}

describe('LeaveForm', () => {
    it('leave hides requiresAttachment types and shows balance', async () => {
        mount(<LeaveForm hr={leaveApi(vi.fn())} />);
        const select = await screen.findByLabelText('Tipo de permiso');
        await waitFor(() => expect(within(select).getByText('Vacaciones')).toBeInTheDocument());
        expect(within(select).queryByText('Incapacidad médica')).toBeNull();
        expect(screen.queryByText(/Disponibles/)).toBeNull();
        fireEvent.change(select, { target: { value: '1' } });
        expect(await screen.findByText('Disponibles: 6 días')).toBeInTheDocument();
    });

    it('leave create then submit', async () => {
        const createLeave = vi.fn().mockResolvedValue({ id: 9 });
        mount(<LeaveForm hr={leaveApi(createLeave)} />);
        await screen.findByRole('option', { name: 'Permiso personal' });
        const send = screen.getByRole('button', { name: 'Enviar' });
        expect(send).toBeDisabled();
        fillLeave();
        expect(send).toBeEnabled();
        fireEvent.click(send);
        await waitFor(() => expect(createLeave).toHaveBeenCalledTimes(1));
        expect(createLeave.mock.calls[0][0]).toEqual({ leaveTypeId: 3, startDate: '2026-12-01', endDate: '2026-12-02', fraction: 'FULL_DAY', reason: 'Trámite personal' });
        expect(typeof createLeave.mock.calls[0][1].actionId).toBe('string');
    });

    it('double submit sends once', async () => {
        let release!: () => void;
        const createLeave = vi.fn(() => new Promise((r) => (release = () => r({ id: 1 }))));
        mount(<LeaveForm hr={leaveApi(createLeave)} />);
        await screen.findByRole('option', { name: 'Permiso personal' });
        fillLeave();
        const send = screen.getByRole('button', { name: 'Enviar' });
        fireEvent.click(send);
        fireEvent.click(send);
        expect(createLeave).toHaveBeenCalledTimes(1);
        expect(send).toBeDisabled();
        await act(async () => release());
    });

    it('ambiguous failure on leave retries with same key', async () => {
        const createLeave = vi
            .fn()
            .mockRejectedValueOnce(new HrError('Sin conexión', { isAmbiguous: true }))
            .mockResolvedValueOnce({ id: 2 });
        mount(<LeaveForm hr={leaveApi(createLeave)} />);
        await screen.findByRole('option', { name: 'Permiso personal' });
        fillLeave();
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await waitFor(() => expect(createLeave).toHaveBeenCalledTimes(2));
        expect(createLeave.mock.calls[1][1].actionId).toBe(createLeave.mock.calls[0][1].actionId);
        expect(createLeave.mock.calls[1][0]).toEqual(createLeave.mock.calls[0][0]);
    });

    it('server error shows inline in Spanish', async () => {
        const createLeave = vi.fn().mockRejectedValue(new HrError('Ya tienes un permiso en esas fechas', { code: 'HR_LEAVE_OVERLAP', isAmbiguous: false }));
        mount(<LeaveForm hr={leaveApi(createLeave)} />);
        await screen.findByRole('option', { name: 'Permiso personal' });
        fillLeave();
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Ya tienes un permiso en esas fechas');
    });
});

describe('LeaveForm fractions and checks', () => {
    async function open(createLeave: unknown = vi.fn().mockResolvedValue({ id: 1 })) {
        mount(<LeaveForm hr={leaveApi(createLeave)} />);
        await screen.findByRole('option', { name: 'Permiso personal' });
        fillLeave();
        return createLeave as ReturnType<typeof vi.fn>;
    }

    it('end date before start disables send', async () => {
        await open();
        fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-30' } });
        expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
        expect(screen.getByText('La fecha final no puede ser anterior a la inicial.')).toBeInTheDocument();
    });

    it('HALF_DAY body carries times and the server validates the length', async () => {
        const createLeave = await open();
        fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-12-01' } });
        fireEvent.change(screen.getByLabelText('Fracción'), { target: { value: 'HALF_DAY' } });
        fireEvent.change(screen.getByLabelText('Hora inicial'), { target: { value: '08:00' } });
        fireEvent.change(screen.getByLabelText('Hora final'), { target: { value: '11:00' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await waitFor(() => expect(createLeave).toHaveBeenCalledTimes(1));
        expect(createLeave.mock.calls[0][0]).toMatchObject({ fraction: 'HALF_DAY', startTime: '08:00', endTime: '11:00' });
    });

    it('HOURS body, single day only and end after start', async () => {
        const createLeave = await open();
        fireEvent.change(screen.getByLabelText('Fracción'), { target: { value: 'HOURS' } });
        fireEvent.change(screen.getByLabelText('Hora inicial'), { target: { value: '10:00' } });
        fireEvent.change(screen.getByLabelText('Hora final'), { target: { value: '12:00' } });
        const send = screen.getByRole('button', { name: 'Enviar' });
        expect(send).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-12-01' } });
        fireEvent.change(screen.getByLabelText('Hora final'), { target: { value: '09:00' } });
        expect(send).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Hora final'), { target: { value: '12:00' } });
        expect(send).toBeEnabled();
        fireEvent.click(send);
        await waitFor(() => expect(createLeave).toHaveBeenCalledTimes(1));
        expect(createLeave.mock.calls[0][0]).toEqual({ leaveTypeId: 3, startDate: '2026-12-01', endDate: '2026-12-01', fraction: 'HOURS', startTime: '10:00', endTime: '12:00', reason: 'Trámite personal' });
    });

    it('failed submit after the draft was created re-submits the same draft', async () => {
        let submits = 0;
        const { http, calls } = fakeApi((c) => {
            const url = c.url ?? '';
            if (url.endsWith('/leave/types')) return { data: { data: types } };
            if (url.includes('/me/workforce')) return { data: { data: workforce } };
            if (url.endsWith('/leave/requests')) return { status: 201, data: { data: { id: 77 } } };
            if (url.endsWith('/leave/requests/77/submit')) return ++submits === 1 ? { status: 503, data: { message: 'caido' } } : { data: { data: { id: 77 } } };
            return { status: 404 };
        });
        mount(<LeaveForm hr={createHrApi(http)} />);
        await screen.findByRole('option', { name: 'Permiso personal' });
        fillLeave();
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await screen.findByRole('alert');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await waitFor(() => expect(submits).toBe(2));
        expect(calls.filter((c) => (c.url ?? '').endsWith('/leave/requests') && c.method === 'post')).toHaveLength(1);
    });
});

describe('summary reload', () => {
    const linked: Session = { ...session, user: { ...session.user, employeeId: 3, accountType: 'INTERNAL' } };
    function Switch({ hr }: { hr: HrApi }) {
        const n = useAccountNav();
        return n.section === 'leave' ? <LeaveForm hr={hr} /> : <AccountHome session={linked} hr={hr} onLogout={() => {}} />;
    }
    const homeApi = (extra: Record<string, unknown> = {}) =>
        api({
            attendanceToday: vi.fn().mockResolvedValue({ availableActions: [], blockingIssue: null }),
            mySchedule: vi.fn().mockResolvedValue(null),
            myReceipts: vi.fn().mockResolvedValue([]),
            mySwaps: vi.fn().mockResolvedValue([]),
            myLoans: vi.fn().mockResolvedValue([]),
            loanPolicy: vi.fn().mockResolvedValue(null),
            leaveTypes: vi.fn().mockResolvedValue(types),
            myWorkforce: vi.fn().mockResolvedValue(workforce),
            ...extra,
        });

    it('home reloads its summary after a request is submitted', async () => {
        const hr = homeApi({ createLeave: vi.fn().mockResolvedValue({ id: 1 }) });
        const today = hr.attendanceToday as unknown as ReturnType<typeof vi.fn>;
        mount(<Switch hr={hr} />);
        await screen.findByText('Permiso');
        await waitFor(() => expect(today).toHaveBeenCalled());
        const before = today.mock.calls.length;
        fireEvent.click(screen.getByText('Permiso'));
        await screen.findByRole('option', { name: 'Permiso personal' });
        fillLeave();
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await waitFor(() => expect(today.mock.calls.length).toBeGreaterThan(before));
    });

    it('MyRequests reloads after a cancel', async () => {
        const myWorkforce = vi.fn().mockResolvedValue({ leaveRequests: [], corrections: [], vacationBalances: [], overtimeRequests: [{ id: 4, status: 'PENDING', date: '2026-11-10', requestedMinutes: 60, createdAt: '2026-11-11T00:00:00Z' }] });
        const hr = homeApi({ myWorkforce, cancelOvertime: vi.fn().mockResolvedValue({}) });
        mount(<MyRequests hr={hr} userId={7} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Cancelar solicitud' }));
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Ya no la necesito' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
        await waitFor(() => expect(myWorkforce).toHaveBeenCalledTimes(2));
    });
});

describe('OvertimeForm', () => {
    it('validates minutes 1-10080 and sends', async () => {
        const createOvertime = vi.fn().mockResolvedValue({ id: 1 });
        mount(<OvertimeForm hr={api({ createOvertime })} />);
        fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-11-10' } });
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Cierre tarde' } });
        const send = screen.getByRole('button', { name: 'Enviar' });
        fireEvent.change(screen.getByLabelText('Minutos'), { target: { value: '10081' } });
        expect(send).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Minutos'), { target: { value: '90' } });
        fireEvent.click(send);
        await waitFor(() => expect(createOvertime).toHaveBeenCalledTimes(1));
        expect(createOvertime.mock.calls[0][0]).toEqual({ date: '2026-11-10', requestedMinutes: 90, reason: 'Cierre tarde' });
    });
});

describe('CorrectionForm', () => {
    it('correction prefilled from stale attendance', async () => {
        const createCorrection = vi.fn().mockResolvedValue({ id: 1 });
        render(
            <ToastProvider>
                <AccountNavProvider>
                    <Go params={{ stale: true }} />
                    <Params hr={api({ createCorrection })} />
                </AccountNavProvider>
            </ToastProvider>,
        );
        fireEvent.click(screen.getByText('go'));
        expect(screen.getByLabelText('Tipo de corrección')).toHaveValue('ADD_PUNCH');
        expect(screen.getByLabelText('Acción del marcaje')).toHaveValue('CHECK_OUT');
        fireEvent.change(screen.getByLabelText('Fecha y hora'), { target: { value: '2026-11-09T22:00' } });
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Olvidé marcar salida' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await waitFor(() => expect(createCorrection).toHaveBeenCalledTimes(1));
        expect(createCorrection.mock.calls[0][0]).toEqual({ type: 'ADD_PUNCH', requestedAction: 'CHECK_OUT', requestedOccurredAt: '2026-11-09T22:00', reason: 'Olvidé marcar salida' });
        expect(createCorrection.mock.calls[0][0]).not.toHaveProperty('requestedTimezone');
    });
});

describe('CorrectionForm punch picker', () => {
    const todayPunches = {
        timezone: 'America/Managua',
        punches: [
            { id: 31, action: 'CHECK_IN', occurredAt: '2026-11-20T14:02:00.000Z' },
            { id: 32, action: 'CHECK_IN', occurredAt: '2026-11-20T14:05:00.000Z' },
        ],
    };
    function open(hr: HrApi) {
        render(
            <ToastProvider>
                <AccountNavProvider>
                    <Go />
                    <Params hr={hr} />
                </AccountNavProvider>
            </ToastProvider>,
        );
        fireEvent.click(screen.getByText('go'));
    }

    it('VOID_PUNCH picks one of my own recent punches by label (branch time) and sends its id', async () => {
        const createCorrection = vi.fn().mockResolvedValue({ id: 1 });
        open(api({ createCorrection, attendanceToday: vi.fn().mockResolvedValue(todayPunches) }));
        fireEvent.change(screen.getByLabelText('Tipo de corrección'), { target: { value: 'VOID_PUNCH' } });
        expect(screen.queryByLabelText('Número del marcaje afectado')).toBeNull();
        const picker = await screen.findByLabelText('Marcaje afectado');
        await waitFor(() => expect(within(picker).getByRole('option', { name: 'Entrada 20/11/2026 08:05' })).toBeInTheDocument());
        fireEvent.change(picker, { target: { value: '32' } });
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Marqué dos veces' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await waitFor(() => expect(createCorrection).toHaveBeenCalledTimes(1));
        expect(createCorrection.mock.calls[0][0]).toEqual({ type: 'VOID_PUNCH', targetEventId: 32, reason: 'Marqué dos veces' });
    });

    it('with no recent punches the target types cannot be sent and the user is told why', async () => {
        open(api({ createCorrection: vi.fn(), attendanceToday: vi.fn().mockResolvedValue({ timezone: 'America/Managua', punches: [] }) }));
        fireEvent.change(screen.getByLabelText('Tipo de corrección'), { target: { value: 'VOID_PUNCH' } });
        expect(await screen.findByText(/No hay marcajes recientes/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Marqué dos veces' } });
        expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    });
});

describe('SwapForm', () => {
    const tomorrow = formatLocalDateInput(new Date(Date.now() + 86_400_000));
    const mine = { id: 5, weekStart: '2026-11-16', status: 'PUBLISHED', shifts: [{ id: 50, userId: 7, branchId: 1, date: tomorrow, startTime: '08:00:00', endTime: '16:00:00' }] };
    const team = {
        schedules: [
            {
                id: 6,
                status: 'PUBLISHED',
                shifts: [
                    { id: 60, userId: 8, branchId: 1, date: tomorrow, startTime: '16:00:00', endTime: '23:00:00', user: { id: 8, name: 'Luis Mora' } },
                    { id: 50, userId: 7, branchId: 1, date: tomorrow, startTime: '08:00:00', endTime: '16:00:00', user: { id: 7, name: 'Ana' } },
                ],
            },
        ],
    };
    const base = () => ({ mySchedule: vi.fn().mockResolvedValue(mine), teamSchedule: vi.fn().mockResolvedValue(team) });

    async function fill() {
        const shift = await screen.findByLabelText('Mi turno');
        await waitFor(() => expect(within(shift).getAllByRole('option').length).toBeGreaterThan(1));
        fireEvent.change(shift, { target: { value: '50' } });
        const mate = await screen.findByLabelText('Compañero');
        await waitFor(() => expect(within(mate).getByText('Luis Mora')).toBeInTheDocument());
        expect(within(mate).queryByText('Ana')).toBeNull();
        fireEvent.change(mate, { target: { value: '8' } });
        fireEvent.change(screen.getByLabelText('Turno a recibir (opcional)'), { target: { value: '60' } });
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Cita médica' } });
    }

    it('swap sends the chosen shifts', async () => {
        const createSwap = vi.fn().mockResolvedValue({ id: 1 });
        mount(<SwapForm hr={api({ ...base(), createSwap })} userId={7} />);
        await fill();
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await waitFor(() => expect(createSwap).toHaveBeenCalledWith({ requesterShiftId: 50, targetUserId: 8, offeredShiftId: 60, reason: 'Cita médica' }));
    });

    it('swap ambiguous failure is not retried and shows check message', async () => {
        const createSwap = vi.fn().mockRejectedValue(new HrError('timeout', { isAmbiguous: true }));
        mount(<SwapForm hr={api({ ...base(), createSwap })} userId={7} />);
        await fill();
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo confirmar el envío; revisa Mis solicitudes antes de reintentar.');
        await new Promise((r) => setTimeout(r, 50));
        expect(createSwap).toHaveBeenCalledTimes(1);
        // locked until the user checks Mis solicitudes
        expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Ver Mis solicitudes' }));
        expect(screen.getByTestId('where')).toHaveTextContent('requests');
    });

    it('a definitive 409 from the server shows its real reason and does not lock the form', async () => {
        const createSwap = vi.fn().mockRejectedValue(new HrError('Ya existe una solicitud abierta para ese turno', { status: 409, isAmbiguous: true }));
        mount(<SwapForm hr={api({ ...base(), createSwap })} userId={7} />);
        await fill();
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una solicitud abierta para ese turno');
        expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled();
    });

    it('swap double tap sends once', async () => {
        let release!: () => void;
        const createSwap = vi.fn(() => new Promise((r) => (release = () => r({ id: 1 }))));
        mount(<SwapForm hr={api({ ...base(), createSwap })} userId={7} />);
        await fill();
        const send = screen.getByRole('button', { name: 'Enviar' });
        fireEvent.click(send);
        fireEvent.click(send);
        expect(createSwap).toHaveBeenCalledTimes(1);
        await act(async () => release());
    });

    it('does not offer shifts that already started', async () => {
        const started = { id: 51, userId: 7, branchId: 1, date: formatLocalDateInput(), startTime: '00:00:00', endTime: '00:01:00' };
        mount(<SwapForm hr={api({ ...base(), mySchedule: vi.fn().mockResolvedValue({ ...mine, shifts: [started, ...mine.shifts] }) })} userId={7} />);
        const shift = await screen.findByLabelText('Mi turno');
        await waitFor(() => expect(within(shift).getAllByRole('option').length).toBe(2));
        expect(within(shift).queryByRole('option', { name: /00:00/ })).toBeNull();
    });
});

describe('MyRequests', () => {
    it('cancel pending asks reason and calls cancel', async () => {
        const cancelOvertime = vi.fn().mockResolvedValue({});
        const hr = api({
            ...summaryBase,
            myWorkforce: vi.fn().mockResolvedValue({
                leaveRequests: [],
                corrections: [],
                vacationBalances: [],
                overtimeRequests: [
                    { id: 4, status: 'PENDING', date: '2026-11-10', requestedMinutes: 60, createdAt: '2026-11-11T00:00:00Z' },
                    { id: 3, status: 'APPROVED', date: '2026-11-01', requestedMinutes: 30, createdAt: '2026-11-02T00:00:00Z' },
                ],
            }),
            mySwaps: vi.fn().mockResolvedValue([]),
            myLoans: vi.fn().mockResolvedValue([]),
            cancelOvertime,
        });
        mount(<MyRequests hr={hr} userId={7} />);
        expect(await screen.findByText('Aprobada')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Cancelar solicitud' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar solicitud' }));
        const confirm = screen.getByRole('button', { name: 'Confirmar cancelación' });
        expect(confirm).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'ab' } });
        expect(confirm).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Ya no la necesito' } });
        fireEvent.click(confirm);
        fireEvent.click(confirm);
        await waitFor(() => expect(cancelOvertime).toHaveBeenCalledTimes(1));
        expect(cancelOvertime.mock.calls[0][0]).toBe(4);
        expect(cancelOvertime.mock.calls[0][1]).toBe('Ya no la necesito');
    });
});

describe('PendingForYou failures', () => {
    it('failed sources show an error with retry, never the empty message', async () => {
        const mySwaps = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue([]);
        const hr = api({
            attendanceToday: vi.fn().mockResolvedValue({}),
            loanPolicy: vi.fn().mockResolvedValue(null),
            mySchedule: vi.fn().mockResolvedValue(null),
            myReceipts: vi.fn().mockResolvedValue([]),
            myWorkforce: vi.fn().mockResolvedValue({}),
            myLoans: vi.fn().mockResolvedValue([]),
            mySwaps,
        });
        mount(<PendingForYou hr={hr} userId={7} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar tus cambios de turno');
        expect(screen.queryByText('No tienes nada pendiente.')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByText('No tienes nada pendiente.')).toBeInTheDocument();
    });
});

describe('PendingForYou', () => {
    it('respond swap accept', async () => {
        const respondSwap = vi.fn().mockResolvedValue({});
        const hr = api({
            ...summaryBase,
            myWorkforce: vi.fn().mockResolvedValue({}),
            myLoans: vi.fn().mockResolvedValue([]),
            mySwaps: vi.fn().mockResolvedValue([{ id: 12, status: 'PENDING', requestedById: 8, targetUserId: 7, requesterShiftId: 1, createdAt: '2026-11-10', requestedBy: { id: 8, name: 'Luis Mora' } }]),
            respondSwap,
        });
        mount(<PendingForYou hr={hr} userId={7} />);
        expect(await screen.findByText('Responde cambio de turno')).toBeInTheDocument();
        const accept = screen.getByRole('button', { name: 'Aceptar' });
        fireEvent.click(accept);
        fireEvent.click(accept);
        await waitFor(() => expect(respondSwap).toHaveBeenCalledTimes(1));
        expect(respondSwap).toHaveBeenCalledWith(12, 'ACCEPT');
    });

    it('the swap card shows which shift is asked, the offered one and the reason', async () => {
        const sh = (id: number, a: string, b: string) => ({ id, startAt: a, endAt: b, timezoneSnapshot: 'America/Managua', branch: { id: 1, name: 'Matriz' } });
        const hr = api({
            ...summaryBase,
            myWorkforce: vi.fn().mockResolvedValue({}),
            myLoans: vi.fn().mockResolvedValue([]),
            mySwaps: vi.fn().mockResolvedValue([
                {
                    id: 12, status: 'PENDING', requestedById: 8, targetUserId: 7, requesterShiftId: 1, createdAt: '2026-11-10', requestedBy: { id: 8, name: 'Luis Mora' }, reason: 'Cita médica',
                    requesterShift: sh(1, '2026-11-25T15:00:00.000Z', '2026-11-25T23:00:00.000Z'),
                    offeredShift: sh(2, '2026-11-26T15:00:00.000Z', '2026-11-26T23:00:00.000Z'),
                },
            ]),
        });
        mount(<PendingForYou hr={hr} userId={7} />);
        expect(await screen.findByText('Turno que te piden: 25/11/2026 09:00-17:00 · Matriz')).toBeInTheDocument();
        expect(screen.getByText('A cambio de: 26/11/2026 09:00-17:00 · Matriz')).toBeInTheDocument();
        expect(screen.getByText('Motivo: Cita médica')).toBeInTheDocument();
    });
});
