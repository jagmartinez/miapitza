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
  it('keeps schedule actions in the filters toolbar without a redundant action bar', () => {
    expect(schedules).toMatch(/filters-toolbar hr-schedule-filters[\s\S]*filter-actions[\s\S]*Copiar semana[\s\S]*Publicar semana[\s\S]*Cancelar semana/);
    expect(schedules).toContain('scheduleClient.cancelSchedule');
    expect(schedules).not.toContain('hr-schedule-actions-bar');
    expect(scheduleStyles).not.toContain('hr-schedule-actions-bar');
  });

  it('gives schedule selects and wrapped actions practical responsive width', () => {
    expect(scheduleStyles).toContain('flex: 1 1 330px');
    expect(scheduleStyles).toContain('max-width: 440px');
    expect(scheduleStyles).toContain('.hr-schedule-filters .filter-actions');
    expect(scheduleStyles).toContain('flex: 1 1 150px');
  });

  it('hides the positive online payroll notice while preserving the offline warning', () => {
    expect(legalSettings).toContain('{!online && <PayrollOnlineNotice online={online} />}');
    expect(legalSettings).not.toContain('\n      <PayrollOnlineNotice online={online} />');
  });

  it('separates and enlarges legal version identity and table headings', () => {
    expect(legalSettings).toContain('hr-legal-version-number');
    expect(legalSettings).toContain('hr-legal-version-name');
    expect(legalStyles).toContain('.hr-legal-version-list thead th');
    expect(legalStyles).toContain('font-size: 21px');
    expect(legalStyles).toContain('font-size: 13px');
  });

  it('right-aligns editable and read-only legal numeric values', () => {
    expect(legalPanel).toContain('className="hr-legal-ir-readonly-table"');
    expect(legalStyles).toContain(".hr-legal-settings-page input[type='number']");
    expect(legalStyles).toContain('.hr-legal-ir-readonly-table td:nth-child(n+2)');
    expect(legalStyles).toContain('font-variant-numeric: tabular-nums');
  });

  it('organizes legal settings as a control center with one selected-version workspace', () => {
    expect(legalSettings).toContain('hr-legal-command-center');
    expect(legalSettings).toContain('hr-legal-selected-shell');
    expect(legalSettings).toContain('hr-legal-selected-aside');
    expect(legalSettings).toContain('hr-legal-selected-main');
    expect(legalStyles).toContain('grid-template-columns: minmax(320px, 370px) minmax(0, 1fr)');
    expect(legalStyles).toContain('.hr-legal-readonly-operational dl');
  });
});
