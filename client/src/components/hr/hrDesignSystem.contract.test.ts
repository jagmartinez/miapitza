import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentDirectory = new URL('./', import.meta.url);
const pageDirectory = new URL('../../pages/hr/', import.meta.url);

function readTsx(directory: URL): string {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => readFileSync(new URL(name, directory), 'utf8'))
    .join('\n');
}

const hrSource = `${readTsx(componentDirectory)}\n${readTsx(pageDirectory)}`;
const selectAdapter = readFileSync(new URL('./HrReactSelect.tsx', import.meta.url), 'utf8');
const moneyInput = readFileSync(new URL('./HrMoneyInput.tsx', import.meta.url), 'utf8');
const moneyInputFormat = readFileSync(new URL('./hrMoneyInputFormat.ts', import.meta.url), 'utf8');
const sharedStyles = readFileSync(new URL('../../pages/hr/hr-ui.css', import.meta.url), 'utf8');
const catering = readFileSync(new URL('../../pages/Catering.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../Layout.tsx', import.meta.url), 'utf8');
const schedules = readFileSync(new URL('../../pages/hr/Schedules.tsx', import.meta.url), 'utf8');
const employees = readFileSync(new URL('../../pages/hr/Employees.tsx', import.meta.url), 'utf8');
const shiftForm = readFileSync(new URL('./ScheduleShiftForm.tsx', import.meta.url), 'utf8');
const attendanceSettings = readFileSync(new URL('../../pages/hr/AttendanceSettings.tsx', import.meta.url), 'utf8');
const attendanceStyles = readFileSync(new URL('../../pages/hr/attendance-settings.css', import.meta.url), 'utf8');
const payroll = readFileSync(new URL('../../pages/hr/PayrollManagement.tsx', import.meta.url), 'utf8');

describe('RH and Catering UI design-system contract', () => {
  it('keeps RH views inside the shared 1700px content boundary', () => {
    expect(sharedStyles).toContain(".page-wrapper[class*='hr-']");
    expect(sharedStyles).toContain('max-width: 1700px');
    expect(sharedStyles).toContain('margin-inline: auto');
  });

  it('uses the project React Select adapter instead of native selects in RH', () => {
    expect(hrSource).not.toMatch(/<\/?select\b/);
    expect(selectAdapter).toContain("import Select from '../Select'");
    expect(hrSource).toContain('<HrReactSelect');
    expect(sharedStyles).toContain(":not(.react-select__input)");
  });

  it('keeps attendance and its settings from being active at the same time', () => {
    expect(layout).toContain("end={item.to === '/rh' || item.to === '/rh/asistencia'}");
  });

  it('uses compact premium shells for employee and shift editors', () => {
    expect(employees).toContain('width="large"');
    expect(schedules).toContain('width="large"');
    expect(shiftForm).toContain('premium-modal-content hr-shift-modal-content');
    expect(shiftForm).toContain('className="modal-tabs"');
    expect(shiftForm).toContain('className="modal-footer"');
  });

  it('styles attendance controls without leaking into React Select internals', () => {
    expect(attendanceStyles).toContain("label > :is(input, textarea)");
    expect(attendanceSettings).toContain('¿Qué es el proveedor biométrico?');
    expect(attendanceSettings).toContain('Verificar conexión');
  });

  it('exposes the statutory payroll configuration with explicit labels', () => {
    expect(payroll).toContain('Configurar IR, INSS e INATEC');
    expect(payroll).toContain('Configuración legal: IR, INSS e INATEC');
    expect(payroll).toContain('openRuleConfiguration');
  });

  it('normalizes monetary input while presenting thousands separators and right alignment', () => {
    expect(moneyInputFormat).toContain("replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')");
    expect(moneyInput).toContain('className={`hr-money-input');
    expect(sharedStyles).toContain('font-variant-numeric: tabular-nums');
  });

  it('does not restore the removed Catering event intro', () => {
    expect(catering).not.toContain('catering-event-intro');
    expect(catering).not.toContain('animate-slide-in');
  });
});
