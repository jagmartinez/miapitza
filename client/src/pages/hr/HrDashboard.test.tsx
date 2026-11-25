// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const getDashboard = vi.fn();
vi.mock('../../components/hr/hrClient', () => ({
  hrClient: { getDashboard: () => getDashboard() },
  getHrErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

import HrDashboard from './HrDashboard';

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
});
