import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CashError } from '../../data/cashApi';
import { IdleLockBoundary } from '../../core/IdleLockBoundary';
import { cashSession, FULL, makeCash, REGISTERS } from './testkit';
import { CashHome } from './CashHome';
import { CountCloseScreen } from './CountCloseScreen';
import { localDayBoundsIso } from './dayBounds';
import { MovementSheet } from './MovementSheet';
import { OpenShiftsScreen } from './OpenShiftsScreen';
import { ShiftHistoryScreen } from './ShiftHistoryScreen';
import { closeTicket } from '../print/closeTicket';
import { reportOf } from '../print/reportFixture';
import { PaymentDone } from '../waiter/payment/PaymentDone';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const axiosErr = (status?: number, message = 'Request failed') =>
    Object.assign(new Error(status ? message : 'Network Error'), { isAxiosError: true, config: {}, ...(status ? { response: { status, data: {} } } : { code: 'ERR_NETWORK' }) });
const preview = { countedAmount: 200, status: 'CUADRADO', withinTolerance: true, requiresNote: false, exceedsTolerance: false, tolerance: 1 };

function countApi(over: Record<string, unknown> = {}) {
    return makeCash({ summary: vi.fn().mockResolvedValue(FULL), previewClose: vi.fn().mockResolvedValue(preview), close: vi.fn().mockResolvedValue({ alreadyClosed: false, shift: {} }), ...over });
}
function mountCount(over: { role?: 'CAJERO' | 'ADMIN'; mode?: 'close' | 'partial'; api?: ReturnType<typeof countApi>; onBack?: () => void; onCloseAttempt?: (id: number) => void } = {}) {
    const api = over.api ?? countApi();
    const onBack = over.onBack ?? vi.fn();
    render(<CountCloseScreen api={api} session={cashSession(over.role ?? 'CAJERO')} shiftId={42} mode={over.mode ?? 'close'} onBack={onBack} onClosed={vi.fn()} onCloseAttempt={over.onCloseAttempt} />);
    return { api, onBack };
}
const ready = () => waitFor(() => expect(screen.getByLabelText('Tipo de cambio')).toHaveValue('36.5'));
const enter = (denom: string, digits: string) => {
    click(denom);
    for (const k of digits) click(k);
};
const validar = async () => {
    click('Validar');
    await screen.findByTestId('count-result');
};

describe('W4 history date bounds', () => {
    it('converts the local day to UTC instants (UTC-6: 18:30 local is still today)', () => {
        const b = localDayBoundsIso(new Date(2026, 10, 20, 12), 360);
        expect(b).toEqual({ start: '2026-11-20T06:00:00.000Z', end: '2026-11-21T05:59:59.999Z' });
        // a shift opened 18:30 local = 00:30Z of the 21st is inside
        expect(Date.parse('2026-11-21T00:30:00.000Z')).toBeLessThanOrEqual(Date.parse(b.end));
    });
    it('the screen sends those instants', async () => {
        const api = makeCash({ history: vi.fn().mockResolvedValue([]) });
        render(<ShiftHistoryScreen api={api} onOpen={vi.fn()} onBack={vi.fn()} now={() => new Date(2026, 10, 20, 23, 0)} tzOffset={360} />);
        await waitFor(() => expect(api.history).toHaveBeenCalledWith({ from: '2026-10-21T06:00:00.000Z', to: '2026-11-21T05:59:59.999Z' }));
    });
});

describe('W6 no leaving during a close', () => {
    it('← is disabled while the close is pending and a close attempt is announced', async () => {
        const api = countApi({ close: vi.fn(() => new Promise(() => undefined)) });
        const onCloseAttempt = vi.fn();
        const { onBack } = mountCount({ api, onCloseAttempt });
        await ready();
        enter('Billete C$ 100', '2');
        await validar();
        click('Cerrar turno');
        expect(onCloseAttempt).toHaveBeenCalledWith(42);
        expect(screen.getByRole('button', { name: 'Volver' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
        expect(onBack).not.toHaveBeenCalled();
    });
    it('back in Caja after an unknown close whose shift is now closed, the report is offered', async () => {
        const api = makeCash();
        const onReport = vi.fn();
        const onAttemptSeen = vi.fn();
        render(<CashHome session={cashSession()} api={api} onBack={vi.fn()} onCount={vi.fn()} closeAttempt={42} onReport={onReport} onAttemptSeen={onAttemptSeen} />);
        expect(await screen.findByText('Tu turno se cerró')).toBeInTheDocument();
        click('Ver reporte');
        expect(onReport).toHaveBeenCalledWith(42);
        expect(onAttemptSeen).toHaveBeenCalled();
    });
    it('if the shift is still open the attempt is simply cleared', async () => {
        const api = makeCash({ activeStatus: vi.fn().mockResolvedValue({ hasActiveShift: true, shift: { id: 42, cashRegisterId: 1, userId: 5, startDate: '2026-11-20T14:00:00.000Z', endDate: null, startAmount: 500 }, requiresClose: false, message: null }) });
        const onAttemptSeen = vi.fn();
        render(<CashHome session={cashSession()} api={api} onBack={vi.fn()} onCount={vi.fn()} closeAttempt={42} onReport={vi.fn()} onAttemptSeen={onAttemptSeen} />);
        await screen.findByTestId('active-shift');
        expect(screen.queryByText('Tu turno se cerró')).toBeNull();
        expect(onAttemptSeen).toHaveBeenCalled();
    });
});

describe('W7 partial count is a verification', () => {
    it('has no Guardar arqueo and says it is not recorded', async () => {
        const { api } = mountCount({ mode: 'partial' });
        await ready();
        expect(screen.queryByRole('button', { name: 'Guardar arqueo' })).toBeNull();
        expect(screen.getByText('Verificación — no se registra')).toBeInTheDocument();
        enter('Billete C$ 100', '2');
        await validar();
        expect(api.count).not.toHaveBeenCalled();
    });
});

describe('W8 errors', () => {
    it('a network failure on close shows Spanish text and Reintentar', async () => {
        const api = countApi({ close: vi.fn().mockRejectedValue(axiosErr()) });
        mountCount({ api });
        await ready();
        enter('Billete C$ 100', '2');
        await validar();
        click('Cerrar turno');
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).not.toMatch(/Network Error|Request failed/);
        expect(alert).toHaveTextContent(/conectar|conexión/i);
        expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    });
    it('a definitive 400 shows the Spanish reason and no Reintentar', async () => {
        const api = countApi({ close: vi.fn().mockRejectedValue(axiosErr(400, 'Request failed with status code 400')) });
        mountCount({ api });
        await ready();
        enter('Billete C$ 100', '2');
        await validar();
        click('Cerrar turno');
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).not.toMatch(/Request failed/);
        expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    });
    it('a movement rejected with 403 has no Reintentar; a 503 does', async () => {
        const addMovement = vi.fn().mockRejectedValueOnce(axiosErr(403, 'Request failed with status code 403')).mockRejectedValueOnce(axiosErr(503));
        render(<MovementSheet shiftId={42} type="OUT" addMovement={addMovement} onClose={vi.fn()} onSaved={vi.fn()} />);
        click('5');
        click('Compra menor');
        click('Factura');
        click(/Registrar salida/);
        const first = await screen.findByRole('alert');
        expect(first.textContent).not.toMatch(/Request failed/);
        expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
        click(/Registrar salida/);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument());
    });
    it('a CashError keeps the server message without Reintentar', async () => {
        const api = countApi({ close: vi.fn().mockRejectedValue(new CashError('CASH_NOTE_REQUIRED', 'La nota es obligatoria')) });
        mountCount({ api });
        await ready();
        enter('Billete C$ 100', '2');
        await validar();
        click('Cerrar turno');
        expect(await screen.findByRole('alert')).toHaveTextContent('La nota es obligatoria');
        expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    });
});

describe('W9 idle lock while counting', () => {
    it('with entries the lock waits 10 minutes, then still locks', async () => {
        vi.useFakeTimers();
        const onLock = vi.fn();
        render(
            <IdleLockBoundary onLock={onLock}>
                <CountCloseScreen api={countApi()} session={cashSession()} shiftId={42} mode="close" onBack={vi.fn()} onClosed={vi.fn()} />
            </IdleLockBoundary>,
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10);
        });
        click('Billete C$ 100');
        click('2');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(119_000);
        });
        expect(onLock).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2_000);
        });
        expect(onLock).not.toHaveBeenCalled(); // past the 2 minutes, still counting
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600_000);
        });
        expect(onLock).toHaveBeenCalledTimes(1);
    });
    it('without entries the normal 2 minutes apply', async () => {
        vi.useFakeTimers();
        const onLock = vi.fn();
        render(
            <IdleLockBoundary onLock={onLock}>
                <CountCloseScreen api={countApi()} session={cashSession()} shiftId={42} mode="close" onBack={vi.fn()} onClosed={vi.fn()} />
            </IdleLockBoundary>,
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(121_000);
        });
        expect(onLock).toHaveBeenCalledTimes(1);
    });
});

describe('W10 supervisor path', () => {
    it('ADMIN sees Turnos abiertos in Caja; a CAJERO does not', async () => {
        const open = vi.fn();
        const { unmount } = render(<CashHome session={cashSession('ADMIN')} api={makeCash()} onBack={vi.fn()} onCount={vi.fn()} onOpenShifts={open} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Turnos abiertos' }));
        expect(open).toHaveBeenCalled();
        unmount();
        render(<CashHome session={cashSession('CAJERO')} api={makeCash()} onBack={vi.fn()} onCount={vi.fn()} onOpenShifts={open} />);
        await screen.findByTestId('open-shift');
        expect(screen.queryByRole('button', { name: 'Turnos abiertos' })).toBeNull();
    });
    it('lists registers with an active shift and opens count / close for another user', async () => {
        const api = makeCash({ registers: vi.fn().mockResolvedValue(REGISTERS) });
        const onCount = vi.fn();
        render(<OpenShiftsScreen api={api} onBack={vi.fn()} onCount={onCount} />);
        const list = await screen.findByRole('list', { name: 'Turnos abiertos' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(1); // Caja 1 has no shift
        expect(list).toHaveTextContent('Caja 2');
        expect(list).toHaveTextContent('Luis Gomez');
        click('Cerrar turno de Caja 2');
        expect(onCount).toHaveBeenCalledWith(90, 'close');
        click('Arqueo de Caja 2');
        expect(onCount).toHaveBeenCalledWith(90, 'partial');
    });
});

describe('minors', () => {
    it('editing the note after a failed close starts a new action', async () => {
        const close = vi.fn().mockRejectedValueOnce(axiosErr()).mockResolvedValue({ alreadyClosed: false, shift: {} });
        mountCount({ api: countApi({ close }) });
        await ready();
        enter('Billete C$ 100', '2');
        await validar();
        click('Cerrar turno');
        await screen.findByRole('button', { name: 'Reintentar' });
        fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'se cayó la red' } });
        expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
        click('Cerrar turno');
        await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
        expect(close.mock.calls[1][1].notes).toBe('se cayó la red');
        expect(close.mock.calls[1][2].actionId).not.toBe(close.mock.calls[0][2].actionId);
    });
    it('the ticket prints the rate with up to 4 decimals', () => {
        const text = closeTicket(reportOf({ shift: { closingExchangeRate: 36.6243 } }), { printedAt: new Date(2026, 10, 20, 22, 0), printedBy: 'Carla' });
        expect(text).toContain('36.6243');
    });
    it('← with an empty count leaves at once', async () => {
        const { onBack } = mountCount();
        await ready();
        click('Volver');
        expect(onBack).toHaveBeenCalledTimes(1);
    });
    it('← with entries asks before discarding', async () => {
        const { onBack } = mountCount();
        await ready();
        enter('Billete C$ 100', '2');
        click('Volver');
        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
        click('Seguir contando');
        expect(screen.queryByRole('alertdialog')).toBeNull();
        click('Volver');
        fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Descartar' }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});

describe('W8 invoice share', () => {
    const done = { tableLabel: 'Mesa 2', invoiceNumber: 'F-1', invoiceError: null, methods: 'Efectivo', change: 0 };
    it('a network failure offers Reintentar; a 403 explains in Spanish and does not', async () => {
        const load = vi.fn().mockRejectedValueOnce(axiosErr()).mockRejectedValueOnce(axiosErr(403, 'Request failed with status code 403'));
        render(<PaymentDone data={done} onFinish={vi.fn()} invoice={{ load, fileName: 'f.pdf' }} printer={{ sharePdf: vi.fn() }} />);
        click('Enviar');
        await screen.findByRole('button', { name: 'Reintentar' });
        click('Reintentar');
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull());
        expect(screen.getByRole('alert').textContent).not.toMatch(/Request failed/);
        expect(screen.getByRole('alert')).toHaveTextContent(/permiso/);
    });
});
