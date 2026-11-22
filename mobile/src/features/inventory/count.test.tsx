import { readFileSync } from 'node:fs';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { appEvents } from '../../core/events';
import { CountScreen, LAYOUT } from './CountScreen';
import { FinishCountScreen } from './FinishCountScreen';
import { OfflineError } from './inventoryApi';
import type { CountCategory, CountLine, CountSheet } from './inventoryTypes';

configure({ asyncUtilTimeout: 5000 });
afterEach(cleanup);

const line = (productId: number, name: string, categoryId: number | null, o: Partial<CountLine> = {}): CountLine => ({
    productId,
    name,
    sku: `SKU${productId}`,
    categoryId,
    baseUnit: 'kg',
    units: [
        { abbreviation: 'kg', name: 'Kilogramo', factor: 1 },
        { abbreviation: 'g', name: 'Gramo', factor: 0.001 },
        { abbreviation: 'bolsa', name: 'Bolsa', factor: 5 },
    ],
    unit: null,
    countedQuantity: null,
    counted: false,
    recountRequested: false,
    ...o,
});
const categories: CountCategory[] = [
    { categoryId: 1, name: 'Lácteos' },
    { categoryId: 2, name: 'Carnes' },
];
const makeSheet = (o: Partial<CountSheet> = {}): CountSheet => ({
    id: 7,
    status: 'DRAFT',
    displayStatus: 'EN_CURSO',
    warehouse: { id: 3, name: 'Bodega Central' },
    startedAt: '2026-11-20T15:00:00.000Z',
    startedByName: 'Ana',
    scopeLabel: 'Todo',
    returnNote: null,
    categories,
    lines: [line(1, 'Leche', 1), line(2, 'Queso', 1), line(3, 'Res', 2), line(4, 'Pollo', 2, { unit: 'g', countedQuantity: 500, counted: true })],
    ...o,
});

function renderCount(sheet: CountSheet, extra: { saveLine?: (s: number, p: number, i: { unit: string; countedQuantity: number | null }) => Promise<'saved' | 'queued'>; props?: Partial<Parameters<typeof CountScreen>[0]> } = {}) {
    const saveLine = vi.fn(extra.saveLine ?? (() => Promise.resolve('saved' as const)));
    const sheetFn = vi.fn(() => Promise.resolve(sheet));
    const props = { onFinish: vi.fn(), onExit: vi.fn(), ...extra.props };
    const view = render(<CountScreen api={{ sheet: sheetFn, saveLine }} sheetId={7} user={{ name: 'Ana Perez' }} {...props} />);
    return { saveLine, sheetFn, ...props, ...view };
}
const press = (...keys: string[]) => keys.forEach((k) => fireEvent.click(screen.getByRole('button', { name: k })));
const rows = () => screen.getAllByTestId('count-row');

describe('CountScreen', () => {
    it('header shows warehouse, Ciego tag, counter, start and Guardado', async () => {
        renderCount(makeSheet());
        await screen.findByText('Bodega Central');
        expect(screen.getByText('Ciego')).toBeInTheDocument();
        expect(screen.getByText(/Ana Perez · Inicio/)).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Guardado');
    });

    it('never renders expected or stock', async () => {
        const sheet = makeSheet();
        (sheet.lines[0] as unknown as Record<string, unknown>).expectedAtCount = 987654;
        (sheet.lines[0] as unknown as Record<string, unknown>).stock = 777555;
        const { container } = renderCount(sheet);
        await screen.findByText('Leche');
        expect(container.textContent).not.toMatch(/987654|777555/);
        expect(container.textContent).not.toMatch(/esperad|existencia|stock/i);
    });

    it('category picker shows N/M with check when complete and switches list in place', async () => {
        renderCount(makeSheet({ lines: [line(1, 'Leche', 1, { counted: true, unit: 'kg', countedQuantity: 1 }), line(2, 'Queso', 1, { counted: true, unit: 'kg', countedQuantity: 2 }), line(3, 'Res', 2)] }));
        await screen.findByText('Res');
        fireEvent.click(screen.getByRole('button', { name: /Carnes 0\/1/ }));
        const list = screen.getByRole('listbox', { name: 'Categorías' });
        const dairy = within(list).getByRole('option', { name: /Lácteos/ });
        expect(dairy).toHaveTextContent('2/2');
        expect(within(dairy).getByLabelText('Completa')).toBeInTheDocument();
        expect(within(within(list).getByRole('option', { name: /Carnes/ })).queryByLabelText('Completa')).toBeNull();
        fireEvent.click(dairy);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Leche'), expect.stringContaining('Queso')]);
        expect(screen.getByRole('button', { name: /Lácteos 2\/2/ })).toBeInTheDocument();
    });

    it('search filters across all scope categories by name or sku', async () => {
        renderCount(makeSheet());
        await screen.findByText('Leche');
        const box = screen.getByRole('searchbox', { name: 'Buscar producto' });
        fireEvent.change(box, { target: { value: 'pollo' } });
        expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Pollo')]);
        fireEvent.change(box, { target: { value: 'sku3' } });
        expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Res')]);
        fireEvent.change(box, { target: { value: 'zzz' } });
        expect(screen.getByText('Sin resultados.')).toBeInTheDocument();
    });

    it('unit selector lists base and conversions; default is the line unit or base', async () => {
        renderCount(makeSheet());
        await screen.findByText('Leche');
        const units = screen.getByRole('group', { name: 'Unidad de conteo' });
        expect(within(units).getAllByRole('button').map((b) => b.textContent)).toEqual(['kg', 'g', 'bolsa']);
        expect(within(units).getByRole('button', { name: 'kg' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pollo' } });
        fireEvent.click(rows()[0]);
        expect(within(units).getByRole('button', { name: 'g' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('qty-display')).toHaveTextContent('500');
    });

    it('Guardar y siguiente saves and selects next uncounted', async () => {
        const { saveLine } = renderCount(makeSheet());
        await screen.findByText('Leche');
        fireEvent.click(within(screen.getByRole('group', { name: 'Unidad de conteo' })).getByRole('button', { name: 'bolsa' }));
        press('2', 'Punto decimal', '5');
        expect(screen.getByTestId('qty-display')).toHaveTextContent('2.5');
        fireEvent.click(screen.getByRole('button', { name: 'Guardar y siguiente' }));
        expect(saveLine).toHaveBeenCalledWith(7, 1, { unit: 'bolsa', countedQuantity: 2.5 });
        expect(rows()[0]).toHaveTextContent('2.5');
        expect(rows()[1]).toHaveAttribute('aria-current', 'true');
        expect(screen.getByTestId('qty-display')).toHaveTextContent('0');
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Guardado'));
        // The last one of the category moves to the next category.
        press('1');
        fireEvent.click(screen.getByRole('button', { name: 'Guardar y siguiente' }));
        expect(saveLine).toHaveBeenLastCalledWith(7, 2, { unit: 'kg', countedQuantity: 1 });
        expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Res'), expect.stringContaining('Pollo')]);
        expect(rows()[0]).toHaveAttribute('aria-current', 'true');
    });

    it('Guardar y siguiente is disabled until something is typed', async () => {
        renderCount(makeSheet());
        await screen.findByText('Leche');
        expect(screen.getByRole('button', { name: 'Guardar y siguiente' })).toBeDisabled();
        press('0');
        expect(screen.getByRole('button', { name: 'Guardar y siguiente' })).toBeEnabled();
    });

    it('offline save shows Sin conexión and keeps value after reload', async () => {
        let queued: { unit: string; countedQuantity: number | null } | null = null;
        const saveLine = vi.fn((_s: number, _p: number, input: { unit: string; countedQuantity: number | null }) => {
            queued = input;
            return Promise.resolve('queued' as const);
        });
        // The data layer lays the queued save over the server sheet; the fake does the same.
        const overlaid = () => makeSheet({ lines: makeSheet().lines.map((l) => (queued && l.productId === 1 ? { ...l, unit: queued.unit, countedQuantity: queued.countedQuantity, counted: true } : l)) });
        const first = renderCount(makeSheet(), { saveLine });
        await screen.findByText('Leche');
        press('4');
        fireEvent.click(screen.getByRole('button', { name: 'Guardar y siguiente' }));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sin conexión · se guardará'));
        first.unmount();
        renderCount(overlaid());
        await screen.findByText('Leche');
        expect(rows()[0]).toHaveTextContent('4');
        expect(rows()[0]).toHaveAttribute('data-counted', 'true');
    });

    it('recount lines are marked Recontar', async () => {
        renderCount(makeSheet({ lines: [line(1, 'Leche', 1, { recountRequested: true }), line(2, 'Queso', 1)] }));
        await screen.findByText('Leche');
        expect(within(rows()[0]).getByText('Recontar')).toBeInTheDocument();
        expect(within(rows()[1]).queryByText('Recontar')).toBeNull();
    });

    it('rows are 40dp and missing quantity shows —', async () => {
        renderCount(makeSheet());
        await screen.findByText('Leche');
        expect(within(rows()[0]).getByText('—')).toBeInTheDocument();
        const css = readFileSync('src/features/inventory/inventory.css', 'utf8');
        expect(css).toMatch(/\.cnt-row \{[^}]*height: 40px/);
    });

    it('compact layout fits 360', () => {
        const c = LAYOUT.compact;
        expect(c.header + c.controls + c.footer).toBeLessThanOrEqual(360);
        expect(c.header + c.unit + c.display + c.key * c.keyRows).toBeLessThanOrEqual(360);
        expect(c.key).toBeGreaterThanOrEqual(44);
        const css = readFileSync('src/features/inventory/inventory.css', 'utf8');
        const compact = css.slice(css.indexOf(`@media (max-height: ${LAYOUT.compactMaxHeight}px) {\n    .cnt-header`));
        expect(compact).toMatch(/\.cnt-header \{\s*height: 44px/);
        expect(compact).toMatch(/\.cnt-footer \{[^}]*height: 44px/);
        expect(compact).toMatch(/\.cnt-units \{\s*height: 36px/);
        expect(compact).toMatch(/\.cnt-display \{\s*height: 44px/);
        expect(css).toMatch(/\.cnt-key-save \{[^}]*grid-row: 3 \/ span 2/);
    });

    it('a sheet that is not DRAFT is read-only with its status', async () => {
        const { saveLine } = renderCount(makeSheet({ status: 'SUBMITTED', displayStatus: 'EN_REVISION' }));
        await screen.findByText('Leche');
        expect(screen.getByText('En revisión')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Guardar y siguiente' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Terminar conteo' })).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
        fireEvent.click(rows()[0]);
        expect(saveLine).not.toHaveBeenCalled();
    });

    it('a dropped queued line reloads the sheet and says the product must be counted again', async () => {
        const dropped = makeSheet();
        const { sheetFn } = renderCount(makeSheet({ lines: makeSheet().lines.map((l) => (l.productId === 1 ? { ...l, counted: true, unit: 'kg', countedQuantity: 4 } : l)) }));
        await screen.findByText('Leche');
        expect(rows()[0]).toHaveAttribute('data-counted', 'true');
        sheetFn.mockResolvedValue(dropped);
        act(() => appEvents.emit('inventory-line-dropped', { sheetId: 7, productId: 1 }));
        expect(await screen.findByRole('alert')).toHaveTextContent('«Leche» no se guardó: hay que contarlo de nuevo.');
        await waitFor(() => expect(rows()[0]).toHaveAttribute('data-counted', 'false'));
        act(() => appEvents.emit('inventory-line-dropped', { sheetId: 99, productId: 2 }));
        expect(screen.getAllByRole('alert')).toHaveLength(1);
    });

    it('Terminar conteo calls onFinish and uncountedOnly lists only what is left', async () => {
        const first = renderCount(makeSheet());
        await screen.findByText('Leche');
        fireEvent.click(screen.getByRole('button', { name: 'Terminar conteo' }));
        expect(first.onFinish).toHaveBeenCalled();
        first.unmount();
        renderCount(makeSheet(), { props: { uncountedOnly: true } });
        await screen.findByText('Leche');
        fireEvent.click(screen.getByRole('button', { name: 'Ver todos' }));
        expect(screen.queryByRole('button', { name: 'Ver todos' })).toBeNull();
    });
});

describe('FinishCountScreen', () => {
    const submitted = { id: 7, status: 'SUBMITTED' as const, counted: 3, notCounted: 1 };
    function renderFinish(o: { pending?: number; submit?: (id: number) => Promise<typeof submitted> } = {}) {
        const pendingLines = vi.fn(() => Promise.resolve(o.pending ?? 0));
        const submit = vi.fn(o.submit ?? (() => Promise.resolve(submitted)));
        const props = { onRecount: vi.fn(), onSubmitted: vi.fn() };
        render(<FinishCountScreen api={{ sheet: () => Promise.resolve(makeSheet()), pendingLines, submit }} sheetId={7} {...props} />);
        return { pendingLines, submit, ...props };
    }
    const send = () => screen.getByRole('button', { name: 'Enviar a revisión' });
    const setOnline = (v: boolean) => {
        Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: v });
        act(() => {
            window.dispatchEvent(new Event(v ? 'online' : 'offline'));
        });
    };
    afterEach(() => setOnline(true));

    it('Terminar shows counted / sin contar; Volver a contarlos returns filtered to uncounted', async () => {
        const { onRecount } = renderFinish();
        await screen.findByTestId('total-counted');
        expect(screen.getByTestId('total-counted')).toHaveTextContent('1');
        expect(screen.getByTestId('total-uncounted')).toHaveTextContent('3');
        expect(screen.getByText('Los productos sin contar no se ajustan')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Volver a contarlos' }));
        expect(onRecount).toHaveBeenCalled();
    });

    it('Enviar a revisión disabled while lines are queued and offline', async () => {
        renderFinish({ pending: 2 });
        await screen.findByText(/Quedan 2 guardados/);
        expect(send()).toBeDisabled();
        cleanup();
        renderFinish();
        await screen.findByTestId('total-counted');
        await waitFor(() => expect(send()).toBeEnabled());
        setOnline(false);
        expect(send()).toBeDisabled();
        expect(screen.getByText(/Sin conexión/)).toBeInTheDocument();
    });

    it('double tap Enviar submits once', async () => {
        let resolve: (v: typeof submitted) => void = () => undefined;
        const submit = vi.fn(() => new Promise<typeof submitted>((r) => (resolve = r)));
        renderFinish({ submit });
        await screen.findByTestId('total-counted');
        await waitFor(() => expect(send()).toBeEnabled());
        fireEvent.click(send());
        fireEvent.click(send());
        expect(submit).toHaveBeenCalledTimes(1);
        resolve(submitted);
    });

    it('submitted goes back to home with En revisión', async () => {
        const { onSubmitted } = renderFinish();
        await screen.findByTestId('total-counted');
        await waitFor(() => expect(send()).toBeEnabled());
        fireEvent.click(send());
        await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(submitted));
    });

    it('a failed submit shows the error and allows trying again', async () => {
        const submit = vi.fn().mockRejectedValueOnce(new OfflineError()).mockResolvedValueOnce(submitted);
        const { onSubmitted } = renderFinish({ submit });
        await screen.findByTestId('total-counted');
        await waitFor(() => expect(send()).toBeEnabled());
        fireEvent.click(send());
        expect(await screen.findByRole('alert')).toHaveTextContent('Requiere conexión');
        fireEvent.click(send());
        await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    });
});
