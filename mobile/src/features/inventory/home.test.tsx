import { readFileSync } from 'node:fs';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { InventoryHome } from './InventoryHome';
import { NewCountScreen } from './NewCountScreen';
import { OfflineError } from './inventoryApi';
import type { CountWarehouse, RecentSheet, WarehouseCategory } from './inventoryTypes';

configure({ asyncUtilTimeout: 5000 });
afterEach(cleanup);

const sheet = (o: Partial<RecentSheet>): RecentSheet => ({
    id: 1,
    warehouseName: 'Bodega Central',
    startedAt: '2026-11-20T15:00:00.000Z',
    startedByName: 'Ana',
    status: 'DRAFT',
    displayStatus: 'EN_CURSO',
    productCount: 40,
    countedCount: 12,
    scopeLabel: 'Todo',
    result: null,
    ...o,
});
const user = { name: 'Ana Perez', color: null };

function renderHome(list: RecentSheet[], extra: Partial<Parameters<typeof InventoryHome>[0]> = {}) {
    const recent = vi.fn(() => Promise.resolve(list));
    const props = { onNew: vi.fn(), onContinue: vi.fn(), onSwitchUser: vi.fn(), ...extra };
    render(<InventoryHome api={{ recent }} user={user} {...props} />);
    return { recent, ...props };
}

describe('InventoryHome', () => {
    it('home shows En curso card with warehouse, start, scope, progress and Continuar', async () => {
        const { onContinue } = renderHome([sheet({ id: 5, scopeLabel: 'Lácteos, Carnes' })]);
        const card = await screen.findByTestId('open-sheet');
        expect(within(card).getByText('Bodega Central')).toBeInTheDocument();
        expect(within(card).getByText(/Inicio .*Lácteos, Carnes/)).toBeInTheDocument();
        expect(within(card).getByText('12 de 40 contados')).toBeInTheDocument();
        fireEvent.click(within(card).getByRole('button', { name: 'Continuar' }));
        expect(onContinue).toHaveBeenCalledWith(5);
    });

    it('recent table filters Todos / En revisión / Aprobados', async () => {
        renderHome([
            sheet({ id: 1, warehouseName: 'Cocina', status: 'SUBMITTED', displayStatus: 'EN_REVISION' }),
            sheet({ id: 2, warehouseName: 'Bar', status: 'APPROVED', displayStatus: 'APROBADO', result: { differences: 0, value: 0 } }),
        ]);
        await screen.findAllByTestId('recent-row');
        expect(screen.getAllByTestId('recent-row')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'En revisión' }));
        expect(screen.getAllByTestId('recent-row').map((r) => r.textContent)).toEqual([expect.stringContaining('Cocina')]);
        fireEvent.click(screen.getByRole('button', { name: 'Aprobados' }));
        expect(screen.getAllByTestId('recent-row').map((r) => r.textContent)).toEqual([expect.stringContaining('Bar')]);
        fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
        expect(screen.getAllByTestId('recent-row')).toHaveLength(2);
    });

    it('recent result shows Sin diferencias, N diferencias · value, N a recontar, and — while in review', async () => {
        renderHome([
            sheet({ id: 1, warehouseName: 'A', status: 'APPROVED', displayStatus: 'APROBADO', result: { differences: 0, value: 0 } }),
            sheet({ id: 2, warehouseName: 'B', status: 'APPROVED', displayStatus: 'APROBADO', result: { differences: 3, value: 1250 } }),
            sheet({ id: 3, warehouseName: 'C', status: 'SUBMITTED', displayStatus: 'EN_REVISION', result: null }),
        ]);
        const rows = await screen.findAllByTestId('recent-row');
        expect(rows[0]).toHaveTextContent('Sin diferencias');
        expect(rows[1]).toHaveTextContent(/3 diferencias · C\$\s?1,250/);
        expect(rows[2].querySelectorAll('td')[3].textContent).toBe('—');
    });

    it('Devuelto sheet appears as En curso with Recontar count', async () => {
        renderHome([sheet({ id: 9, displayStatus: 'DEVUELTO', result: { recount: 4 } })]);
        const card = await screen.findByTestId('open-sheet');
        expect(within(card).getByText('Devuelto')).toBeInTheDocument();
        expect(within(card).getByText(/4 a recontar/)).toBeInTheDocument();
        expect(within(card).getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
        expect(screen.getByTestId('recent-row')).toHaveTextContent('4 a recontar');
    });

    it('load error shows inline retry, never an empty list', async () => {
        const recent = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce([sheet({ warehouseName: 'Bar' })]);
        render(<InventoryHome api={{ recent }} user={user} onNew={vi.fn()} onContinue={vi.fn()} onSwitchUser={vi.fn()} />);
        await screen.findByRole('alert');
        expect(screen.queryByText('Sin conteos.')).toBeNull();
        expect(screen.queryByRole('table')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        await screen.findByTestId('open-sheet');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('recent table has Bodega, Fecha · quién, Productos, Resultado, Estado and no Alcance', async () => {
        renderHome([sheet({ id: 2, status: 'APPROVED', displayStatus: 'APROBADO', startedByName: 'Luis', productCount: 33, result: { differences: 1, value: 20 } })]);
        const row = await screen.findByTestId('recent-row');
        expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Bodega', 'Fecha · quién', 'Productos', 'Resultado', 'Estado']);
        expect(row.querySelectorAll('td')[1].textContent).toMatch(/· Luis$/);
        expect(row.querySelectorAll('td')[2].textContent).toBe('33');
        expect(row).toHaveTextContent(/1 diferencias · C\$\s?20/);
    });

    it('En curso card has a progress bar', async () => {
        renderHome([sheet({ productCount: 40, countedCount: 10 })]);
        const bar = await screen.findByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '10');
        expect(bar).toHaveAttribute('aria-valuemax', '40');
        expect((bar.firstChild as HTMLElement).style.width).toBe('25%');
    });

    it('header: Nuevo conteo, lock, and Mesas only with onBack', async () => {
        const a = renderHome([]);
        await screen.findByText('Sin conteos.');
        fireEvent.click(screen.getByRole('button', { name: 'Nuevo conteo' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cambiar usuario' }));
        expect(a.onNew).toHaveBeenCalled();
        expect(a.onSwitchUser).toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Mesas' })).toBeNull();
        cleanup();
        const b = renderHome([], { onBack: vi.fn() });
        await screen.findByText('Sin conteos.');
        fireEvent.click(screen.getByRole('button', { name: 'Mesas' }));
        expect(b.onBack).toHaveBeenCalled();
    });
});

const wh = (o: Partial<CountWarehouse>): CountWarehouse => ({ id: 1, name: 'Bodega Central', type: 'CENTRAL', productCount: 40, lastCountAt: null, openSheet: null, ...o });
const cats: WarehouseCategory[] = [
    { categoryId: 1, name: 'Lácteos', productCount: 10 },
    { categoryId: 2, name: 'Carnes', productCount: 20 },
    { categoryId: null, name: 'Sin categoría', productCount: 5 },
];

function renderNew(warehouses: CountWarehouse[], start = vi.fn().mockResolvedValue({ id: 77, status: 'DRAFT', warehouseId: 1, productCount: 40 })) {
    const api = { warehouses: vi.fn().mockResolvedValue(warehouses), categories: vi.fn().mockResolvedValue(cats), start };
    const onStarted = vi.fn();
    const onBack = vi.fn();
    render(<NewCountScreen api={api} onStarted={onStarted} onBack={onBack} />);
    return { api, onStarted, onBack };
}

describe('NewCountScreen', () => {
    it('warehouse in review is disabled; with a draft it offers Continuar', async () => {
        const { onStarted } = renderNew([wh({ id: 1, name: 'Cocina', openSheet: { id: 3, status: 'SUBMITTED' } }), wh({ id: 2, name: 'Bar', openSheet: { id: 8, status: 'DRAFT' } })]);
        const cocina = await screen.findByRole('button', { name: /Cocina/ });
        expect(cocina).toBeDisabled();
        expect(within(cocina).getByText('En revisión')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
        expect(onStarted).toHaveBeenCalledWith(8);
        expect(screen.getByRole('button', { name: 'Iniciar conteo' })).toBeDisabled();
    });

    it('Todo selects whole warehouse; Elegir categorías shows 3-column grid with Seleccionar todas and N categorías · N productos', async () => {
        const { api } = renderNew([wh({})]);
        fireEvent.click(await screen.findByRole('button', { name: /Bodega Central/ }));
        expect(screen.getByRole('button', { name: 'Todo' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Iniciar conteo' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Elegir categorías' }));
        const grid = await screen.findByTestId('category-grid');
        expect(api.categories).toHaveBeenCalledWith(1);
        expect(within(grid).getAllByRole('checkbox')).toHaveLength(3);
        expect(screen.getByRole('button', { name: 'Seleccionar todas' })).toBeInTheDocument();
        expect(screen.getByText('3 categorías · 35 productos')).toBeInTheDocument();
        fireEvent.click(within(grid).getByRole('checkbox', { name: /Carnes/ }));
        expect(screen.getByText('2 categorías · 15 productos')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Seleccionar todas' }));
        expect(screen.getByText('3 categorías · 35 productos')).toBeInTheDocument();
        expect(screen.getByText('Conteo ciego')).toBeInTheDocument();
    });

    it('starts with Todo omitting categories', async () => {
        const { api, onStarted } = renderNew([wh({})]);
        fireEvent.click(await screen.findByRole('button', { name: /Bodega Central/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar conteo' }));
        await waitFor(() => expect(onStarted).toHaveBeenCalledWith(77));
        expect(api.start).toHaveBeenLastCalledWith({ warehouseId: 1, categoryIds: null });
    });

    it('starts with a chosen subset (null = Sin categoría)', async () => {
        const { api, onStarted } = renderNew([wh({})]);
        fireEvent.click(await screen.findByRole('button', { name: /Bodega Central/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Elegir categorías' }));
        const grid = await screen.findByTestId('category-grid');
        fireEvent.click(within(grid).getByRole('checkbox', { name: /Lácteos/ }));
        fireEvent.click(within(grid).getByRole('checkbox', { name: /Carnes/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar conteo' }));
        await waitFor(() => expect(onStarted).toHaveBeenCalledWith(77));
        expect(api.start).toHaveBeenCalledWith({ warehouseId: 1, categoryIds: [null] });
    });

    it('warehouse cards show icon, product count and last count date', async () => {
        renderNew([wh({ lastCountAt: '2026-11-10T12:00:00.000Z' }), wh({ id: 2, name: 'Bar', lastCountAt: null })]);
        const card = await screen.findByRole('button', { name: /Bodega Central/ });
        expect(card).toHaveTextContent('40 productos');
        expect(card).toHaveTextContent(/Último conteo .*2026/);
        expect(card.querySelector('.inv-wh-icon')).not.toBeNull();
        expect(screen.getByRole('button', { name: /Bar/ })).toHaveTextContent('Sin conteos');
    });

    it('category cells show a visible checkbox state', async () => {
        renderNew([wh({})]);
        fireEvent.click(await screen.findByRole('button', { name: /Bodega Central/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Elegir categorías' }));
        const grid = await screen.findByTestId('category-grid');
        const carnes = within(grid).getByRole('checkbox', { name: /Carnes/ });
        expect(carnes).toHaveAttribute('aria-checked', 'true');
        expect(carnes.querySelector('.inv-check')).toHaveTextContent('✓');
        fireEvent.click(carnes);
        expect(carnes).toHaveAttribute('aria-checked', 'false');
        expect(carnes.querySelector('.inv-check')).toHaveTextContent('');
    });

    it('compact layout: choices scroll on their own and the summary with Iniciar conteo stays out of that scroll', async () => {
        renderNew([wh({})]);
        const button = await screen.findByRole('button', { name: 'Iniciar conteo' });
        const aside = button.closest('aside') as HTMLElement;
        const main = document.querySelector('.inv-new-main') as HTMLElement;
        expect(aside.parentElement).toBe(main.parentElement);
        expect(main.contains(aside)).toBe(false);
        expect(main.parentElement).toHaveClass('inv-body', 'inv-new');
        const css = readFileSync('src/features/inventory/inventory.css', 'utf8');
        const rule = (sel: string) => css.match(new RegExp(`\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
        expect(rule('.inv-new')).toMatch(/overflow:\s*hidden/);
        expect(rule('.inv-new-main')).toMatch(/overflow-y:\s*auto/);
        expect(rule('.inv-summary')).toMatch(/flex:\s*none/);
        expect(css).toMatch(/@media \(max-height: 520px\)/);
    });

    it('Iniciar conteo disabled with zero categories', async () => {
        renderNew([wh({})]);
        fireEvent.click(await screen.findByRole('button', { name: /Bodega Central/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Elegir categorías' }));
        const grid = await screen.findByTestId('category-grid');
        for (const b of within(grid).getAllByRole('checkbox')) fireEvent.click(b);
        expect(screen.getByText('0 categorías · 0 productos')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Iniciar conteo' })).toBeDisabled();
    });

    it('WAREHOUSE_BUSY on start opens the existing sheet', async () => {
        const busy = Object.assign(new Error('busy'), { response: { status: 409, data: { code: 'INVENTORY_COUNT_WAREHOUSE_BUSY', details: { sheetId: 31 } } } });
        const { onStarted } = renderNew([wh({})], vi.fn().mockRejectedValue(busy));
        fireEvent.click(await screen.findByRole('button', { name: /Bodega Central/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar conteo' }));
        await waitFor(() => expect(onStarted).toHaveBeenCalledWith(31));
    });

    it('offline start shows a message and keeps the screen usable', async () => {
        const { onStarted } = renderNew([wh({})], vi.fn().mockRejectedValue(new OfflineError()));
        fireEvent.click(await screen.findByRole('button', { name: /Bodega Central/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Iniciar conteo' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Requiere conexión');
        expect(onStarted).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Iniciar conteo' })).toBeEnabled();
    });

    it('load error shows inline retry, never an empty list', async () => {
        const api = { warehouses: vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce([wh({})]), categories: vi.fn(), start: vi.fn() };
        render(<NewCountScreen api={api} onStarted={vi.fn()} onBack={vi.fn()} />);
        await screen.findByRole('alert');
        expect(screen.queryByRole('button', { name: /Bodega Central/ })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByRole('button', { name: /Bodega Central/ })).toBeInTheDocument();
    });
});
