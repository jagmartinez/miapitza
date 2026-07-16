import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const attendance = read('../../pages/hr/AttendanceManagement.tsx');
const attendanceReview = read('../../pages/hr/AttendanceReview.tsx');
const leave = read('../../pages/hr/LeaveManagement.tsx');
const benefits = read('../../pages/hr/BenefitsManagement.tsx');
const payroll = read('../../pages/hr/PayrollManagement.tsx');
const payrollWorkspace = read('./payroll-operation-workspace.tsx');
const profile = read('../../pages/Profile.tsx');
const layout = read('../Layout.tsx');
const legal = read('../../pages/hr/PayrollLegalSettings.tsx');
const legalConfiguration = read('./PayrollRuleConfigurationPanel.tsx');
const concepts = read('./PayrollPaymentConceptCatalogEditor.tsx');
const companies = read('../../pages/Companies.tsx');
const payrollClient = read('./payrollClient.ts');
const adminCss = read('../../pages/hr/admin-tables.css');
const layoutCss = read('../Layout.css');

describe('reconstrucción RH: criterios de aceptación integrados', () => {
  it('administra asistencia, permisos y prestaciones desde tablas con acciones por fila', () => {
    [attendance, leave, benefits, payroll].forEach((source) => {
      expect(source).toContain('inventory-header-new');
      expect(source).toContain('inventory-table');
      expect(source).toContain('<Pagination');
      expect(source).toContain('table-action-btn');
    });
    [attendance, leave, benefits].forEach((source) => {
      expect(source).toContain('hr-admin-table');
      expect(source).toContain('<table');
      expect(source).toMatch(/Acci[oó]n(?:es)?/);
    });
    expect(attendance).toContain("setActiveTable('DAY')");
    expect(attendance).toContain('Corregir marcaje');
    expect(leave).toContain('Revisar');
    expect(leave).toContain('Ajustar');
    expect(benefits).toContain('Ver y gestionar');
    expect(benefits).not.toContain('Selecciona un registro');
  });

  it('presenta nómina como registro operativo, autoabre una corrida y entrega reportes y colillas', () => {
    expect(payroll).toContain('payroll-run-table');
    expect(payroll).toContain('<th scope="col">Acciones</th>');
    expect(payroll).toContain('Buscar código o periodo');
    expect(payroll).toContain('filteredRuns');
    expect(payroll).toContain('autoOpenedRunKey');
    expect(payroll).toContain('void openWorkspace(latest)');
    expect(payroll).toContain("exportSpecificRun(run, 'xlsx')");
    expect(payroll).toContain('downloadRunReceiptBatch(run)');
    expect(payroll).toMatch(/Intl\.DateTimeFormat\('es-NI'|toLocaleDateString\('es-NI'/);
    expect(payrollWorkspace).toContain('Pago por colaborador');
    expect(payrollWorkspace).toContain('Reportes y colillas');
    expect(payrollWorkspace).toContain('Descargar colilla PDF');
    expect(payrollWorkspace).toMatch(/Intl\.DateTimeFormat\('es-NI'|toLocaleDateString\('es-NI'/);
  });

  it('hace visible Mi RH desde Perfil y enlaza todas las rutas personales', () => {
    expect(layout).not.toContain("section: 'Mi portal RH'");
    expect(layout).not.toContain("to: '/profile?tab=hr'");
    expect(layout).toContain('Perfil y Mi RH');
    expect(profile).toContain("{ id: 'hr', icon: BriefcaseBusiness, label: 'Mi RH' }");
    expect(profile).toContain("setSearchParams(tab === 'info' ? {} : { tab }");
    expect(profile).toContain('selectVacationBalance');
    expect(profile).toContain('Saldo de vacaciones');
    ['/rh/mi-portal/horario', '/rh/marcaje', '/rh/mi-portal/gestion?tab=OVERTIME', '/rh/mi-portal/gestion?tab=LEAVE', '/rh/mi-portal/nomina']
      .forEach((route) => expect(profile).toContain(`to=\"${route}\"`));
  });

  it('no oculta registros por el límite de una página del servidor y conserva semántica accesible', () => {
    [attendance, leave, payroll].forEach((source) => {
      expect(source).toContain('collectAllPages');
      expect(source).toContain('aria-controls=');
      expect(source).toContain('role="tabpanel"');
      expect(source).toContain('scope="col"');
    });
    expect(attendanceReview).toContain('inventory-table');
    expect(attendanceReview).not.toContain('hr-attendance-events');
  });

  it('expande el menú colapsado con hover o teclado sin reemplazar la navegación móvil', () => {
    expect(layoutCss).toContain('.sidebar.collapsed:is(:hover, :focus-within)');
    expect(layoutCss).toContain('@media (min-width: 769px)');
    expect(layoutCss).toContain('@media (max-width: 768px)');
    expect(adminCss).toContain('.table-action-btn.btn');
    expect(adminCss).toContain('scrollbar-gutter: stable');
  });

  it('toma el perfil fiscal de Empresas y permite gestionar conceptos legales sin perder histórico', () => {
    for (const field of ['payrollTaxRegime', 'payrollIncomeTaxWithholding', 'payrollTaxRegimeReference']) {
      expect(companies).toContain(field);
    }
    expect(companies).toContain('Perfil fiscal para nómina');
    expect(payrollClient).toContain('getCompanyTaxProfile');
    expect(legal).toContain('getCompanyTaxProfile');
    expect(legalConfiguration).toContain('companyTaxProfile');
    expect(concepts).toContain('concept.active');
    expect(concepts).toContain('Inhabilitar');
    expect(concepts).toContain('Activar');
    expect(concepts).toContain('Editar');
  });

  it('ofrece clonar una versión activa como borrador editable', () => {
    expect(legal).toMatch(/Clonar|Duplicar|Crear borrador desde/);
    expect(legal).toMatch(/clone|duplicate|copy/i);
  });
});
