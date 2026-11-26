// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import BiDashboard from './BiDashboard';

const bi = vi.hoisted(() => ({
    summary: vi.fn(), trend: vi.fn(), bridge: vi.fn(), channels: vi.fn(), heatmap: vi.fn(), pareto: vi.fn(), branches: vi.fn(), insights: vi.fn(),
}));

vi.mock('../../services/bi', () => ({ biAPI: bi }));
vi.mock('../../services/api', () => ({
    branchesAPI: { getAll: vi.fn().mockResolvedValue({ data: { data: [{ id: 1, name: 'Centro' }, { id: 2, name: 'Norte' }] } }) },
    reportsAPI: {
        getDashboardStats: vi.fn().mockResolvedValue({ data: { data: { todaySales: 1200, activeOrders: 3, pendingPurchaseOrders: 0, occupancyRate: 40, averageTicket: 300, settledOrdersCount: 4 } } }),
        getTodaysReservations: vi.fn().mockResolvedValue({ data: { data: [] } }),
    },
    ordersAPI: { getKitchenQueue: vi.fn().mockResolvedValue({ data: { data: [] } }) },
    productsAPI: { getLowStock: vi.fn().mockResolvedValue({ data: { data: [{ name: 'Tomate' }] } }) },
}));

const money = (current: number, deltaPct: number | null = 5) => ({ current, previous: current, deltaPct });

const summary = (over: Record<string, unknown> = {}) => ({
    netSales: money(10000), grossSales: money(11000), discounts: money(1000), orders: money(50), avgTicket: money(200),
    grossMarginPct: money(62), foodCostRealPct: money(31), foodCostTheoreticalPct: money(29), foodCostGapAmount: 200,
    laborCostPct: money(28), operatingProfit: money(1500), operatingMarginPct: money(15),
    goals: { monthlySales: 30000, periodSales: 10000, avgTicket: 220, foodCostPct: 30, foodCostGapPts: 3, grossMarginPct: 65, laborCostMaxPct: 30, operatingMarginPct: 12 },
    spark: { netSales: [1, 2, 3], grossMarginPct: [1, 2], avgTicket: [1, 2], laborCostPct: [1, 2], operatingProfit: [1, 2], foodCostGapPts: [1, 2] },
    dataQuality: { labor: 'complete', theoreticalCost: 'complete', laborCoverage: 1 },
    warnings: [],
    ...over,
});

function Where() {
    const l = useLocation();
    return <output data-testid="where">{l.search}</output>;
}

const renderPage = (initial = '/dashboard') => render(
    <MemoryRouter initialEntries={[initial]}>
        <BiDashboard />
        <Where />
    </MemoryRouter>,
);

beforeEach(() => {
    Object.values(bi).forEach((f) => f.mockReset());
    bi.summary.mockResolvedValue(summary());
    bi.trend.mockResolvedValue({ buckets: ['1', '2'], current: [10, 20], previous: [5, 10], goal: null });
    bi.bridge.mockResolvedValue([{ key: 'net', label: 'Venta neta', amount: 100, kind: 'total' }]);
    bi.channels.mockResolvedValue([{ channel: 'RESTAURANT', label: 'Salón', netSales: 100, sharePct: 100, netMarginPct: 40, avgTicket: 100 }]);
    bi.heatmap.mockResolvedValue({ hours: [11, 12], days: [{ weekday: 1, label: 'Lun', values: [0, 10] }], peak: { weekday: 1, hour: 12 }, valley: { weekday: 1, hour: 11 } });
    bi.pareto.mockResolvedValue({ items: [{ menuItemId: 1, name: 'Pizza', margin: 100, cumulativePct: 50 }], itemsFor80Pct: 1, totalItems: 2, unavailableItems: 0 });
    bi.branches.mockResolvedValue([]);
    bi.insights.mockResolvedValue([]);
});

describe('BiDashboard', () => {
    it('cambiar el periodo actualiza la URL y vuelve a pedir todas las secciones', async () => {
        renderPage('/dashboard?period=30d&compare=previous');
        await screen.findByText('Venta neta', { selector: '.ui-statcard__label' });
        expect(bi.summary).toHaveBeenCalledTimes(1);
        await userEvent.click(screen.getByRole('button', { name: '7 días' }));
        await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('period=7d'));
        await waitFor(() => {
            for (const f of Object.values(bi)) expect(f).toHaveBeenCalledTimes(2);
        });
        expect(bi.summary.mock.calls[1][0]).toMatchObject({ period: '7d', compare: 'previous' });
    });

    it('una sección con error muestra Reintentar y las demás siguen visibles', async () => {
        bi.heatmap.mockRejectedValueOnce(new Error('boom'));
        renderPage();
        const alert = await screen.findByText('No se pudo cargar el mapa de calor.');
        expect(alert).toBeInTheDocument();
        expect(await screen.findByText('Hallazgos')).toBeInTheDocument();
        expect(screen.getByText('Pizza')).toBeInTheDocument();
        await userEvent.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Reintentar' }));
        await waitFor(() => expect(bi.heatmap).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByText('No se pudo cargar el mapa de calor.')).toBeNull());
    });

    it('deltaPct null se muestra como "Sin comparación"', async () => {
        bi.summary.mockResolvedValue(summary({ netSales: money(10000, null) }));
        renderPage();
        expect((await screen.findAllByText('Sin comparación')).length).toBeGreaterThan(0);
    });

    it('personal sin nómina se muestra N/D y no como 0', async () => {
        bi.summary.mockResolvedValue(summary({ dataQuality: { labor: 'unavailable', theoreticalCost: 'complete', laborCoverage: 0 } }));
        renderPage();
        const card = await screen.findByRole('region', { name: 'Costo de personal' });
        expect(within(card).getByText('N/D')).toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'Utilidad operativa' })).getByText('N/D')).toBeInTheDocument();
    });

    it('brecha de costo sin comparar muestra N/D', async () => {
        bi.summary.mockResolvedValue(summary({ foodCostGapAmount: null }));
        renderPage();
        const card = await screen.findByRole('region', { name: 'Costo real vs teórico' });
        expect(within(card).getByText('N/D')).toBeInTheDocument();
    });

    it('la URL compartida restaura filtros y la pestaña "Operación en vivo" carga sus fuentes', async () => {
        renderPage('/dashboard?period=12m&compare=year&branches=2');
        await waitFor(() => expect(bi.summary).toHaveBeenCalled());
        expect(bi.summary.mock.calls[0][0]).toMatchObject({ period: '12m', compare: 'year', branchIds: [2] });
        await userEvent.click(screen.getByRole('tab', { name: 'Operación en vivo' }));
        expect(await screen.findByText('Requiere atención')).toBeInTheDocument();
        expect(await screen.findByText(/1 productos bajo el mínimo: Tomate/)).toBeInTheDocument();
    });

    it('"Guardar vista" persiste en localStorage bi.views', async () => {
        window.localStorage.removeItem('bi.views');
        renderPage('/dashboard?period=7d');
        await userEvent.click(await screen.findByRole('button', { name: 'Guardar vista' }));
        const saved = JSON.parse(window.localStorage.getItem('bi.views') ?? '[]');
        expect(saved).toHaveLength(1);
        expect(saved[0].query).toContain('period=7d');
    });
});
