// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductionDashboard from './ProductionDashboard';

const mocks = vi.hoisted(() => ({ dashboard: vi.fn(), branches: vi.fn() }));

vi.mock('recharts', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Box, BarChart: Box, Bar: Box, XAxis: Box, YAxis: Box, CartesianGrid: Box, Tooltip: Box,
    PieChart: Box, Pie: Box, Cell: Box, Legend: Box, ComposedChart: Box, Area: Box, Line: Box,
  };
});
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1, role: 'ADMIN', roles: ['ADMIN'] } }) }));
vi.mock('../services/api', () => ({
  productionReportsAPI: { getDashboard: (...a: unknown[]) => mocks.dashboard(...a) },
  branchesAPI: { getAll: () => mocks.branches() },
}));

const kpis = (over: Record<string, number> = {}) => ({
  total: 4, draft: 1, pending: 0, inProgress: 0, finished: 3, cancelled: 0, totalPlanned: 40, totalProduced: 38,
  totalEstimatedCost: 300, totalRealCost: 330, costVariance: 30, avgYieldPct: 95, activeOrders: 1, completionRate: 75,
  cancelRate: 0, realizedOrders: 3, avgRealOrderCost: 110, costVariancePct: 10, ...over,
});
const dashboard = (k: ReturnType<typeof kpis>) => ({
  data: { data: { kpis: k, previous: null, statusBreakdown: [], timeSeries: [], topProduced: [], topConsumed: [], branchComparison: [], topOperators: [], recentOrders: [], catalog: { activeRecipes: 1, producibleProducts: 1 } } },
});

describe('ProductionDashboard', () => {
  beforeEach(() => {
    mocks.branches.mockReset().mockResolvedValue({ data: { data: [] } });
    mocks.dashboard.mockReset();
  });

  it('muestra costo real, variación y rendimiento con su contexto', async () => {
    mocks.dashboard.mockResolvedValue(dashboard(kpis()));
    render(<MemoryRouter><ProductionDashboard /></MemoryRouter>);
    const real = await screen.findByRole('region', { name: 'Costo real' });
    expect(real).toHaveTextContent('C$ 330.00');
    expect(real).toHaveTextContent('Estimado C$ 300.00');
    expect(screen.getByRole('region', { name: 'Variación de costo' })).toHaveTextContent('10.00 % frente al estimado');
    expect(screen.getByRole('region', { name: 'Rendimiento promedio' })).toHaveTextContent('95.00 %');
  });

  it('sin producciones finalizadas no muestra ceros: N/D', async () => {
    mocks.dashboard.mockResolvedValue(dashboard(kpis({ realizedOrders: 0, totalRealCost: 0, totalEstimatedCost: 0, costVariance: 0, avgYieldPct: 0, avgRealOrderCost: 0, finished: 0 })));
    render(<MemoryRouter><ProductionDashboard /></MemoryRouter>);
    expect(await screen.findByRole('region', { name: 'Costo real' })).toHaveTextContent('N/D');
    expect(screen.getByRole('region', { name: 'Rendimiento promedio' })).toHaveTextContent('N/D');
  });

  it('conserva el aviso de sucursales no cargadas y el reintento si falla el panel', async () => {
    mocks.branches.mockRejectedValue(new Error('x'));
    mocks.dashboard.mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><ProductionDashboard /></MemoryRouter>);
    expect(await screen.findByText(/No se pudieron cargar las sucursales/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});
