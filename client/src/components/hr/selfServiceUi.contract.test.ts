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
const layout = read('../Layout.tsx') + read('../../navigation/navConfig.ts') + read('../../ui/layout/Topbar.tsx');
// Layout migrado: self-service.css se eliminó (pestañas y tablas de @/ui).
const navigationCss = read('./MyHrNav.module.css');
const dataTable = read('../../ui/data/DataTable.tsx');
const dataTableCss = read('../../ui/data/data.css');

describe('employee self-service UX contract', () => {
  it('turns wide self-service tables and receipt rows into mobile-native layouts', () => {
    expect(benefits.match(/stackOnMobile/g)?.length).toBe(3);
    expect(payroll).toContain('stackOnMobile');
    expect(dataTable).toContain('data-label={labelOf(c)}');
    expect(dataTableCss).toContain('content: attr(data-label)');
  });

  it('uses Profile cards as the launcher and adds a compact mobile punch shortcut', () => {
    // Layout migrado: las pantallas de Mi RH usan PageContent de @/ui en lugar del contenedor my-hr-page.
    [schedule, workforce, payroll, benefits, timeClock, biometrics].forEach((source) => {
      expect(source).toContain('<MyHrNav />');
      expect(source).toContain('<PageContent');
      expect(source).not.toContain("import './admin-tables.css'");
    });
    expect(profile).not.toContain('<MyHrNav />');
    expect(navigation).toContain('to="/profile?tab=hr"');
    expect(navigation).toContain('to="/rh/marcaje"');
    expect(navigation).toContain('Marcar ahora');
    expect(navigation).toContain('Mis accesos de RH');
    expect(navigation).not.toContain("const ITEMS");
    expect(navigation).toContain('aria-label="Navegación de Mi RH"');
    expect(navigationCss).toContain('.punch');
    expect(navigationCss).toContain('@media (max-width: 768px)');
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
    expect(profile).toContain('id="profile-sec-hr"');
    expect(profile).toContain('Mi RH</h2>');
    expect(profile).toContain('Esta cuenta todavía no está vinculada a un empleado');
    expect(profile).toContain('Vincular en Personal');
    expect(profile).toContain("setSearchParams(tab === 'resumen' ? {} : { tab }");
    expect(layout).not.toContain("section: 'Mi portal RH'");
    expect(layout).not.toContain("to: '/profile?tab=hr'");
    expect(layout).toContain('title="Perfil y Mi RH"');
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
    expect(schedule).toContain('LoadErrorState');
    expect(payroll).toContain('Ver recibos del año actual');
    expect(payroll).toContain('LoadErrorState');
    expect(benefits).toContain("tab === 'TRAVEL' ? 'Solicitar viático' : 'Solicitar préstamo'");
    expect(benefits).toContain('LoadErrorState');
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
