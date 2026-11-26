// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const { activeOrders, tableRows } = vi.hoisted(() => ({ activeOrders: vi.fn(), tableRows: [
    { id: 1, number: '1', capacity: 4, status: 'OCCUPIED', branchId: 1, location: 'Terraza', branch: { id: 1, name: 'Centro' } },
    { id: 2, number: '2', capacity: 2, status: 'AVAILABLE', branchId: 1, branch: { id: 1, name: 'Centro' } },
] }));
vi.mock('../services/api', () => ({
    tablesAPI: {
        getAll: vi.fn().mockResolvedValue({ data: { data: tableRows } }),
        getFloorPlan: vi.fn().mockResolvedValue({ data: { data: { id: 1, areas: [], tables: [] } } }),
        getActiveConsolidation: vi.fn().mockResolvedValue({ data: { data: null } }),
    },
    ordersAPI: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }), getById: vi.fn(), getActive: (...a: unknown[]) => activeOrders(...a) },
    reservationsAPI: { getUpcoming: vi.fn().mockResolvedValue({ data: { data: [] } }) },
    branchesAPI: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) },
    invoicesAPI: {},
    cashShiftsAPI: {},
}));
const auth = vi.hoisted(() => ({ user: { id: 1, branchId: 1, roles: [{ name: 'ADMIN' }], role: { name: 'ADMIN' } } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
const toast = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useAppToast: () => toast }));
const confirmCtx = vi.hoisted(() => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../context/ConfirmContext', () => ({ useConfirmDialog: () => confirmCtx }));
vi.mock('../hooks/useCurrency', () => ({ useCurrency: () => ({ symbol: 'C$', formatMoney: (n: number) => String(n) }) }));
vi.mock('../utils/websocket', () => ({ initializeWebSocket: vi.fn(), subscribeWebSocket: () => () => undefined, WS_EVENTS: {} }));
vi.mock('./POS', () => ({ default: () => null }));
vi.mock('../components/PaymentModal', () => ({ default: () => null }));
vi.mock('../components/TableDetailPanel', () => ({
    default: ({ table }: { table: { number: string } | null }) => (
        <aside aria-label="Detalle de mesa">{table ? `Mesa ${table.number}` : 'Selecciona una mesa'}</aside>
    ),
}));
vi.mock('../components/TableOperationModal', () => ({ default: () => null }));
vi.mock('../components/ThemeToggle', () => ({ default: () => null }));
vi.mock('../components/KitchenNotificationBell', () => ({ default: () => null }));
vi.mock('../components/TableMap', () => ({ default: ({ insights }: { insights?: React.ReactNode }) => <div data-testid="map">{insights}</div> }));

import Tables from './Tables';

const renderPage = () => render(<MemoryRouter><Tables /></MemoryRouter>);
const orders = [
    { id: 11, tableId: 1, table: { id: 1, number: '1' }, total: 1500.5, status: 'OPEN', financialStatus: 'UNPAID', invoiceNumber: 'F-1', createdAt: new Date(Date.now() - 45 * 60000).toISOString() },
];

describe('Tables (mockup Mesas)', () => {
    it('muestra los indicadores del salón visibles por defecto, con consumo abierto y mesa abierta más tiempo', async () => {
        activeOrders.mockResolvedValue({ data: { data: orders } });
        renderPage();
        const consumo = await screen.findByRole('region', { name: 'Consumo abierto' });
        expect(await within(consumo).findByText('C$ 1,500.50')).toBeInTheDocument();
        expect(consumo).toHaveTextContent('1 facturadas sin cobrar');
        const longest = screen.getByRole('region', { name: 'Mesa abierta más tiempo' });
        expect(await within(longest).findByText('45 min')).toBeInTheDocument();
    });

    it('si las órdenes activas fallan muestra N/D y no 0', async () => {
        activeOrders.mockRejectedValue(new Error('down'));
        renderPage();
        const consumo = await screen.findByRole('region', { name: 'Consumo abierto' });
        await within(consumo).findByText('N/D');
        expect(consumo).not.toHaveTextContent('C$ 0');
        expect(within(consumo).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    });

    it('al tocar una mesa abre el panel lateral "Detalle de mesa" (no un modal)', async () => {
        activeOrders.mockResolvedValue({ data: { data: orders } });
        renderPage();
        const floor = await screen.findByRole('region', { name: 'Plano de mesas' });
        const tile = await within(floor).findByRole('button', { name: 'Mesa 1, Ocupada' });
        expect(within(tile).getByText('45 min')).toBeInTheDocument();
        await userEvent.click(tile);
        expect(tile).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('complementary', { name: 'Detalle de mesa' })).toHaveTextContent('Mesa 1');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('ofrece "Orden para llevar" en el encabezado', async () => {
        activeOrders.mockResolvedValue({ data: { data: [] } });
        renderPage();
        expect(await screen.findByRole('button', { name: 'Orden para llevar' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'Mesas' })).toBeInTheDocument();
    });
});
