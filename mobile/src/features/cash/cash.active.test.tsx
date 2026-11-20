import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CashMovementRow } from '../../data/cashTypes';
import { ActiveShiftScreen } from './ActiveShiftScreen';
import { BLIND, cashSession, FULL, makeCash, SHIFT, summaryOf } from './testkit';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const MOVEMENTS: CashMovementRow[] = [
    { id: 1, type: 'IN', amount: 1200, description: 'Venta', reference: 'PAY-7', createdAt: '2026-11-20T15:00:00.000Z' },
    { id: 2, type: 'OUT', amount: 100, description: 'Compra menor: hielo', reference: null, documentType: 'RECIBO_GASTO', createdAt: '2026-11-20T16:00:00.000Z' },
];

type Over = { role?: 'CAJERO' | 'ADMIN' | 'SUPERADMIN'; summary?: ReturnType<typeof summaryOf>; addMovement?: ReturnType<typeof vi.fn>; onCount?: () => void };

function setup(over: Over = {}) {
    const api = makeCash({ summary: vi.fn().mockResolvedValue(over.summary ?? FULL) });
    const addMovement = over.addMovement ?? vi.fn().mockResolvedValue({ id: 3 });
    const onCount = over.onCount ?? vi.fn();
    render(<ActiveShiftScreen api={api} session={cashSession(over.role ?? 'CAJERO')} shift={SHIFT} addMovement={addMovement as never} onBack={vi.fn()} onCount={onCount} />);
    return { api, addMovement, onCount };
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

async function fillMovement(opts: { amount?: string; reason?: string | null; doc?: string | null } = {}) {
    await screen.findByRole('dialog', { name: /Entrada|Salida/ });
    for (const k of opts.amount ?? '50') click(k);
    if (opts.reason !== null) click(opts.reason ?? 'Compra menor');
    if (opts.doc !== null) click(opts.doc ?? 'Recibo de gasto');
}

describe('ActiveShiftScreen', () => {
    it('cards show sales by method with percentages on one line', async () => {
        setup();
        const cards = await screen.findByRole('group', { name: 'Resumen de ventas' });
        const card = (title: string) => within(cards).getByText(title).closest('[data-card]') as HTMLElement;
        expect(card('Ventas')).toHaveTextContent('C$ 2000');
        expect(card('Ventas')).toHaveTextContent('14 cobros');
        expect(card('Efectivo')).toHaveTextContent('60%');
        expect(card('Tarjeta')).toHaveTextContent('30%');
        expect(card('Transferencia')).toHaveTextContent('10%');
        // one line, tabular figures: the amount element never wraps
        for (const title of ['Ventas', 'Efectivo', 'Tarjeta', 'Transferencia']) {
            expect(within(card(title)).getByText(/^C\$ /)).toHaveClass('cash-num');
        }
    });

    it('CAJERO never sees debe haber; ADMIN does', async () => {
        // Even if a leaky response carried the expected amount, a CAJERO never renders it.
        setup({ role: 'CAJERO', summary: FULL });
        await screen.findByText('Efectivo en caja');
        expect(screen.queryByText(/Debe haber/i)).toBeNull();
        expect(screen.queryByText('C$ 1700')).toBeNull();
        expect(screen.getByText('Fondo inicial')).toBeInTheDocument(); // the amounts the server does send stay
        cleanup();
        setup({ role: 'ADMIN', summary: FULL });
        expect(await screen.findByText('Debe haber')).toBeInTheDocument();
        expect(screen.getByText('C$ 1700')).toBeInTheDocument();
    });

    it('a blind response for ADMIN shows a dash, never a computed total', async () => {
        setup({ role: 'SUPERADMIN', summary: BLIND });
        expect(await screen.findByText('Debe haber')).toBeInTheDocument();
        expect(screen.queryByText('C$ 1700')).toBeNull();
        expect(screen.getByTestId('expected')).toHaveTextContent('—');
    });

    it('lists only manual cash movements, not sales', async () => {
        setup({ summary: summaryOf({}, MOVEMENTS) });
        expect(await screen.findByText('Compra menor: hielo')).toBeInTheDocument();
        expect(screen.queryByText('Venta')).toBeNull();
    });

    it('Cerrar turno and Arqueo parcial hand the shift to the count screen', async () => {
        const { onCount } = setup();
        await screen.findByText('Efectivo en caja');
        click('Arqueo parcial');
        click('Cerrar turno');
        expect(onCount).toHaveBeenNthCalledWith(1, 42, 'partial');
        expect(onCount).toHaveBeenNthCalledWith(2, 42, 'close');
    });
});

describe('MovementSheet', () => {
    it('movement requires amount, reason and document type', async () => {
        const { addMovement } = setup();
        await screen.findByText('Efectivo en caja');
        click('Salida');
        const save = () => screen.getByRole('button', { name: /^Registrar salida/ });
        await screen.findByRole('dialog', { name: 'Salida' });
        expect(save()).toBeDisabled();
        click('5');
        expect(save()).toBeDisabled();
        click('Compra menor');
        expect(save()).toBeDisabled();
        click('Recibo de gasto');
        expect(save()).toBeEnabled();
        fireEvent.click(save());
        await waitFor(() => expect(addMovement).toHaveBeenCalledTimes(1));
        expect(addMovement).toHaveBeenCalledWith(42, expect.objectContaining({ type: 'OUT', amount: 5, reason: 'Compra menor', documentType: 'RECIBO_GASTO' }), { actionId: expect.any(String) });
    });

    it('Otro requires a description', async () => {
        setup();
        await screen.findByText('Efectivo en caja');
        click('Entrada');
        await fillMovement({ reason: 'Otro', doc: 'Recibo de caja' });
        expect(screen.getByRole('button', { name: /^Registrar entrada/ })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Cambio de billetes' } });
        expect(screen.getByRole('button', { name: /^Registrar entrada/ })).toBeEnabled();
    });

    it('double tap records one movement', async () => {
        let resolve!: (v: unknown) => void;
        const addMovement = vi.fn().mockImplementation(() => new Promise((r) => (resolve = r)));
        setup({ addMovement });
        await screen.findByText('Efectivo en caja');
        click('Salida');
        await fillMovement();
        const save = screen.getByRole('button', { name: /^Registrar salida/ });
        fireEvent.click(save);
        fireEvent.click(save);
        expect(addMovement).toHaveBeenCalledTimes(1);
        resolve({ id: 1 });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('a failed save reuses the action id on Reintentar; an edit gets a new one', async () => {
        const addMovement = vi.fn().mockRejectedValueOnce(new Error('Network Error')).mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue({ id: 1 });
        setup({ addMovement });
        await screen.findByText('Efectivo en caja');
        click('Salida');
        await fillMovement();
        click(/^Registrar salida/);
        click(await screen.findByRole('button', { name: 'Reintentar' }).then(() => 'Reintentar'));
        await waitFor(() => expect(addMovement).toHaveBeenCalledTimes(2));
        expect(addMovement.mock.calls[1][2]).toEqual(addMovement.mock.calls[0][2]);
        await screen.findByRole('button', { name: 'Reintentar' });
        click('0'); // edited: a new submit
        click(/^Registrar salida/);
        await waitFor(() => expect(addMovement).toHaveBeenCalledTimes(3));
        expect(addMovement.mock.calls[2][2]).not.toEqual(addMovement.mock.calls[1][2]);
    });

    it('movement refreshes the summary', async () => {
        const { api } = setup();
        await screen.findByText('Efectivo en caja');
        expect(api.summary).toHaveBeenCalledTimes(1);
        click('Entrada');
        await fillMovement({ doc: 'Recibo de caja', reason: 'Otro' });
        fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Cambio' } });
        click(/^Registrar entrada/);
        await waitFor(() => expect(api.summary).toHaveBeenCalledTimes(2));
        expect(api.summary).toHaveBeenLastCalledWith(42);
    });

    it('offline shows Requiere conexión and sends nothing', async () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const { addMovement } = setup();
        await screen.findByText('Efectivo en caja');
        expect(screen.getAllByText('Requiere conexión').length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: 'Entrada' })).toBeDisabled();
        expect(addMovement).not.toHaveBeenCalled();
    });
});
