// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const getDashboard = vi.fn();
vi.mock('../../components/hr/hrClient', () => ({
  hrClient: { getDashboard: () => getDashboard() },
  getHrErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

const getRuns = vi.fn();
vi.mock('../../components/hr/payrollClient', () => ({
  payrollClient: { getRuns: (...args: unknown[]) => getRuns(...args) },
}));

import { AuthContext } from '../../context/auth-context';
import type { HrPayrollRun } from '../../types/hr-payroll';
import HrDashboard from './HrDashboard';

function run(id: number, payDate: string, status: HrPayrollRun['status'], net: string): HrPayrollRun {
  return {
    id,
    kind: 'REGULAR',
    code: `N-${id}`,
    status,
    period: { id, code: `P${id}`, dateFrom: payDate, dateTo: payDate, payDate, timezone: 'America/Managua', status: 'OPEN', revision: 1, createdAt: payDate },
    ruleVersionId: 1,
    revision: 1,
    allowedActions: [],
    totals: { currency: 'NIO', grossIncome: net, totalDeductions: '0', employerContributions: '0', netPay: net, employeeCount: status === 'DRAFT' ? 0 : 3 },
    anomalyCount: 0,
    blockingAnomalyCount: 0,
    createdAt: payDate,
  } as HrPayrollRun;
}

const base = {
  employees: { total: 10, active: 8, onLeave: 0, inactive: 0, suspended: 0, terminated: 2, internalAccounts: 4 },
  catalogs: { departments: 2, jobPositions: 3, costCenters: 1 },
  branches: { total: 2, geofenceConfigured: 1, attendanceEnabled: 1 },
  attention: { leaveRequests: 1234, overtimeRequests: 0, attendanceCorrections: 0, attendanceIncidents: 0, loanRequests: 0 },
  payroll: { activeRule: true, draftRuns: 1, reviewRuns: 0, approvedRuns: 0 },
};

describe('HrDashboard', () => {
  it('formatea los conteos y no convierte datos faltantes en 0', async () => {
    getDashboard.mockResolvedValue({ ...base, attention: { ...base.attention, loanRequests: undefined } });
    render(<MemoryRouter><HrDashboard /></MemoryRouter>);
    const card = await screen.findByRole('region', { name: 'Requieren atención' });
    expect(card).toHaveTextContent('N/D');
    expect(card).not.toHaveTextContent(/\b0\b/);
  });

  it('suma la bandeja de atención con separador de miles', async () => {
    getDashboard.mockResolvedValue(base);
    render(<MemoryRouter><HrDashboard /></MemoryRouter>);
    const card = await screen.findByRole('region', { name: 'Requieren atención' });
    expect(card).toHaveTextContent('1,234');
  });

  it('muestra los KPI de nómina con la corrida calculada (no el borrador en ceros) solo con permiso de nómina', async () => {
    getDashboard.mockResolvedValue(base);
    getRuns.mockImplementation(async (kind: string) => ({
      items: kind === 'REGULAR' ? [run(1, '2026-10-15', 'PAID', '1234.5'), run(2, '2026-10-30', 'DRAFT', '0')] : [],
      pagination: { page: 1, limit: 100, total: kind === 'REGULAR' ? 2 : 0, totalPages: 1 },
    }));
    const auth = { user: { permissions: ['hr.dashboard.read', 'hr.payroll.read'] } } as unknown as React.ContextType<typeof AuthContext>;
    render(<AuthContext.Provider value={auth}><MemoryRouter><HrDashboard /></MemoryRouter></AuthContext.Provider>);
    const card = await screen.findByRole('region', { name: 'Neto a pagar' });
    expect(within(card).getByText('C$ 1,234.50')).toBeInTheDocument();
    expect(screen.queryByText('C$ 0.00')).toBeNull();
  });

  it('no consulta nómina sin el permiso de lectura de nómina', async () => {
    getRuns.mockClear();
    getDashboard.mockResolvedValue(base);
    render(<MemoryRouter><HrDashboard /></MemoryRouter>);
    await screen.findByRole('region', { name: 'Requieren atención' });
    expect(getRuns).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Neto a pagar' })).toBeNull();
  });
});
