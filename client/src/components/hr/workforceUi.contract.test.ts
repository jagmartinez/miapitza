import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const attendance = read('../../pages/hr/AttendanceManagement.tsx');
const leave = read('../../pages/hr/LeaveManagement.tsx');
const mine = read('../../pages/hr/MyWorkforce.tsx');
const correctionForm = read('./AttendanceCorrectionForm.tsx');
const leaveForm = read('./LeaveRequestForm.tsx');
const onlineNotice = read('./OnlineOnlyNotice.tsx');
const ui = [attendance, leave, mine, correctionForm, leaveForm, onlineNotice].join('\n');

describe('Phase 4 workforce UI safety contract', () => {
  it('shows every server-owned daily minute category without deriving legal time in the client', () => {
    [
      'ordinaryMinutes',
      'breakMinutes',
      'lateMinutes',
      'earlyDepartureMinutes',
      'candidateOvertimeMinutes',
      'approvedOvertimeMinutes',
    ].forEach((field) => {
      expect(attendance).toContain(field);
      expect(mine).toContain(field);
    });
    expect(ui).not.toContain('.reduce(');
    expect(ui).toContain('servidor');
  });

  it('keeps leave creation, submission and decision as distinct transitions', () => {
    expect(leave).toContain('workforceClient.createLeaveRequest(payload)');
    expect(leave).toContain('workforceClient.submitLeaveRequest(item.id)');
    expect(leave).toContain('workforceClient.decideLeaveRequest');
    expect(leave).toContain('no hay autoaprobación');
    expect(leaveForm).toContain("fraction === 'HOURS'");
  });

  it('presents attendance and leave as table-first administrative workspaces', () => {
    expect(attendance).toContain('className="hr-admin-table inventory-table"');
    expect(attendance).toContain("['INCIDENTS', 'Incidencias'");
    expect(attendance).toContain('Revisar y decidir');
    expect(attendance).not.toContain('hr-summary-grid');
    expect(leave).toContain('className="hr-admin-table inventory-table"');
    expect(leave).toContain("['BALANCES', 'Saldos'");
    expect(leave).toContain('Movimientos de saldos');
    expect(leave).not.toContain('hr-type-grid');
    expect(leave).toContain("fractionLabel(item.fraction)");
  });

  it('keeps leave tabs inside the operational toolbar and makes employee filtering searchable', () => {
    expect(leave).toMatch(/hr-workforce-filters inventory-filters-row hr-operation-toolbar[\s\S]*filters-toolbar hr-admin-tab-toolbar/);
    expect(leave).toContain('aria-label="Filtrar por empleado"');
    expect(leave).toContain('isSearchable');
  });

  it('loads every authoritative server page and exposes accessible tabs and column headers', () => {
    [attendance, leave].forEach((source) => {
      expect(source).toContain('collectAllPages');
      expect(source).toContain('aria-controls=');
      expect(source).toContain('role="tabpanel"');
      expect(source).toContain('scope="col"');
    });
  });

  it('does not persist or queue sensitive workforce mutations offline', () => {
    expect(onlineNotice).toContain('No existe cola offline');
    expect(ui).not.toContain('localStorage');
    expect(ui).not.toContain('sessionStorage');
    expect(ui).not.toContain('indexedDB');
    expect(ui).not.toContain('navigator.serviceWorker');
  });

  it('requires reasons for compensating corrections, decisions, cancellations and ledger adjustments', () => {
    expect(correctionForm).toContain('reason.trim()');
    expect(attendance).toContain('!reason.trim()');
    expect(leave).toContain('!actionReason.trim()');
    expect(leave).toContain('!adjustment.reason.trim()');
    expect(mine).toContain('!cancelReason.trim()');
  });
});
