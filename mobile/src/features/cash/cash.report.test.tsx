import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PrintOut } from '../print/printOut';
import { PrinterUnavailable } from '../print/printOut';
import { reportOf } from '../print/reportFixture';
import { CloseReportScreen } from './CloseReportScreen';
import { ShiftHistoryScreen } from './ShiftHistoryScreen';
import { CashHome } from './CashHome';
import { cashSession, makeCash } from './testkit';

afterEach(cleanup);

function printer(over: Partial<PrintOut> = {}): PrintOut & { [K in keyof PrintOut]: ReturnType<typeof vi.fn> } {
    return { print: vi.fn().mockRejectedValue(new PrinterUnavailable()), shareText: vi.fn().mockResolvedValue(undefined), sharePdf: vi.fn(), ...over } as never;
}

function setup(over: { role?: 'CAJERO' | 'ADMIN'; printer?: ReturnType<typeof printer>; report?: ReturnType<typeof reportOf> } = {}) {
    const api = makeCash({ report: vi.fn().mockResolvedValue(over.report ?? reportOf()) });
    const out = over.printer ?? printer();
    const onDone = vi.fn();
    render(<CloseReportScreen api={api} session={cashSession(over.role ?? 'CAJERO')} shiftId={42} onDone={onDone} printer={out} />);
    return { api, out, onDone };
}

describe('CloseReportScreen', () => {
    it('report hides nothing after close', async () => {
        const { api } = setup({ role: 'CAJERO' });
        const key = await screen.findByRole('group', { name: 'Cifras clave' });
        expect(api.report).toHaveBeenCalledWith(42);
        const card = (title: string) => within(key).getByText(title).closest('[data-card]') as HTMLElement;
        expect(card('Ventas')).toHaveTextContent('C$ 2,000');
        expect(card('Debe haber')).toHaveTextContent('C$ 2,420.50');
        expect(card('Contado')).toHaveTextContent('C$ 2,425.50');
        expect(card('Diferencia')).toHaveTextContent('+C$ 5');
        expect(screen.getByTestId('result-tag')).toHaveTextContent('Sobrante C$ 5');
        // three cards + the closing note, for the cashier too
        expect(api.summary).not.toHaveBeenCalled(); // everything comes with the report
        const sales = screen.getByRole('region', { name: 'Ventas por método' });
        expect(sales).toHaveTextContent('C$ 600');
        expect(sales).toHaveTextContent('Descuentos');
        expect(sales).toHaveTextContent('C$ 12.25');
        expect(sales).toHaveTextContent('Propinas');
        expect(sales).toHaveTextContent('C$ 8.50');
        expect(screen.getByRole('region', { name: 'Efectivo' })).toHaveTextContent('Debe haber');
        expect(screen.getByRole('region', { name: 'Arqueo' })).toHaveTextContent('Nota: Sobro un billete de 5 en la caja.');
        expect(screen.queryByText(/ciega/i)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Denominaciones' }));
        expect(screen.getByRole('list', { name: 'Dólares contados' })).toHaveTextContent('US$ 20 × 2');
    });

    it('shows Faltante and Cuadrado tags', async () => {
        setup({ report: reportOf({ amounts: { actualEndAmount: 2415.5, difference: -5 } }) });
        expect(await screen.findByTestId('result-tag')).toHaveTextContent('Faltante C$ 5');
        cleanup();
        setup({ report: reportOf({ amounts: { actualEndAmount: 2420.5, difference: 0 } }) });
        await waitFor(() => expect(screen.getByTestId('result-tag')).toHaveTextContent('Cuadrado'));
    });

    it('Imprimir ticket falls back to the share sheet and a double tap shares once', async () => {
        let release: () => void = () => undefined;
        const out = printer({ print: vi.fn(() => new Promise<void>((_, reject) => (release = () => reject(new PrinterUnavailable())))) as never });
        setup({ printer: out });
        const button = await screen.findByRole('button', { name: 'Imprimir ticket' });
        fireEvent.click(button);
        fireEvent.click(button);
        expect(button).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
        release();
        await waitFor(() => expect(out.shareText).toHaveBeenCalledTimes(1));
        expect(out.print).toHaveBeenCalledTimes(1);
        const text = out.shareText.mock.calls[0][0] as string;
        expect(text).toContain('CIERRE DE CAJA');
        expect(text).toContain('SOBRANTE C$ 5.00');
        expect(text.trimEnd().split('\n').pop()).toMatch(/^Impreso \d\d\/\d\d\/\d{4} \d\d:\d\d · Carla Cajera$/);
        expect(await screen.findByRole('status')).toHaveTextContent('No hay impresora');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Imprimir ticket' })).toBeEnabled());
    });

    it('Enviar shares the ticket text and a print failure shows a message', async () => {
        const out = printer({ print: vi.fn().mockRejectedValue(new Error('Bluetooth caído')) as never });
        setup({ printer: out });
        fireEvent.click(await screen.findByRole('button', { name: 'Enviar' }));
        await waitFor(() => expect(out.shareText).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Imprimir ticket' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Imprimir ticket' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Bluetooth caído');
    });

    it('Listo goes back and a load failure offers retry', async () => {
        const api = makeCash({ report: vi.fn().mockRejectedValueOnce(new Error('Sin red')).mockResolvedValue(reportOf()) });
        const onDone = vi.fn();
        render(<CloseReportScreen api={api} session={cashSession()} shiftId={42} onDone={onDone} printer={printer()} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Sin red');
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        await screen.findByRole('group', { name: 'Cifras clave' });
        fireEvent.click(screen.getByRole('button', { name: 'Listo' }));
        expect(onDone).toHaveBeenCalled();
    });
});

describe('ShiftHistoryScreen', () => {
    const closed = (id: number, end: string) => ({ id, cashRegisterId: 1, userId: 5, startDate: '2026-11-19T14:00:00.000Z', endDate: end, startAmount: 500, endAmount: 1710, cashRegister: { id: 1, name: 'Caja 1' }, user: { id: 5, name: 'Carla Cajera' } });

    it('lists closed shifts and opens the report of the one tapped', async () => {
        const open = { ...closed(50, '2026-11-20T10:00:00.000Z'), endDate: null };
        const api = makeCash({ history: vi.fn().mockResolvedValue([closed(40, '2026-11-19T22:00:00.000Z'), open, closed(41, '2026-11-20T22:00:00.000Z')]) });
        const onOpen = vi.fn();
        render(<ShiftHistoryScreen api={api} onOpen={onOpen} onBack={vi.fn()} now={() => new Date(2026, 10, 21)} />);
        const list = await screen.findByRole('list', { name: 'Turnos cerrados' });
        const rows = within(list).getAllByRole('button');
        expect(rows).toHaveLength(2); // the open shift is not history
        expect(rows[0]).toHaveTextContent('Turno #41'); // newest first
        expect(api.history).toHaveBeenCalledWith({ from: '2026-10-22', to: '2026-11-21' });
        fireEvent.click(rows[1]);
        expect(onOpen).toHaveBeenCalledWith(40);
        fireEvent.click(screen.getByRole('button', { name: '7 días' }));
        await waitFor(() => expect(api.history).toHaveBeenLastCalledWith({ from: '2026-11-14', to: '2026-11-21' }));
    });

    it('is reachable from the caja', async () => {
        const api = makeCash({ history: vi.fn().mockResolvedValue([]) });
        const onHistory = vi.fn();
        render(<CashHome session={cashSession()} api={api} onBack={vi.fn()} onCount={vi.fn()} onHistory={onHistory} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Historial de turnos' }));
        expect(onHistory).toHaveBeenCalled();
    });
});
