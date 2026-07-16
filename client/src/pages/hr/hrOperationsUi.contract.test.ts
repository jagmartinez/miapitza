import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const attendanceReview = read('./AttendanceReview.tsx');
const attendanceManagement = read('./AttendanceManagement.tsx');
const leaveManagement = read('./LeaveManagement.tsx');
const benefitsManagement = read('./BenefitsManagement.tsx');
const timeClock = read('./TimeClock.tsx');
const myBenefits = read('./MyBenefits.tsx');
const myPayroll = read('./MyPayroll.tsx');
const myWorkforce = read('./MyWorkforce.tsx');
const adminCss = read('./admin-tables.css');
const attendanceCss = read('./attendance.css');

const adminOperationalPages = [
  attendanceReview,
  attendanceManagement,
  leaveManagement,
  benefitsManagement,
];

const selfServicePages = [
  timeClock,
  myBenefits,
  myPayroll,
  myWorkforce,
];

describe('RH operational UI contract', () => {
  it('uses the shared Inventory-inspired operational composition without global selectors', () => {
    adminOperationalPages.forEach((source) => expect(source).toContain('hr-operation-page'));
    selfServicePages.forEach((source) => expect(source).toContain('my-hr-page'));
    expect(adminCss).toContain('.hr-operation-page .hr-operation-kpis');
    expect(adminCss).toContain('.hr-operation-page .hr-operation-toolbar');
    expect(adminCss).toContain("[role='tabpanel']:focus-visible");
    expect(adminCss).not.toMatch(/(^|\n)\s*(body|:root)\s*\{/);
  });

  it('keeps admin queues table-first with external control tabs and explicit counterflows', () => {
    [attendanceManagement, leaveManagement].forEach((source) => {
      expect(source).toContain('hr-operation-toolbar');
      expect(source).not.toContain('hr-operation-kpis');
      expect(source).toContain('filters-toolbar hr-admin-tab-toolbar');
      expect(source).toContain('role="tablist"');
      expect(source).toContain('role="tabpanel"');
      expect(source).toContain('className="hr-admin-table inventory-table"');
      expect(source).not.toContain('<caption>');
    });
    expect(attendanceReview).not.toContain('attendance-review-table-title');
    expect(attendanceReview).not.toContain('hr-operation-kpis');
    expect(benefitsManagement).not.toContain('hr-operation-kpis');
    expect(benefitsManagement).not.toContain('<caption>');
    expect(attendanceManagement).toContain("{ kind: 'reopen', item: period }");
    expect(attendanceManagement).toContain("{ kind: 'close', item: period }");
    expect(leaveManagement).toContain("openRequestAction(item, 'cancel')");
    expect(benefitsManagement).toContain("REVERSE: 'Revertir'");
    expect(benefitsManagement).toContain("CANCEL: 'Cancelar'");
  });

  it('turns self-service workforce into keyboard-addressable trays without hiding server states', () => {
    expect(myWorkforce).toContain(
      "type WorkforceWorkspace = 'ATTENDANCE' | 'REQUESTS' | 'BALANCES'"
    );
    expect(myWorkforce).toContain('aria-controls="my-workforce-panel-attendance"');
    expect(myWorkforce).toContain('role="tabpanel"');
    expect(myWorkforce).toContain("item.status === 'CANCELLED'");
    expect(myWorkforce).toContain('openCancel');
    expect(myWorkforce).toContain('formatHrNumber(balance.available)');
  });

  it('presents punch readiness and preserves server-authoritative available actions', () => {
    expect(timeClock).toContain('today?.availableActions[0]');
    expect(timeClock).toContain('El servidor no habilita un nuevo marcaje');
    expect(timeClock).toContain('biometricBlocked');
    expect(timeClock).toContain('Marcaje no disponible sin conexión');
    expect(timeClock).toContain('AttendancePunchWizard');
    expect(attendanceCss).toContain('.hr-time-clock-workspace');
    expect(attendanceCss).toContain('@media (max-width: 1080px)');
  });

  it('keeps react-select and grouped money in financial self-service views', () => {
    expect(myBenefits).toContain('formatHrMoney');
    expect(myBenefits).toContain('role="tabpanel"');
    expect(myPayroll).toContain('HrReactSelect');
    expect(myPayroll).toContain('formatHrMoney(receipt.currency, receipt.netPay)');
    expect(myPayroll).toContain('my-hr-summary-grid');
  });
});
