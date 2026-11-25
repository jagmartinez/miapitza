import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
const employees = read('../../pages/hr/Employees.tsx');
const employeeForm = read('./EmployeeForm.tsx');
const employeeRecords = read('./EmployeeRecordPanel.tsx');
const schedulePage = read('../../pages/hr/Schedules.tsx');
const scheduleWeek = read('./ScheduleWeekView.tsx');
const scheduleStyles = read('../../pages/hr/schedule.css');

describe('personal, compensation and weekly schedule UX contract', () => {
  it('shows authorized identification and current compensation in table and cards', () => {
    expect(employees).toContain("header: 'Identificación'");
    expect(employees).toContain("header: 'Compensación vigente'");
    expect(employees).toContain('employee.documentNumber === undefined');
    expect(employees).toContain('formatHrMoney(compensation.currency, compensation.amount)');
    expect(employees).toContain('hr-employee-card-compensation');
  });

  it('captures initial compensation atomically with safe money and select controls', () => {
    expect(employeeForm).toContain('initialCompensation:');
    expect(employeeForm).toContain('<HrMoneyInput');
    expect(employeeForm).toContain('Compensación inicial');
    expect(employeeForm).toContain('una sola operación');
    expect(employeeForm).toContain('FORTNIGHTLY');
    expect(employeeForm).not.toMatch(/<select\b/);
  });

  it('keeps later compensation changes append-only and labels 24 versus 26 periods', () => {
    expect(employeeRecords).toContain('appendEmployeeCompensation');
    expect(employeeRecords).toContain('Quincenal · 24 períodos/año');
    expect(employeeRecords).toContain('Catorcenal · 26 períodos/año');
    expect(employeeRecords).toContain('Guardar nueva versión');
  });

  it('uses a focused employee-by-day workspace without redundant KPI or coverage blocks', () => {
    expect(schedulePage).not.toContain('hr-schedule-kpis');
    expect(schedulePage).not.toContain('Horas programadas');
    expect(scheduleWeek).not.toContain('hr-schedule-coverage');
    expect(scheduleWeek).toContain('hr-schedule-matrix-row');
    expect(scheduleWeek).toContain('role="table"');
    expect(scheduleStyles).toContain('@media (max-width: 1100px)');
    expect(scheduleStyles).toContain('.hr-schedule-matrix-wrap');
    expect(scheduleStyles).not.toContain('.hr-schedule-kpis');
    expect(scheduleStyles).not.toContain('.hr-schedule-coverage');
  });

  it('keeps cancelled and superseded schedule history visible but read-only', () => {
    expect(schedulePage).toContain('historicalSchedules');
    expect(schedulePage).toContain('activeSchedule ?? historicalSchedule');
    expect(schedulePage).toContain('readOnly={mutationBusy || fromCache || !activeSchedule}');
    expect(schedulePage).toContain("primarySchedule?.status === 'CANCELLED'");
    expect(schedulePage).toContain("primarySchedule?.status === 'SUPERSEDED'");
  });
});
