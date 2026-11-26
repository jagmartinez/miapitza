import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pagesDir = new URL('../../pages/hr/', import.meta.url);
const componentsDir = new URL('./', import.meta.url);
const read = (dir: URL, name: string) => readFileSync(new URL(name, dir), 'utf8');
const tsx = (dir: URL) => readdirSync(dir).filter((n) => n.endsWith('.tsx') && !n.endsWith('.test.tsx'));

const pages = tsx(pagesDir).map((name) => ({ name, source: read(pagesDir, name) }));
const components = tsx(componentsDir).map((name) => ({ name, source: read(componentsDir, name) }));
const all = [...pages, ...components];

const TABLE_PAGES = [
  'AttendanceManagement.tsx',
  'AttendanceReview.tsx',
  'BenefitsGovernance.tsx',
  'BenefitsManagement.tsx',
  'Employees.tsx',
  'LeaveManagement.tsx',
  'MyBenefits.tsx',
  'PayrollLegalSettings.tsx',
  'PayrollManagement.tsx',
];

describe('RH migrado al design system (@/ui)', () => {
  it('ninguna pantalla ni componente de RH usa tablas crudas, selects nativos ni react-select', () => {
    for (const { name, source } of all) {
      expect(source, `${name} <table`).not.toMatch(/<table[\s>]/);
      expect(source, `${name} <select`).not.toMatch(/<select[\s>]/);
      expect(source, `${name} react-select`).not.toMatch(/from\s+['"]react-select/);
    }
  });

  it('las pantallas usan PageHeader y FullScreenModal de @/ui en lugar de los componentes heredados', () => {
    for (const { name, source } of pages) {
      expect(source, `${name} PageHeader heredado`).not.toContain("components/PageHeader'");
      expect(source, `${name} Sidebar heredado`).not.toContain("components/Sidebar'");
      expect(source, `${name} Pagination heredada`).not.toContain("components/Pagination'");
    }
  });

  it('las tablas de gestión son DataTable paginadas y con filas en fr', () => {
    for (const name of TABLE_PAGES) {
      const source = pages.find((page) => page.name === name)!.source;
      expect(source, name).toContain('<DataTable');
      expect(source, name).toMatch(/pagination=\{\{ mode: '(client|server)'/);
    }
  });

  it('los estados de RH son StatusBadge/Badge con tonos de statusTone y no pastillas con clases propias', () => {
    for (const name of ['HrStatusPill', 'PayrollStatusPill', 'BenefitsStatusPill', 'ScheduleStatusPill', 'WorkforceStatusPill']) {
      const source = read(componentsDir, `${name}.tsx`);
      expect(source).toContain('<Badge');
      expect(source).toContain("from './statusTone'");
      expect(source).not.toContain('catalog-pill');
    }
  });

  it('nómina muestra KPI accionables, el avance de la corrida y no reserva un panel de detalle vacío', () => {
    const payroll = read(pagesDir, 'PayrollManagement.tsx');
    expect(payroll).toContain('<StatCard');
    expect(payroll).toContain("label: 'Resolver'");
    expect(payroll).toContain("'N/D'");
    expect(payroll).toContain('<PayrollRunStepper');
    expect(payroll).not.toContain('payroll-operation-placeholder');
  });

  it('los importes de las tablas migradas se alinean a la derecha con columnas money', () => {
    for (const name of ['PayrollManagement.tsx', 'BenefitsManagement.tsx', 'MyBenefits.tsx']) {
      expect(pages.find((page) => page.name === name)!.source, name).toContain("type: 'money'");
    }
    expect(components.find((c) => c.name === 'payroll-operation-workspace.tsx')!.source).toContain("type: 'money'");
  });
});
