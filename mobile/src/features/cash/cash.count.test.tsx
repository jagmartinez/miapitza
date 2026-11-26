import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CashError } from '../../data/cashApi';
import type { ClosePreview } from '../../data/cashTypes';
import { CountCloseScreen } from './CountCloseScreen';
import { cashSession, FULL, makeCash } from './testkit';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
});

type Role = 'CAJERO' | 'ADMIN' | 'SUPERADMIN';

/** A leaky preview: even if the server (or a bug) sent the expected amount, a CAJERO never renders it. */
const preview = (over: Partial<ClosePreview> = {}): ClosePreview => ({
    countedAmount: 200,
    countedBreakdown: { bills: 200, coins: 0, usdBills: 0, usdInCordobas: 0, exchangeRate: 36.5 },
    notes: '',
    status: 'FALTANTE',
    withinTolerance: false,
    requiresNote: true,
    exceedsTolerance: false,
    tolerance: 1,
    expectedAmount: 1700,
    difference: -1500,
    absoluteDifference: 1500,
    ...over,
});
const balanced = () => preview({ requiresNote: false, status: 'CUADRADO', withinTolerance: true, expectedAmount: undefined, difference: undefined });
const shiftClosed = { alreadyClosed: false, shift: {} };

function apiWith(over: Record<string, unknown> = {}) {
    return makeCash({
        summary: vi.fn().mockResolvedValue(FULL),
        previewClose: vi.fn().mockResolvedValue(preview()),
        close: vi.fn().mockResolvedValue(shiftClosed),
        count: vi.fn().mockResolvedValue({ counted: { bills: 200, coins: 0, usdBills: 0, usdInCordobas: 0, total: 200 }, status: 'FALTANTE' }),
        ...over,
    });
}

function setup(over: { role?: Role; mode?: 'close' | 'partial'; api?: ReturnType<typeof makeCash> } = {}) {
    const api = over.api ?? apiWith();
    const onClosed = vi.fn();
    const onBack = vi.fn();
    const session = cashSession(over.role ?? 'CAJERO');
    const ui = (s = session) => <CountCloseScreen api={api} session={s} shiftId={42} mode={over.mode ?? 'close'} onBack={onBack} onClosed={onClosed} />;
    const view = render(ui());
    return { api, onClosed, onBack, session, view, ui };
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const keys = (digits: string) => {
    for (const k of digits) click(k);
};
/** Tap a denomination and type its count. */
const enter = (denom: string, digits: string) => {
    click(denom);
    keys(digits);
};
const ready = async () => {
    await waitFor(() => expect(screen.getByLabelText('Tipo de cambio')).toHaveValue('36.5'));
};
const validar = async () => {
    click('Validar');
    await screen.findByTestId('count-result');
};

describe('CountCloseScreen', () => {
    it('CAJERO sees no expected or difference before or after validar, only the result label', async () => {
        setup({ role: 'CAJERO' });
        await ready();
        enter('Billete C$ 100', '2');
        expect(screen.queryByText(/Debe haber/i)).toBeNull();
        expect(screen.queryByText(/Diferencia/i)).toBeNull();
        expect(screen.getByTestId('total-counted')).toHaveTextContent('C$ 200'); // the counted totals are fine
        await validar();
        expect(screen.getByTestId('count-result')).toHaveTextContent('Faltante');
        expect(screen.queryByText(/Debe haber/i)).toBeNull();
        expect(screen.queryByText(/Diferencia/i)).toBeNull();
        expect(document.body.textContent ?? '').not.toMatch(/1,700|1,500|1700|1500/); // leaky server values never reach the DOM
    });

    it('ADMIN sees debe haber and diferencia', async () => {
        setup({ role: 'ADMIN' });
        await ready();
        enter('Billete C$ 100', '2');
        expect(await screen.findByText('Debe haber')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('expected')).toHaveTextContent('C$ 1,700'));
        await validar();
        expect(screen.getByTestId('expected')).toHaveTextContent('C$ 1,700');
        expect(screen.getByTestId('difference')).toHaveTextContent('C$ 1,500');
        expect(screen.getByTestId('count-result')).toHaveTextContent('Faltante');
    });

    it('note required blocks close until filled', async () => {
        const { api, onClosed } = setup({ role: 'CAJERO' });
        await ready();
        enter('Billete C$ 100', '2');
        expect(screen.getByRole('button', { name: 'Cerrar turno' })).toBeDisabled(); // not validated yet
        await validar();
        const close = screen.getByRole('button', { name: 'Cerrar turno' });
        expect(close).toBeDisabled();
        expect(screen.getByText(/nota es obligatoria/i)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Nota'), { target: { value: '  Faltó un vale  ' } });
        expect(close).toBeEnabled();
        click('Cerrar turno');
        await waitFor(() => expect(onClosed).toHaveBeenCalledWith(42));
        expect(api.close.mock.calls[0][1]).toMatchObject({ endAmount: 200, notes: 'Faltó un vale' });
        expect(api.close.mock.calls[0][1].forceClose).toBeUndefined();
    });

    it('exceeds tolerance blocks CAJERO and offers force close to ADMIN', async () => {
        const exceeding = preview({ exceedsTolerance: true, requiresNote: true });
        const cajero = setup({ role: 'CAJERO', api: apiWith({ previewClose: vi.fn().mockResolvedValue(exceeding) }) });
        await ready();
        enter('Billete C$ 100', '2');
        await validar();
        fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'x' } });
        expect(screen.getByText('La diferencia excede la tolerancia. Llama a un supervisor.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cerrar turno' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Forzar cierre' })).toBeNull();
        expect(cajero.api.close).not.toHaveBeenCalled();
        cleanup();

        const admin = setup({ role: 'ADMIN', api: apiWith({ previewClose: vi.fn().mockResolvedValue(exceeding) }) });
        await ready();
        enter('Billete C$ 100', '2');
        await validar();
        const force = screen.getByRole('button', { name: 'Forzar cierre' });
        expect(force).toBeDisabled(); // a note is mandatory
        expect(screen.queryByRole('button', { name: 'Cerrar turno' })).toBeNull();
        fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Autorizado por gerencia' } });
        expect(force).toBeEnabled();
        fireEvent.click(force);
        await waitFor(() => expect(admin.onClosed).toHaveBeenCalledWith(42));
        expect(admin.api.close.mock.calls[0][1]).toMatchObject({ forceClose: true, notes: 'Autorizado por gerencia', endAmount: 200 });
    });

    it('a CAJERO that gets CASH_DIFF_EXCEEDS_TOLERANCE from the server sees the supervisor message and no retry', async () => {
        const close = vi.fn().mockRejectedValue(new CashError('CASH_DIFF_EXCEEDS_TOLERANCE', 'x', { status: 403 }));
        const { onClosed } = setup({ role: 'CAJERO', api: apiWith({ previewClose: vi.fn().mockResolvedValue(balanced()), close }) });
        await ready();
        enter('Billete C$ 100', '2');
        await validar();
        click('Cerrar turno');
        expect(await screen.findByRole('alert')).toHaveTextContent('La diferencia excede la tolerancia. Llama a un supervisor.');
        expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
        expect(onClosed).not.toHaveBeenCalled();
    });

    it('close payload endAmount equals counted total to the cent', async () => {
        const { api } = setup({ role: 'ADMIN', api: apiWith({ previewClose: vi.fn().mockResolvedValue(balanced()) }) });
        await ready();
        enter('Billete C$ 1000', '1');
        enter('Moneda C$ 0.25', '3');
        enter('Billete US$ 20', '1');
        expect(screen.getByTestId('total-counted')).toHaveTextContent('C$ 1,730.75'); // 1000 + 0.75 + 20 x 36.5
        await validar();
        click('Cerrar turno');
        await waitFor(() => expect(api.close).toHaveBeenCalled());
        const payload = api.close.mock.calls[0][1];
        expect(payload.endAmount).toBe(1730.75);
        expect(payload.exchangeRate).toBe(36.5);
        expect(payload.usdBills).toEqual([{ denomination: 20, count: 1 }]);
        expect(api.previewClose.mock.calls[0][1].endAmount).toBe(1730.75);
    });

    it('editing the count or the rate after validar invalidates the result', async () => {
        const { api } = setup({ role: 'CAJERO' });
        await ready();
        enter('Billete C$ 100', '2');
        enter('Billete US$ 20', '1');
        await validar();
        enter('Billete C$ 100', '3');
        expect(screen.queryByTestId('count-result')).toBeNull();
        expect(screen.getByRole('button', { name: 'Cerrar turno' })).toBeDisabled();
        await validar();
        // the rate is editable for this close only
        fireEvent.click(screen.getByLabelText('Tipo de cambio'));
        keys('36.35');
        expect(screen.getByLabelText('Tipo de cambio')).toHaveValue('36.35');
        expect(screen.queryByTestId('count-result')).toBeNull();
        expect(screen.getByTestId('total-counted')).toHaveTextContent('C$ 1,027'); // 300 + 20 x 36.35
        expect(api.close).not.toHaveBeenCalled();
    });

    it('lost close response retry shows the report', async () => {
        const close = vi.fn().mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({ alreadyClosed: true });
        const { api, onClosed } = setup({ role: 'CAJERO', api: apiWith({ previewClose: vi.fn().mockResolvedValue(balanced()), close }) });
        await ready();
        enter('Billete C$ 100', '2');
        await validar();
        click('Cerrar turno');
        const retry = await screen.findByRole('button', { name: 'Reintentar' });
        expect(onClosed).not.toHaveBeenCalled();
        fireEvent.click(retry);
        await waitFor(() => expect(onClosed).toHaveBeenCalledWith(42));
        expect(api.close).toHaveBeenCalledTimes(2);
        expect(api.close.mock.calls[1][2].actionId).toBe(api.close.mock.calls[0][2].actionId); // same action, same key
    });

    it('a pending close cannot be submitted twice and a new submit gets a new action id', async () => {
        let fail!: (e: unknown) => void;
        const close = vi
            .fn()
            .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
            .mockResolvedValue(shiftClosed);
        const { api, onClosed } = setup({ role: 'CAJERO', api: apiWith({ previewClose: vi.fn().mockResolvedValue(balanced()), close }) });
        await ready();
        enter('Billete C$ 100', '2');
        await validar();
        click('Cerrar turno');
        const busy = screen.getByRole('button', { name: /Cerrando/ });
        expect(busy).toBeDisabled();
        fireEvent.click(busy);
        expect(close).toHaveBeenCalledTimes(1);
        await act(async () => fail(new CashError('CASH_COUNT_MISMATCH', 'El conteo no coincide', { status: 400 })));
        expect(await screen.findByRole('alert')).toHaveTextContent('El conteo no coincide');
        click('Cerrar turno');
        await waitFor(() => expect(onClosed).toHaveBeenCalledWith(42));
        expect(close).toHaveBeenCalledTimes(2);
        expect(api.close.mock.calls[1][2].actionId).not.toBe(api.close.mock.calls[0][2].actionId);
    });

    it('lock clears the in-progress count', async () => {
        let release!: (v: unknown) => void;
        const close = vi.fn().mockImplementation(() => new Promise((r) => (release = r)));
        const { ui, onClosed, view, api } = setup({ role: 'CAJERO', api: apiWith({ previewClose: vi.fn().mockResolvedValue(balanced()), close }) });
        await ready();
        enter('Billete C$ 100', '2');
        expect(screen.getByTestId('total-counted')).toHaveTextContent('C$ 200');
        // a PIN switch (same screen, other owner) starts from zero
        const other = cashSession('CAJERO');
        view.rerender(ui({ ...other, user: { ...other.user, id: 9, name: 'Luis Gomez' } }));
        expect(screen.getByTestId('total-counted')).toHaveTextContent('C$ 0');
        await ready();
        enter('Billete C$ 100', '2');
        await validar();
        click('Cerrar turno');
        await waitFor(() => expect(close).toHaveBeenCalled());
        view.unmount(); // lock
        await act(async () => release({ alreadyClosed: false, shift: {} }));
        expect(onClosed).not.toHaveBeenCalled(); // a late answer never navigates for a locked session
        // nothing was persisted
        expect(JSON.stringify({ ...localStorage })).not.toMatch(/100|billete|bills/i);
        expect(JSON.stringify({ ...sessionStorage })).not.toMatch(/100|billete|bills/i);
        render(ui());
        await ready();
        expect(screen.getByTestId('total-counted')).toHaveTextContent('C$ 0');
        expect(api.count).not.toHaveBeenCalled();
    });

    it('offline shows Requiere conexión and blocks every cash call', async () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        setup({ role: 'CAJERO' });
        await ready();
        enter('Billete C$ 100', '2');
        expect(screen.getByRole('status')).toHaveTextContent('Requiere conexión');
        for (const name of ['Validar', 'Cerrar turno']) expect(screen.getByRole('button', { name })).toBeDisabled();
    });

    it('the action buttons sit in a footer outside the scrolling columns', async () => {
        setup({ role: 'ADMIN' });
        await ready();
        const foot = screen.getByRole('contentinfo', { name: 'Acciones del arqueo' });
        for (const name of ['Validar', 'Cerrar turno']) expect(within(foot).getByRole('button', { name })).toBeInTheDocument();
        expect(foot.closest('.cash-count-body')).toBeNull();
        expect(foot.closest('.cash-dcol')).toBeNull();
        expect(foot.closest('.cash-count-panel')).toBeNull();
        expect(foot.parentElement).toHaveClass('cash');
    });
});
