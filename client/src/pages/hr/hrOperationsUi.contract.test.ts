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
const attendanceCss = read('./attendance.css');
const punchWizard = read('../../components/hr/AttendancePunchWizard.tsx');
const geolocationCapture = read('../../components/hr/GeolocationCapture.tsx');

// Pantallas ya migradas a PageContent de @/ui (sin contenedores hr-operation-page / my-hr-page).
const migratedPages = [attendanceReview, timeClock, attendanceManagement, leaveManagement, benefitsManagement, myBenefits, myPayroll, myWorkforce];


describe('RH operational UI contract', () => {
  it('uses the shared Inventory-inspired operational composition without global selectors', () => {
    migratedPages.forEach((source) => {
      expect(source).toContain('<PageContent');
      expect(source).not.toContain('hr-operation-page');
      expect(source).not.toContain('my-hr-page');
    });
    // Layout migrado: filtros sin caja con TableToolbar de @/ui (sin hr-console.css ni admin-tables.css).
  });

  it('keeps admin queues table-first with external control tabs and explicit counterflows', () => {
    [attendanceManagement, leaveManagement].forEach((source) => {
      // Layout migrado: Tabs + TableToolbar de @/ui encima de la tabla.
      expect(source).toContain('<TableToolbar');
      expect(source).not.toContain('hr-operation-kpis');
      expect(source).toContain('<Tabs');
      expect(source).toContain('role="tabpanel"');
      expect(source).toContain('<DataTable');
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
    // Pestañas de @/ui; el panel conserva su id y role="tabpanel".
    expect(myWorkforce).toContain('id="my-workforce-panel-attendance"');
    expect(myWorkforce).toContain('role="tabpanel"');
    // Cada solicitud muestra su estado autoritativo (cancelada, rechazada…) con su pastilla.
    expect(myWorkforce).toContain('<WorkforceStatusPill status={item.status} />');
    expect(myWorkforce).not.toContain('<StatCard');
    expect(myWorkforce).toContain('openCancel');
    expect(myWorkforce).toContain('formatHrNumber(balance.available)');
  });

  it('presents punch readiness and preserves server-authoritative available actions', () => {
    expect(timeClock).toContain('today?.availableActions[0]');
    expect(timeClock).toContain('El servidor no habilita un nuevo marcaje');
    expect(timeClock).toContain('biometricBlocked');
    expect(timeClock).toContain('Marcaje no disponible sin conexión');
    expect(timeClock).toContain('AttendancePunchWizard');
    expect(timeClock).toContain('Marcaje registrado; no se pudo actualizar el estado');
    expect(timeClock).toContain('Sucursal a validar');
    expect(timeClock).toContain('Resuelta desde tu adscripción RH vigente');
    expect(timeClock).toContain('setPolicy(todayResult.policy)');
    expect(timeClock).toContain("navigate('/rh/mi-portal/gestion')");
    expect(attendanceReview).toContain('lookupsError');
    expect(attendanceReview).toContain('Reintentar catálogos');
    expect(attendanceManagement).toContain('Minutos a aprobar');
    expect(attendanceManagement).toContain('Los periodos de asistencia son de toda la empresa');
    // Layout migrado: acción de marcaje y resumen en form.split (se apilan en pantallas angostas).
    expect(timeClock).toContain('className={form.split}');
    expect(timeClock).toContain('hr-time-clock-action-panel');
  });

  it('prevents a guaranteed GPS rejection and keeps internal snapshots out of the result UI', () => {
    expect(timeClock).toContain('today?.locationRequirements?.maxAccuracyM');
    expect(punchWizard).toContain('today.locationRequirements?.maxAccuracyM');
    expect(geolocationCapture).toContain('onCapture(evidence.accuracyM <= maxAccuracyM ? evidence : null)');
    expect(punchWizard).toContain('presentAttendanceChecks(result.checks)');
    expect(punchWizard).not.toContain('Object.entries(result.checks)');
    expect(attendanceCss).toContain('.hr-result-technical');
  });

  it('keeps react-select and grouped money in financial self-service views', () => {
    expect(myBenefits).toContain('formatHrMoney');
    expect(myBenefits).toContain('role="tabpanel"');
    expect(myPayroll).toContain('<AppSelect');
    expect(myPayroll).toContain('formatHrMoney(receipt.currency, receipt.netPay)');
    expect(myPayroll).toContain('<DataTable');
  });
});
