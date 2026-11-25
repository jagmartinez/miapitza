// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ok = <T,>(data: T) => Promise.resolve({ data: { data } });

const mocks = vi.hoisted(() => ({
    purchaseOrdersAPI: {
        getAll: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(),
        getPayments: vi.fn(), addPayment: vi.fn(), reversePayment: vi.fn(), reverseReceipt: vi.fn(), receive: vi.fn(),
        delete: vi.fn(), getInvoice: vi.fn(), getImportTemplate: vi.fn(), validateImport: vi.fn(), confirmImport: vi.fn(),
    },
    autoPurchaseOrdersAPI: { createFromSuggestions: vi.fn() },
    suppliersAPI: { getAll: vi.fn() },
    productsAPI: { getAll: vi.fn() },
    branchesAPI: { getAll: vi.fn() },
    warehousesAPI: { getAll: vi.fn() },
    unitsAPI: { getProductUnits: vi.fn() },
    ordersAPI: { getAll: vi.fn(), getById: vi.fn() },
    invoicesAPI: {},
    settingsAPI: { getAll: vi.fn() },
    paymentsAPI: { getByOrderId: vi.fn() },
    api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../services/api', () => ({
    default: mocks.api,
    purchaseOrdersAPI: mocks.purchaseOrdersAPI,
    autoPurchaseOrdersAPI: mocks.autoPurchaseOrdersAPI,
    suppliersAPI: mocks.suppliersAPI,
    productsAPI: mocks.productsAPI,
    branchesAPI: mocks.branchesAPI,
    warehousesAPI: mocks.warehousesAPI,
    unitsAPI: mocks.unitsAPI,
    ordersAPI: mocks.ordersAPI,
    invoicesAPI: mocks.invoicesAPI,
    settingsAPI: mocks.settingsAPI,
    paymentsAPI: mocks.paymentsAPI,
}));
vi.mock('../hooks/useAuth', () => ({
    useAuth: () => ({ user: { id: 1, name: 'Admin', roles: ['ADMIN'] } }),
}));
vi.mock('../context/ConfirmContext', () => ({
    useConfirmDialog: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('../context/ToastContext', () => ({
    useAppToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

import PurchaseOrders from './PurchaseOrders';
import PurchaseOrderForm from './PurchaseOrderForm';
import PurchaseOrderImport from '../components/PurchaseOrderImport';
import InvoiceHistory from './InvoiceHistory';
import BankReconciliation from './BankReconciliation';

const today = new Date();
const isoDay = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return d.toISOString();
};

const orders = [
    { id: 11, branchId: 1, supplierId: 1, date: isoDay(-2), status: 'ISSUED', total: 1234.5, invoiceType: 'CASH', supplier: { id: 1, name: 'Proveedor Uno' } },
    {
        id: 12, branchId: 1, supplierId: 1, date: isoDay(-3), status: 'RECEIVED', total: 800, invoiceType: 'CREDIT', paidAmount: 300,
        paymentStatus: 'PARTIAL', paymentDueDate: isoDay(-5), supplier: { id: 1, name: 'Proveedor Uno' },
    },
];

const renderInRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

const noNativeControls = () => {
    expect(document.querySelector('select')).toBeNull();
    document.querySelectorAll('table').forEach((t) => expect(t).toHaveClass('ui-table'));
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.api.get.mockImplementation((url: string) => {
        if (url === '/settings') return ok({ currency_symbol: 'C$' });
        if (url.startsWith('/advanced/reconciliation/pending')) return ok([
            { shiftId: 5, date: isoDay(-1), cashRegister: 'Caja 1', user: 'Ana', startAmount: 100, endAmount: 1234.5, difference: 0, status: 'BALANCED' },
        ]);
        if (url.startsWith('/advanced/reconciliation/deposits')) return ok([]);
        if (url.startsWith('/advanced/reconciliation')) return ok({
            period: { start: isoDay(-7), end: isoDay(0) }, shifts: 3,
            totals: { totalSales: 5000, byMethod: { cash: 1234.5, card: 2000, transfer: 1000, other: 765.5 }, cashInRegisters: 1500 },
            reconciliation: { cashExpected: 1500, cashActual: 1400, difference: -100, status: 'PENDING' },
        });
        return ok({});
    });
    mocks.purchaseOrdersAPI.getAll.mockReturnValue(ok(orders));
    mocks.suppliersAPI.getAll.mockReturnValue(ok([{ id: 1, name: 'Proveedor Uno' }]));
    mocks.branchesAPI.getAll.mockReturnValue(ok([{ id: 1, name: 'Sucursal Central' }]));
    mocks.warehousesAPI.getAll.mockReturnValue(ok([]));
    mocks.productsAPI.getAll.mockReturnValue(ok([
        { id: 101, name: 'Harina', unit: 'kg' },
        { id: 102, name: 'Aceite', unit: 'l' },
        { id: 103, name: 'Sal', unit: 'kg' },
    ]));
    mocks.unitsAPI.getProductUnits.mockReturnValue(ok([]));
    mocks.settingsAPI.getAll.mockReturnValue(ok({ currency_symbol: 'C$' }));
    mocks.ordersAPI.getAll.mockReturnValue(ok([
        {
            id: 7, invoiceNumber: 'F-0007', invoicedAt: isoDay(-1), createdAt: isoDay(-1), total: 1234.5, status: 'DELIVERED',
            financialStatus: 'PAID', branchId: 1, invoiceFiscalStatus: 'ISSUED', user: { name: 'Mesero' },
            payments: [{ status: 'ACTIVE', paymentMethod: { name: 'Efectivo', type: 'CASH' } }],
        },
    ]));
});

describe('Compras: PurchaseOrders', () => {
    it('usa PageHeader, DataTable con importes a la derecha y tarjetas con contexto', async () => {
        renderInRouter(<PurchaseOrders />);
        expect(await screen.findByRole('heading', { level: 1, name: 'Órdenes de Compra' })).toHaveClass('ui-pageheader__title');
        const table = await screen.findByRole('table', { name: 'Órdenes de compra' });
        expect(table).toHaveClass('ui-table');
        const money = within(table).getByText('1,234.50');
        expect(money).toHaveClass('ui-cell--numeric');
        // Tarjeta de comprometido: valor + contexto (nunca un conteo suelto).
        const card = screen.getByRole('region', { name: 'Comprometido sin recibir' });
        expect(within(card).getByText('C$ 1,234.50')).toBeInTheDocument();
        expect(within(card).getByText(/1 órdenes emitidas/)).toBeInTheDocument();
        const payable = screen.getByRole('region', { name: 'Por pagar a proveedores' });
        expect(within(payable).getByText('C$ 500.00')).toBeInTheDocument();
        noNativeControls();
    });

    it('muestra aviso con reintento si la carga falla y no inventa ceros', async () => {
        mocks.purchaseOrdersAPI.getAll.mockReturnValueOnce(Promise.reject(new Error('boom')));
        renderInRouter(<PurchaseOrders />);
        expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudieron cargar las órdenes/);
        expect(screen.queryByRole('region', { name: 'Comprometido sin recibir' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('abre el formulario de orden en un FullScreenModal', async () => {
        renderInRouter(<PurchaseOrders />);
        await userEvent.click(await screen.findByRole('button', { name: /Nueva orden/ }));
        const dialog = await screen.findByRole('dialog', { name: 'Nueva Orden de Compra' });
        expect(dialog).toHaveClass('ui-fsm');
        expect(within(dialog).getByRole('tab', { name: 'Datos y productos' })).toBeInTheDocument();
        expect(within(dialog).getByRole('tab', { name: 'Recepción' })).toBeInTheDocument();
        expect(within(dialog).getByRole('tab', { name: 'Adjuntos' })).toBeInTheDocument();
        expect(within(dialog).getByRole('tab', { name: 'Historial' })).toBeInTheDocument();
    });
});

describe('Compras: PurchaseOrderForm', () => {
    const pick = async (inputId: string, text: string) => {
        const input = document.getElementById(inputId) as HTMLInputElement;
        await userEvent.click(input);
        await userEvent.type(input, text);
        await userEvent.keyboard('{Enter}');
    };

    it('envía el mismo cuerpo que antes para una orden de 3 líneas', async () => {
        mocks.purchaseOrdersAPI.create.mockReturnValue(ok({ id: 99 }));
        const onSaved = vi.fn();
        renderInRouter(<PurchaseOrderForm onClose={vi.fn()} onSaved={onSaved} />);
        await screen.findByRole('dialog');
        await waitFor(() => expect(mocks.productsAPI.getAll).toHaveBeenCalled());

        await pick('po-supplier', 'Proveedor');
        const lines: Array<[string, string, string]> = [['Harina', '2', '10.5'], ['Aceite', '3', '4'], ['Sal', '1', '2.25']];
        for (const [name, qty, cost] of lines) {
            await pick('po-item-product', name);
            fireEvent.change(document.getElementById('po-item-quantity') as HTMLInputElement, { target: { value: qty } });
            fireEvent.change(document.getElementById('po-item-cost') as HTMLInputElement, { target: { value: cost } });
            await userEvent.click(screen.getByRole('button', { name: /Agregar ítem/ }));
        }
        const table = screen.getByRole('table', { name: 'Ítems de la orden' });
        expect(within(table).getAllByRole('row')).toHaveLength(4); // encabezado + 3 líneas
        // Resumen lateral: 2×10.5 + 3×4 + 1×2.25
        expect(screen.getAllByText('C$ 35.25').length).toBeGreaterThan(0);

        await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        await waitFor(() => expect(mocks.purchaseOrdersAPI.create).toHaveBeenCalledTimes(1));

        const body = mocks.purchaseOrdersAPI.create.mock.calls[0][0] as FormData;
        const entries = Object.fromEntries(Array.from(body.entries()).map(([k, v]) => [k, typeof v === 'string' ? v : 'FILE']));
        expect(entries).toEqual({
            branchId: '1',
            supplierId: '1',
            notes: '',
            invoiceNumber: '',
            invoiceDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            invoiceType: 'CASH',
            bank: '',
            transferNumber: '',
            items: JSON.stringify([
                { productId: 101, quantity: 2, cost: 10.5 },
                { productId: 102, quantity: 3, cost: 4 },
                { productId: 103, quantity: 1, cost: 2.25 },
            ]),
        });
        expect(onSaved).toHaveBeenCalled();
    });

    it('no deja pasar una orden sin ítems', async () => {
        renderInRouter(<PurchaseOrderForm onClose={vi.fn()} onSaved={vi.fn()} />);
        await screen.findByRole('dialog');
        await pick('po-supplier', 'Proveedor');
        await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        expect(mocks.purchaseOrdersAPI.create).not.toHaveBeenCalled();
    });
});

describe('Compras: PurchaseOrderImport', () => {
    it('abre en un FullScreenModal con pasos y sin controles nativos', async () => {
        render(<PurchaseOrderImport onClose={vi.fn()} onSaved={vi.fn()} settings={{}} />);
        const dialog = await screen.findByRole('dialog', { name: 'Carga Masiva desde Excel' });
        expect(dialog).toHaveClass('ui-fsm');
        expect(within(dialog).getByText(/Paso 1 de 3/)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Procesar Archivo' })).toBeDisabled();
        noNativeControls();
    });

    it('la vista previa es un DataTable con importes formateados', async () => {
        mocks.purchaseOrdersAPI.validateImport.mockReturnValue(ok({
            items: [{
                rowNumber: 2, sku: 'H-1', name: 'Harina', productId: 101, unit: 'kg', purchaseUnit: null,
                quantity: 2, unitCost: 1234.5, total: 2469, errors: [], isValid: true,
            }],
            summary: { valid: 1, invalid: 0, totalRows: 1, totalCost: 2469 },
        }));
        render(<PurchaseOrderImport onClose={vi.fn()} onSaved={vi.fn()} settings={{}} />);
        const input = await screen.findByLabelText('Archivo Excel');
        await userEvent.upload(input, new File(['x'], 'ordenes.xlsx'));
        await userEvent.click(screen.getByRole('button', { name: 'Procesar Archivo' }));
        const table = await screen.findByRole('table', { name: 'Vista previa de la importación' });
        expect(within(table).getByText('1,234.50')).toHaveClass('ui-cell--numeric');
        expect(within(table).getByText('2,469.00')).toBeInTheDocument();
    });
});

describe('Compras: InvoiceHistory', () => {
    it('usa PageHeader y DataTable paginada con total alineado a la derecha', async () => {
        renderInRouter(<InvoiceHistory />);
        expect(await screen.findByRole('heading', { level: 1, name: 'Historial de Facturas' })).toHaveClass('ui-pageheader__title');
        const table = await screen.findByRole('table', { name: 'Facturas' });
        expect(within(table).getByText('1,234.50')).toHaveClass('ui-cell--numeric');
        expect(screen.getByText('1–1 de 1')).toBeInTheDocument();
        noNativeControls();
    });

    it('avisa con reintento si no pudo cargar las facturas', async () => {
        mocks.ordersAPI.getAll.mockReturnValueOnce(Promise.reject(new Error('boom')));
        renderInRouter(<InvoiceHistory />);
        expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudieron cargar las facturas/);
        expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    });
});

describe('Compras: BankReconciliation', () => {
    it('usa PageHeader, tabs, tarjetas con contexto y tablas del design system', async () => {
        renderInRouter(<BankReconciliation />);
        expect(await screen.findByRole('heading', { level: 1, name: 'Conciliación Bancaria' })).toHaveClass('ui-pageheader__title');
        expect(screen.getByRole('tablist', { name: 'Secciones de conciliación' })).toBeInTheDocument();
        const diff = await screen.findByRole('region', { name: 'Diferencia de efectivo' });
        expect(within(diff).getByText('-C$ 100.00')).toBeInTheDocument();
        expect(within(diff).getByText(/Faltante/)).toBeInTheDocument();
        const methods = await screen.findByRole('table', { name: 'Ventas por método de pago' });
        expect(within(methods).getByText('2,000.00')).toHaveClass('ui-cell--numeric');
        noNativeControls();
    });

    it('el formulario de depósito abre en FullScreenModal y exige monto', async () => {
        renderInRouter(<BankReconciliation />);
        await userEvent.click(await screen.findByRole('button', { name: /Registrar depósito/ }));
        const dialog = await screen.findByRole('dialog', { name: 'Registrar depósito bancario' });
        expect(dialog).toHaveClass('ui-fsm');
        fireEvent.change(within(dialog).getByLabelText(/Cuenta bancaria/), { target: { value: 'BAC 1' } });
        fireEvent.change(within(dialog).getByLabelText(/Referencia/), { target: { value: 'B-1' } });
        await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar depósito' }));
        expect(mocks.api.post).not.toHaveBeenCalled();
    });

    it('un turno pendiente se puede seleccionar y la tabla es DataTable', async () => {
        renderInRouter(<BankReconciliation />);
        await userEvent.click(await screen.findByRole('tab', { name: /Pendientes/ }));
        const table = await screen.findByRole('table', { name: 'Turnos pendientes de conciliación' });
        expect(within(table).getByText('1,234.50')).toHaveClass('ui-cell--numeric');
        await userEvent.click(within(table).getByRole('checkbox', { name: 'Seleccionar turno 5' }));
        expect(screen.getByRole('button', { name: /Marcar 1 como conciliado/ })).toBeInTheDocument();
    });
});
