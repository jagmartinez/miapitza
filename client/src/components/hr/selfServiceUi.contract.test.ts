import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const landing = read('../../pages/hr/MyHrLanding.tsx');
const schedule = read('../../pages/hr/MySchedule.tsx');
const workforce = read('../../pages/hr/MyWorkforce.tsx');
const payroll = read('../../pages/hr/MyPayroll.tsx');
const benefits = read('../../pages/hr/MyBenefits.tsx');
const profile = read('../../pages/Profile.tsx');
const navigation = read('./MyHrNav.tsx');

describe('employee self-service UX contract', () => {
  it('keeps contextual navigation on every personal HR section', () => {
    [landing, schedule, workforce, payroll, benefits].forEach((source) => {
      expect(source).toContain('<MyHrNav />');
    });
    [
      '/rh/mi-portal',
      '/rh/mi-portal/horario',
      '/rh/mi-portal/gestion',
      '/rh/mi-portal/nomina',
      '/rh/mi-portal/prestaciones',
    ].forEach((route) => expect(navigation).toContain(route));
    expect(navigation).toContain('aria-label="Secciones de mi portal RH"');
  });

  it('builds the portal summary from scoped server resources and tolerates partial failures', () => {
    [
      'scheduleClient.getMySchedule',
      'workforceClient.getMyWorkforce',
      'payrollClient.getMyReceipts',
      'benefitsClient.getMyTravelRequests',
      'benefitsClient.getMyLoans',
    ].forEach((call) => expect(landing).toContain(call));
    expect(landing).toContain('outcome(');
    expect(landing).toContain('unavailableSections');
    expect(landing).not.toContain('userId:');
  });

  it('shows Profile HR access only for a linked INTERNAL account', () => {
    expect(profile).toContain("user?.accountType === 'INTERNAL' && Boolean(user.employeeId)");
    expect(profile).toContain("hasEmployeeContext ? [{ id: 'hr'");
    expect(profile).toContain('to="/rh/mi-portal/nomina"');
    expect(profile).toContain('to="/rh/mi-portal/gestion"');
  });

  it('keeps empty/error recovery and creation CTAs visible', () => {
    expect(schedule).toContain('Ir a marcaje');
    expect(schedule).toContain('Reintentar');
    expect(payroll).toContain('Ver recibos del año actual');
    expect(payroll).toContain('Reintentar');
    expect(benefits).toContain("tab === 'TRAVEL' ? 'Solicitar viático' : 'Solicitar préstamo'");
    expect(benefits).toContain('Reintentar');
    expect(workforce).toContain('En espera');
    expect(workforce).toContain('Aprobadas');
    expect(workforce).toContain('Denegadas');
  });
});
