import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
const schedules = read('../../pages/hr/Schedules.tsx');
const scheduleStyles = read('../../pages/hr/schedule.css');
const legalSettings = read('../../pages/hr/PayrollLegalSettings.tsx');
const legalPanel = read('./PayrollRuleConfigurationPanel.tsx');
const legalStyles = read('../../pages/hr/payroll-legal.css');

describe('RH UX/UI V2 schedule and legal configuration contract', () => {
  // Layout migrado al design system: las acciones de la semana viven en las acciones de PageHeader y los filtros en TableToolbar.
  it('keeps schedule actions in the page header without a redundant action bar', () => {
    expect(schedules).toMatch(/<PageHeader[\s\S]*Copiar semana[\s\S]*Cancelar semana[\s\S]*Publicar semana[\s\S]*<TableToolbar/);
    expect(schedules).toContain('scheduleClient.cancelSchedule');
    expect(schedules).not.toContain('hr-schedule-actions-bar');
    expect(scheduleStyles).not.toContain('hr-schedule-actions-bar');
  });

  it('uses the shared TableToolbar for schedule filters instead of page-specific widths', () => {
    expect(schedules).toContain('<TableToolbar');
    expect(schedules).toContain('<AppSelect<string> aria-label="Sucursal"');
    expect(scheduleStyles).not.toContain('.hr-schedule-filters');
  });

  it('hides the positive online payroll notice while preserving the offline warning', () => {
    expect(legalSettings).toContain('{!online && <PayrollOnlineNotice online={online} />}');
    expect(legalSettings).not.toContain('\n      <PayrollOnlineNotice online={online} />');
  });

  // Layout migrado: la identidad de la versión usa las celdas apiladas compartidas (título + subtítulo) de la DataTable.
  it('separates legal version identity in the versions table', () => {
    expect(legalSettings).toContain('Versión {rule.version}');
    expect(legalSettings).toContain('<span className={form.cellTitle}>{rule.name}</span>');
  });

  it('right-aligns editable and read-only legal numeric values', () => {
    expect(legalPanel).toContain('ariaLabel="Tramos de IR vigentes"');
    expect(legalPanel).toContain("type: 'money'");
    expect(legalPanel).toContain('className="ui-input--number"');
    expect(legalStyles).toContain('font-variant-numeric: tabular-nums');
  });

  it('organizes legal settings as a control center with one selected-version workspace', () => {
    // Layout migrado: centro de control y espacio de la versión abierta con paneles de un solo nivel (form.panel / form.split).
    expect(legalSettings).toContain('aria-label="Centro de control legal de nómina"');
    expect(legalSettings).toContain('aria-label="Espacio de trabajo de la versión abierta"');
    expect(legalSettings).toContain('className={form.split}');
    expect(legalStyles).toContain('.hr-legal-readonly-operational dl');
  });
});
