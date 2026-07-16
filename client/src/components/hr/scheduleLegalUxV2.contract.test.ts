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
    expect(schedules).toMatch(/filters-toolbar hr-schedule-filters[\s\S]*filter-actions[\s\S]*Copiar semana[\s\S]*Publicar semana/);
    expect(schedules).not.toContain('hr-schedule-actions-bar');
    expect(scheduleStyles).not.toContain('hr-schedule-actions-bar');
  });

  it('gives schedule selects and wrapped actions practical responsive width', () => {
    expect(scheduleStyles).toContain('flex: 1 1 270px');
    expect(scheduleStyles).toContain('max-width: 380px');
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
});
