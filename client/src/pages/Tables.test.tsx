// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('../components/TableMap', () => ({
    default: ({ heading, extraActions }: { heading?: React.ReactNode; extraActions?: React.ReactNode }) => (
        <div data-testid="map">{heading}{extraActions}</div>
    ),
}));

import Tables from './Tables';

const renderPage = () => render(<MemoryRouter><Tables /></MemoryRouter>);
const orders = [
    { id: 11, tableId: 1, table: { id: 1, number: '1' }, total: 1500.5, status: 'OPEN', financialStatus: 'UNPAID', invoiceNumber: 'F-1', createdAt: new Date(Date.now() - 45 * 60000).toISOString() },
];

describe('Tables (mockup Mesas)', () => {
    beforeEach(() => { localStorage.clear(); });

    it('no muestra tarjetas de indicadores en la vista operativa (viven en el dashboard)', async () => {
        activeOrders.mockResolvedValue({ data: { data: orders } });
        renderPage();
        const floor = await screen.findByRole('region', { name: 'Plano de mesas' });
        // El consumo y el tiempo por mesa siguen en cada mosaico.
        const tile = await within(floor).findByRole('button', { name: 'Mesa 1, Ocupada' });
        expect(await within(tile).findByText('45 min')).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Indicadores del salón' })).toBeNull();
        expect(screen.queryByRole('region', { name: 'Consumo abierto' })).toBeNull();
        expect(screen.queryByRole('region', { name: 'Mesa abierta más tiempo' })).toBeNull();
    });

    it('cambia de vista con el selector solo-icono del encabezado y la lista filtra por estado con conteo', async () => {
        activeOrders.mockResolvedValue({ data: { data: [] } });
        renderPage();
        const views = await screen.findByRole('group', { name: 'Vista de mesas' });
        expect(within(views).getByRole('button', { name: 'Mesas' })).toBeInTheDocument();
        expect(within(views).getByRole('button', { name: 'Plano' })).toBeInTheDocument();
        await userEvent.click(within(views).getByRole('button', { name: 'Lista' }));
        const tabs = await screen.findByRole('tablist', { name: 'Estado de la mesa' });
        expect(within(tabs).getByRole('tab', { name: 'Todas 2' })).toHaveAttribute('aria-selected', 'true');
        expect(within(tabs).getByRole('tab', { name: 'Disponibles 1' })).toBeInTheDocument();
        expect(within(tabs).getByRole('tab', { name: 'Ocupadas 1' })).toBeInTheDocument();
        expect(screen.getByRole('table', { name: 'Mesas' })).toBeInTheDocument();
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
