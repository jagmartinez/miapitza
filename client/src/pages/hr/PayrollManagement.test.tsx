// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HrPayrollRun } from '../../types/hr-payroll';

const getRuns = vi.fn();
vi.mock('../../components/hr/payrollClient', () => ({
  createPayrollIdempotencyKey: () => 'key',
  getPayrollErrorMessage: (_e: unknown, fallback: string) => fallback,
  payrollClient: {
    getRules: vi.fn().mockResolvedValue({ items: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 1 } }),
    getPeriods: vi.fn().mockResolvedValue({ items: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 1 } }),
    getRuns: (...args: unknown[]) => getRuns(...args),
  },
}));
vi.mock('../../components/hr/hrClient', () => ({
  hrClient: { getOrganization: vi.fn().mockResolvedValue({ branches: [], departments: [], jobPositions: [], costCenters: [] }) },
  getHrErrorMessage: (_e: unknown, fallback: string) => fallback,
}));
vi.mock('../../context/ConfirmContext', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../../context/ToastContext', () => ({ useAppToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import PayrollManagement from './PayrollManagement';

function run(id: number, payDate: string, status: HrPayrollRun['status'], net: string, gross: string): HrPayrollRun {
  return {
    id,
    kind: 'REGULAR',
    code: `N-${id}`,
    status,
    period: { id, code: `P${id}`, dateFrom: payDate, dateTo: payDate, payDate, timezone: 'America/Managua', status: 'OPEN', revision: 1, createdAt: payDate },
    ruleVersionId: 1,
    revision: 1,
    allowedActions: [],
    totals: { currency: 'NIO', grossIncome: gross, totalDeductions: '0', employerContributions: '0', netPay: net, employeeCount: status === 'DRAFT' ? 0 : 3 },
    anomalyCount: 0,
    blockingAnomalyCount: 0,
    createdAt: payDate,
  } as HrPayrollRun;
}

function page(data: HrPayrollRun[]) {
  return { items: data, pagination: { page: 1, limit: 100, total: data.length, totalPages: 1 } };
}

describe('PayrollManagement', () => {
  beforeEach(() => {
    getRuns.mockReset();
  });

  it('muestra montos con formato 1,234.50 y N/D para borradores sin cálculo, sin tarjetas en cero', async () => {
    const paid = run(1, '2026-10-15', 'PAID', '1234.5', '2000');
    const draft = run(2, '2026-10-30', 'DRAFT', '0', '0');
    getRuns.mockImplementation(async (kind: string) => page(kind === 'REGULAR' ? [paid, draft] : []));
    render(<MemoryRouter><PayrollManagement /></MemoryRouter>);

    const table = await screen.findByRole('table', { name: 'Corridas de nómina' });
    const paidRow = within(table).getByText('N-1').closest('tr') as HTMLElement;
    expect(within(paidRow).getByText('C$ 1,234.50')).toBeInTheDocument();
    const draftRow = within(table).getByText('N-2').closest('tr') as HTMLElement;
    expect(within(draftRow).getAllByText('N/D').length).toBeGreaterThanOrEqual(3);
    expect(within(draftRow).queryByText('C$ 0.00')).toBeNull();

    // La tarjeta de neto toma la corrida calculada, no el borrador en ceros.
    const card = screen.getByRole('region', { name: 'Neto a pagar' });
    await waitFor(() => expect(within(card).getByText('C$ 1,234.50')).toBeInTheDocument());
    expect(screen.queryByText('C$ 0.00')).toBeNull();
  });
});
