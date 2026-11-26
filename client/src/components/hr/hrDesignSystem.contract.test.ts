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
const moneyInput = readFileSync(new URL('./HrMoneyInput.tsx', import.meta.url), 'utf8');
const moneyInputFormat = readFileSync(new URL('./hrMoneyInputFormat.ts', import.meta.url), 'utf8');
// Layout migrado: hr-ui.css se eliminó; el ancho lo da PageContent de @/ui y los montos HrControls.css.
const pageContent = readFileSync(new URL('../../ui/layout/PageContent.tsx', import.meta.url), 'utf8');
const sharedStyles = readFileSync(new URL('./HrControls.css', import.meta.url), 'utf8');
const catering = readFileSync(new URL('../../pages/Catering.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../../navigation/navConfig.ts', import.meta.url), 'utf8');
const schedules = readFileSync(new URL('../../pages/hr/Schedules.tsx', import.meta.url), 'utf8');
const employees = readFileSync(new URL('../../pages/hr/Employees.tsx', import.meta.url), 'utf8');
const shiftForm = readFileSync(new URL('./ScheduleShiftForm.tsx', import.meta.url), 'utf8');
const attendanceSettings = readFileSync(new URL('../../pages/hr/AttendanceSettings.tsx', import.meta.url), 'utf8');
const settingsSection = readFileSync(new URL('./HrSettingsSection.tsx', import.meta.url), 'utf8');
const payroll = readFileSync(new URL('../../pages/hr/PayrollManagement.tsx', import.meta.url), 'utf8');
const payrollLegal = readFileSync(new URL('../../pages/hr/PayrollLegalSettings.tsx', import.meta.url), 'utf8');
const attendanceReview = readFileSync(new URL('../../pages/hr/AttendanceReview.tsx', import.meta.url), 'utf8');
const modalShell = readFileSync(new URL('./HrModalFormShell.tsx', import.meta.url), 'utf8');
const modalStyles = readFileSync(new URL('./HrControls.css', import.meta.url), 'utf8');

describe('RH and Catering UI design-system contract', () => {
  it('keeps RH views inside the shared 1700px content boundary', () => {
    expect(pageContent).toContain('maxWidth = 1700');
    expect(hrSource).toContain('<PageContent');
    expect(hrSource).not.toContain('page-wrapper');
  });

  it('uses the project React Select adapter instead of native selects in RH', () => {
    expect(hrSource).not.toMatch(/<\/?select\b/);
    expect(hrSource).toContain('<AppSelect');
    expect(hrSource).not.toContain('HrReactSelect');
  });

  it('keeps attendance and its settings from being active at the same time', () => {
    // activeNavId elige la ruta más larga que coincide: /rh/asistencia/configuracion no activa /rh/asistencia.
    expect(layout).toContain('it.to.length > best.to.length');
  });

  it('uses compact premium shells for employee and shift editors', () => {
    expect(employees).toContain('<FullScreenModal');
    expect(schedules).toContain('<FullScreenModal');
    expect(shiftForm).toContain('hr-shift-modal-content');
    expect(shiftForm).toContain('<Tabs');
    expect(shiftForm).toContain('className="hr-modal-form-footer"');
  });

  it('styles attendance controls without leaking into React Select internals', () => {
    // Layout migrado: filas de configuración con controles de @/ui (sin estilos sobre inputs nativos).
    expect(settingsSection).toContain('export function HrSettingRow');
    expect(attendanceSettings).toContain('<HrSettingRow');
    expect(attendanceSettings).toContain('¿Qué es el proveedor biométrico?');
    expect(attendanceSettings).toContain('Verificar conexión');
  });

  it('exposes the statutory payroll configuration with explicit labels', () => {
    expect(payroll).toContain('Configurar IR, INSS e INATEC');
    expect(payroll).toContain('Configuración legal: IR, INSS e INATEC');
    expect(payroll).toContain('/rh/nomina/configuracion-legal?ruleId=');
    expect(payrollLegal).toContain('IR laboral, INSS e INATEC');
    expect(payrollLegal).toContain('<PayrollRuleConfigurationPanel');
  });

  it('keeps every RH sidebar compact and the manual punch in one canonical body', () => {
    expect(hrSource).not.toContain('width="wide"');
    expect(attendanceReview).toContain('<HrModalFormShell');
    expect(attendanceReview).toContain('formClassName="hr-attendance-manual-form"');
    expect(attendanceReview.match(/title="Marcaje manual supervisado"/g)).toHaveLength(1);
    expect(attendanceReview).not.toContain('<div className="modal-tab-content">\n                    <Select<Option>');
  });

  it('uses one accessible typography and spacing contract for RH modal forms', () => {
    expect(modalShell).toContain('<FormSection');
    expect(modalShell).toContain('<FormGrid>');
    expect(modalShell).toContain('aria-label={ariaLabel}');
    expect(modalStyles).toContain('font-family: inherit');
    expect(modalStyles).toContain('font-size: 14px');
    expect(modalStyles).toContain('min-height: 42px');
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
