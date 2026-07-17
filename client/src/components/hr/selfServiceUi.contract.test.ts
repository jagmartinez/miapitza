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
const punchWizard = read('./AttendancePunchWizard.tsx');
const layout = read('../Layout.tsx');
const selfServiceCss = read('../../pages/hr/self-service.css');
const navigationCss = read('./my-hr-nav.css');
const benefitsCss = read('../../pages/hr/benefits.css');
const payrollCss = read('../../pages/hr/payroll.css');

describe('employee self-service UX contract', () => {
  it('uses Profile cards as the launcher and adds a compact mobile punch shortcut', () => {
    [schedule, workforce, payroll, benefits, timeClock, biometrics].forEach((source) => {
      expect(source).toContain('<MyHrNav />');
      expect(source).toContain('my-hr-page');
      expect(source).toContain("import './self-service.css'");
      expect(source).not.toContain("import './admin-tables.css'");
    });
    expect(profile).not.toContain('<MyHrNav />');
    expect(navigation).toContain('to="/profile?tab=hr"');
    expect(navigation).toContain('to="/rh/marcaje"');
    expect(navigation).toContain('Marcar ahora');
    expect(navigation).toContain('Mis accesos de RH');
    expect(navigation).not.toContain("const ITEMS");
    expect(navigation).toContain('aria-label="Navegación de Mi RH"');
    expect(selfServiceCss).toContain('.my-hr-summary-grid');
    expect(selfServiceCss).toContain('.my-hr-page-header .page-header-actions');
    expect(navigationCss).toContain('.my-hr-nav__punch');
    expect(navigationCss).toContain('@media (max-width: 768px)');
  });

  it('turns wide self-service tables and receipt rows into mobile-native layouts', () => {
    expect(benefits).toContain('data-label="Código"');
    expect(benefits).toContain('data-label="Estado"');
    expect(benefits).toContain('my-benefits-action-label');
    expect(benefitsCss).toContain('.my-benefits-table tbody td::before');
    expect(benefitsCss).toContain('content: attr(data-label)');
    expect(payrollCss).toMatch(/\.hr-my-receipt-list button\s*\{[\s\S]*?display: grid;/);
    expect(selfServiceCss).toContain('scroll-snap-type: x proximity');
  });

  it('explains why a punch is unavailable and links the next safe action', () => {
    expect(punchWizard).toContain('No tienes un turno publicado aplicable');
    expect(punchWizard).toContain('No tienes una asignación RH vigente');
    expect(punchWizard).toContain('Ver mi horario');
    expect(timeClock).toContain('onViewSchedule={() => navigate');
    expect(biometrics).toContain('Ir a marcar ahora');
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

  it('hides success-only connectivity banners but preserves explicit offline states', () => {
    expect(workforce).toContain('!online && <OnlineOnlyNotice online={false} />');
    expect(timeClock).toContain('!online && <OnlineOnlyNotice online={false} />');
    expect(payroll).toContain('!online && <PayrollOnlineNotice online={false} />');
    expect(benefits).toContain('!online && <BenefitsOnlineNotice online={false} />');
    expect(biometrics).toContain('!online && <OnlineOnlyNotice online={false} />');
    [workforce, timeClock, payroll, benefits].forEach((source) => {
      expect(source).not.toContain('Notice online={online}');
    });
  });
});
