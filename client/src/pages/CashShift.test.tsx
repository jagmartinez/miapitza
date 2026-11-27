// @vitest-environment jsdom
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CashShiftPage from './CashShift';
import cashShiftSource from './CashShift.tsx?raw';

const mocks = vi.hoisted(() => ({
    roles: ['CAJERO'] as string[],
    getById: vi.fn(),
    getSummary: vi.fn(),
    getDetails: vi.fn(),
    previewClose: vi.fn(),
    closeShift: vi.fn(),
    addMovement: vi.fn(),
    suppliersGetAll: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
}));

vi.mock('../services/api', () => ({
    cashShiftsAPI: {
        getById: mocks.getById,
        getSummary: mocks.getSummary,
        addMovement: mocks.addMovement,
    },
    cashArqueoAPI: {
        getDetails: mocks.getDetails,
        previewClose: mocks.previewClose,
        closeShift: mocks.closeShift,
        getReport: vi.fn(),
    },
    suppliersAPI: { getAll: mocks.suppliersGetAll, create: vi.fn() },
}));
vi.mock('../hooks/useAuth', () => ({
    useAuth: () => ({ user: { id: 1, name: 'Ana', roles: mocks.roles } }),
}));
vi.mock('../context/ToastContext', () => ({
    useAppToast: () => ({ error: mocks.error, warning: mocks.warning, success: mocks.success }),
}));

function makeMovements(n: number) {
    return Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        shiftId: 7,
        type: i % 2 === 0 ? 'IN' : 'OUT',
        amount: 1234.5 + i,
        description: `Movimiento ${i + 1}`,
        createdAt: '2026-11-20T15:00:00.000Z',
    }));
}

function setup({ open = true, movements = makeMovements(30) } = {}) {
    mocks.getById.mockResolvedValue({
        data: {
            data: {
                id: 7,
                cashRegisterId: 1,
                userId: 1,
                startDate: '2026-11-20T14:00:00.000Z',
                endDate: open ? null : '2026-11-20T22:00:00.000Z',
                startAmount: 1000,
                endAmount: open ? undefined : 4650,
                difference: open ? undefined : -350,
                register: { id: 1, name: 'Caja 1' },
                user: { id: 1, name: 'Ana' },
                movements,
            },
        },
    });
    mocks.getSummary.mockResolvedValue({
        data: { data: { summary: { expectedAmount: 5000, totalIn: 4000, totalOut: 0, totalSalesCash: 3500, grossSalesCash: 3500, cashRefunds: 0, salesByMethod: { cash: 3500, card: 1200.5, transfer: 300, paymentCount: 9 } } } },
    });
    mocks.getDetails.mockResolvedValue({ data: { data: { counts: { bills: [], coins: [] } } } });
    return render(
        <MemoryRouter initialEntries={['/cash-shifts/7']}>
            <Routes>
                <Route path="/cash-shifts/:id" element={<CashShiftPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('CashShift (migrado al design system)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.roles = ['CAJERO'];
    });

    it('usa PageHeader, arqueo en la página y DataTable paginada de 25 filas', async () => {
        setup();
        expect(await screen.findByRole('heading', { level: 1, name: 'Arqueo y cierre de turno' })).toHaveClass('ui-pageheader__title');
        expect(screen.getByText('Caja / Turno #7')).toBeInTheDocument();
        // El conteo por denominación vive en la página (no en un modal) y no hay tarjetas KPI triviales.
        expect(screen.getByRole('table', { name: 'Denominaciones' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(document.querySelector('.ui-statcard')).toBeNull();
        const table = screen.getByRole('table', { name: 'Movimientos del turno' });
        // 1 encabezado + 25 filas
        expect(within(table).getAllByRole('row')).toHaveLength(26);
        expect(screen.getByRole('navigation', { name: /Paginación de Movimientos del turno/ })).toBeInTheDocument();
        // montos alineados a la derecha con formato 1,234.50
        const firstAmount = within(table).getAllByRole('row')[1].querySelector('.ui-cell--numeric');
        expect(firstAmount?.textContent).toMatch(/\+\s?C\$\s1,234\.50/);
    });

    it('muestra las ventas del turno por medio de pago desde salesByMethod', async () => {
        setup({ movements: makeMovements(2) });
        const sales = await screen.findByRole('region', { name: 'Ventas del turno por medio de pago' });
        expect(sales).toHaveTextContent('C$ 5,000.50');
        expect(sales).toHaveTextContent('Tarjeta');
        expect(sales).toHaveTextContent('C$ 1,200.50');
        expect(sales).toHaveTextContent('Transferencia');
    });

    it('filtra por tipo y busca sin salir de la tabla', async () => {
        setup({ movements: makeMovements(4) });
        await screen.findByRole('table', { name: 'Movimientos del turno' });
        await userEvent.click(screen.getByRole('tab', { name: /Egresos/ }));
        const table = screen.getByRole('table', { name: 'Movimientos del turno' });
        expect(within(table).getAllByRole('row')).toHaveLength(3);
        await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'Movimiento 2');
        expect(within(table).getAllByRole('row')).toHaveLength(2);
    });

    it('el ingreso/retiro abre un FullScreenModal con el mismo payload', async () => {
        mocks.addMovement.mockResolvedValue({});
        mocks.suppliersGetAll.mockResolvedValue({ data: { data: [{ id: 9, name: 'Proveedor Uno' }] } });
        setup({ movements: makeMovements(2) });
        await userEvent.click(await screen.findByRole('button', { name: /Retiro/ }));
        const dlg = await screen.findByRole('dialog', { name: 'Registrar Retiro' });
        expect(dlg).toHaveClass('ui-fsm');
        await userEvent.type(within(dlg).getByLabelText(/^Monto/), '150.25');
        await userEvent.type(within(dlg).getByLabelText(/^Descripción/), 'Compra de hielo');
        await userEvent.click(within(dlg).getByRole('button', { name: 'Registrar Retiro' }));
        await waitFor(() => expect(mocks.addMovement).toHaveBeenCalledTimes(1));
        expect(mocks.addMovement).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'OUT', amount: 150.25, description: 'Compra de hielo' }), expect.any(String));
        const payload = mocks.addMovement.mock.calls[0][1];
        expect(payload.supplierId).toBeUndefined();
    });

    it('diferencia -350 con tolerancia 50: el cajero no puede cerrar, necesita supervisor', async () => {
        mocks.previewClose.mockResolvedValue({
            data: { data: { difference: -350, tolerance: 50, requiresNote: false, exceedsTolerance: true, expectedAmount: 5000 } },
        });
        setup();
        // sin validar, el cierre está deshabilitado
        expect(await screen.findByRole('button', { name: 'Cerrar turno' })).toBeDisabled();
        const dlg = screen.getByRole('region', { name: /Conciliación de efectivo/ });
        await userEvent.click(within(dlg).getByRole('button', { name: 'Validar arqueo' }));
        expect(await within(dlg).findByText(/excede la tolerancia oficial de C\$ 50\.00/)).toBeInTheDocument();
        expect(within(dlg).getAllByText(/supervisor/i).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: 'Cerrar turno' })).toBeDisabled();
        expect(mocks.closeShift).not.toHaveBeenCalled();
    });

    it('administrador: fuerza el cierre solo con observación', async () => {
        mocks.roles = ['ADMIN'];
        mocks.previewClose.mockResolvedValue({
            data: { data: { difference: -350, tolerance: 50, requiresNote: false, exceedsTolerance: true, expectedAmount: 5000 } },
        });
        mocks.closeShift.mockResolvedValue({});
        setup();
        const dlg = await screen.findByRole('region', { name: /Conciliación de efectivo/ });
        await userEvent.click(within(dlg).getByRole('button', { name: 'Validar arqueo' }));
        const force = await screen.findByRole('button', { name: 'Forzar cierre' });
        expect(force).toBeDisabled();
        await userEvent.type(within(dlg).getByLabelText('Observaciones'), 'Faltante autorizado');
        expect(force).toBeEnabled();
        await userEvent.click(force);
        await waitFor(() => expect(mocks.closeShift).toHaveBeenCalledTimes(1));
        expect(mocks.closeShift.mock.calls[0][1]).toMatchObject({ forceClose: true, notes: 'Faltante autorizado' });
    });

    it('conteo por denominación suma billetes y monedas en el payload de validación', async () => {
        mocks.previewClose.mockResolvedValue({ data: { data: { difference: 0, tolerance: 50, expectedAmount: 5000 } } });
        setup();
        const dlg = await screen.findByRole('form', { name: 'Arqueo de caja' });
        await userEvent.type(within(dlg).getByLabelText('Cantidad de billetes de C$ 1000'), '2');
        await userEvent.type(within(dlg).getByLabelText('Cantidad de monedas de C$ 0.5'), '3');
        await userEvent.click(within(dlg).getByRole('button', { name: 'Validar arqueo' }));
        await waitFor(() => expect(mocks.previewClose).toHaveBeenCalledTimes(1));
        expect(mocks.previewClose.mock.calls[0][1]).toMatchObject({ endAmount: 2001.5 });
    });

    it('si falla la carga muestra aviso con reintento en lugar de datos en cero', async () => {
        mocks.getById.mockRejectedValue(new Error('boom'));
        mocks.getSummary.mockResolvedValue({ data: { data: { summary: {} } } });
        mocks.getDetails.mockResolvedValue({ data: { data: {} } });
        render(
            <MemoryRouter initialEntries={['/cash-shifts/7']}>
                <Routes>
                    <Route path="/cash-shifts/:id" element={<CashShiftPage />} />
                </Routes>
            </MemoryRouter>,
        );
        expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
        expect(screen.getByText(/No disponible/)).toBeInTheDocument();
    });

    it('no conserva controles heredados', () => {
        expect(cashShiftSource).not.toMatch(/<table[\s>]/);
        expect(cashShiftSource).not.toMatch(/<select[\s>]/);
        expect(cashShiftSource).not.toMatch(/from '..\/components\/(Sidebar|Select|Card|Pagination)'/);
        expect(cashShiftSource).toContain('FullScreenModal');
        expect(cashShiftSource).toContain('PageHeader');
        expect(cashShiftSource).toContain('AppSelect');
    });
});
