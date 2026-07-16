import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const landing = read('../../pages/hr/MyHrLanding.tsx');
const schedule = read('../../pages/hr/MySchedule.tsx');
const workforce = read('../../pages/hr/MyWorkforce.tsx');
const payroll = read('../../pages/hr/MyPayroll.tsx');
const benefits = read('../../pages/hr/MyBenefits.tsx');
const timeClock = read('../../pages/hr/TimeClock.tsx');
const biometrics = read('../../pages/hr/Biometrics.tsx');
const profile = read('../../pages/Profile.tsx');
const navigation = read('./MyHrNav.tsx');
const layout = read('../Layout.tsx');

describe('employee self-service UX contract', () => {
  it('keeps contextual navigation on every personal HR section', () => {
    [landing, schedule, workforce, payroll, benefits, timeClock, biometrics, profile].forEach((source) => {
      expect(source).toContain('<MyHrNav />');
    });
    [
      '/profile?tab=hr',
      '/rh/mi-portal/horario',
      '/rh/mi-portal/gestion',
      '/rh/mi-portal/nomina',
      '/rh/mi-portal/prestaciones',
      '/rh/marcaje',
      '/rh/biometria',
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

  it('always explains Profile HR access and opens self-service only for a linked account', () => {
    expect(profile).toContain("user?.accountType === 'INTERNAL' && Boolean(user.employeeId)");
    expect(profile).toContain("{ id: 'hr', icon: BriefcaseBusiness, label: 'Mi RH' }");
    expect(profile).toContain('Esta cuenta todavía no está vinculada a un empleado');
    expect(profile).toContain('Vincular en Personal');
    expect(profile).toContain("setSearchParams(tab === 'info' ? {} : { tab }");
    expect(layout).not.toContain("section: 'Mi portal RH'");
    expect(layout).not.toContain("to: '/profile?tab=hr'");
    expect(layout).toContain('className="user-profile-section-link"');
    expect(profile).toContain('workforceClient.getMyWorkforce');
    expect(profile).toContain('selectVacationBalance');
    expect(profile).toContain('Saldo de vacaciones');
    expect(profile).toContain('to="/rh/mi-portal/nomina"');
    expect(profile).toContain('to="/rh/mi-portal/gestion?tab=OVERTIME"');
    expect(profile).toContain('to="/rh/mi-portal/gestion?tab=LEAVE"');
    expect(profile).toContain('to="/rh/biometria"');
  });

  it('usa el mismo saldo semántico de vacaciones y enfoca enlaces profundos', () => {
    expect(landing).toContain('selectVacationBalance');
    expect(workforce).toContain("searchParams.get('tab')");
    expect(workforce).toContain("requestedTab === 'OVERTIME'");
    expect(workforce).toContain("requestedTab === 'LEAVE'");
    expect(workforce).toContain('scrollIntoView');
    expect(workforce).toContain('tabIndex={-1}');
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
    expect(workforce).toContain('Rechazadas o canceladas');
    expect(workforce).toContain('Promise.allSettled');
    expect(workforce).toContain('partialWarning');
  });
});
