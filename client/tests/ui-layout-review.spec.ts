import { expect, test, type Page } from '@playwright/test';

const user = {
  id: 902,
  name: 'UI Review',
  email: 'ui-review@example.com',
  username: 'ui-review',
  companyId: 7,
  branchId: 10,
  role: { id: 1, name: 'SUPERADMIN' },
  roles: [{ id: 1, name: 'SUPERADMIN' }],
  accountType: 'INTERNAL',
  employeeId: 321,
  employee: { id: 321, employeeCode: 'EMP-321', status: 'ACTIVE' },
  branch: { id: 10, name: 'Sucursal QA' },
  status: 'ACTIVE',
};

const payrollRun = {
  id: 91,
  code: 'NOMINA-QA-2026-07',
  kind: 'REGULAR',
  periodId: 71,
  period: { id: 71, code: '2026-QA-01', dateFrom: '2026-07-01', dateTo: '2026-07-15', payDate: '2026-07-16' },
  status: 'PAID',
  ruleVersionId: 81,
  configurationRevisionId: 801,
  revision: 1,
  anomalyCount: 0,
  blockingAnomalyCount: 0,
  allowedActions: [],
  totals: { currency: 'NIO', grossIncome: '15000', totalDeductions: '2200', employerContributions: '3500', netPay: '12800', employeeCount: 1 },
};

async function mockApp(page: Page, activeUser = user) {
  await page.addInitScript((storedUser) => {
    localStorage.setItem('user', JSON.stringify(storedUser));
    localStorage.setItem('sidebar-collapsed', 'true');
    localStorage.setItem('theme', 'dark');
  }, activeUser);

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = activeUser;
    if (path.endsWith('/settings')) data = { currency_symbol: 'C$' };
    if (path.endsWith('/menu-items')) {
      data = [
        {
          id: 1,
          name: 'Plato QA',
          description: 'Detalle verificable',
          price: 250,
          categoryId: 3,
          branchId: null,
          brandId: null,
          category: { id: 3, name: 'Especialidades' },
          recipes: [],
          images: [],
          active: true,
        },
      ];
    }
    if (path.endsWith('/menu-items/1')) {
      data = {
        id: 1,
        name: 'Plato QA',
        description: 'Detalle verificable',
        price: 250,
        totalCost: 75,
        margin: 175,
        categoryId: 3,
        branchId: null,
        brandId: null,
        category: { id: 3, name: 'Especialidades' },
        recipes: [
          {
            id: 9,
            menuItemId: 1,
            productId: 4,
            quantity: 2,
            unit: 'lb',
            product: { id: 4, name: 'Ingrediente QA', unit: 'lb', cost: 30 },
          },
        ],
        active: true,
      };
    }
    if (path.endsWith('/menu-items/1/images')) data = [];
    if (path.endsWith('/advanced/pricing/1')) data = { branchPrices: [] };
    if (path.endsWith('/catering')) {
      data = [
        {
          id: 41,
          title: 'Evento Catering QA',
          customer: { name: 'Cliente QA', phone: '8888-0000' },
          date: '2026-07-20T18:00:00.000Z',
          peopleCount: 60,
          status: 'RESERVED',
          totalAmount: 18000,
          balance: 9000,
          subtotal: 15652.17,
          tax: 2347.83,
          location: 'Salón QA',
        },
      ];
    }
    if (path.endsWith('/v1/hr/payroll/rules')) {
      data = [
        {
          id: 81,
          name: 'Regla legal QA',
          version: 1,
          status: 'ACTIVE',
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          sourceReference: 'Normativa QA',
          description: 'Control legal',
          configurationSummary: null,
          activeConfigurationRevisionId: null,
          revision: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ];
    }
    if (path.endsWith('/v1/hr/payroll/company-tax-profile')) {
      data = {
        companyId: 1,
        companyName: 'Empresa QA',
        taxRegime: 'GENERAL',
        incomeTaxWithholding: true,
        sourceReference: 'Perfil fiscal QA',
        incomeTaxException: null,
        ready: true,
        updatedAt: '2026-07-16T00:00:00.000Z',
      };
    }
    if (path.endsWith('/v1/hr/payroll/periods')) {
      data = [{
        id: 71,
        code: '2026-QA-01',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-15',
        payDate: '2026-07-16',
        timezone: 'America/Managua',
        status: 'OPEN',
        revision: 1,
        reason: 'Periodo visual QA',
      }];
    }
    if (path.endsWith('/v1/hr/payroll/runs')) data = [payrollRun];
    if (path.endsWith('/v1/hr/payroll/aguinaldo/runs')) data = [];
    if (path.endsWith('/v1/hr/payroll/runs/91')) data = payrollRun;
    if (path.endsWith('/v1/hr/payroll/runs/91/anomalies')) data = [];
    if (path.endsWith('/v1/hr/payroll/runs/91/snapshot')) data = [{ id: 1, userId: 321, user: { id: 902, name: 'Empleado QA', username: 'empleado-qa' }, branch: { id: 10, name: 'Sucursal QA' }, approvedOvertimeMinutes: 60 }];
    if (path.endsWith('/v1/hr/payroll/runs/91/components')) data = [
      { id: 1, userId: 321, code: 'SALARIO', name: 'Salario ordinario', type: 'INCOME', amount: '15000', source: 'CONTRACT' },
      { id: 2, userId: 321, code: 'INSS', name: 'INSS laboral', type: 'DEDUCTION', amount: '1050', source: 'STATUTORY' },
    ];
    if (path.endsWith('/v1/hr/payroll/runs/91/receipts')) data = [];
    if (path.endsWith('/v1/hr/payroll/runs/91/employer-contributions')) data = [];
    if (path.endsWith('/v1/hr/payroll/runs/91/statutory-calculations')) data = [];
    if (path.endsWith('/v1/hr/payroll/rules/81/configuration-revisions')) data = [];
    if (path.endsWith('/v1/hr/me/schedule')) data = [];
    if (path.endsWith('/v1/hr/me/attendance/summary')) data = [];
    if (path.endsWith('/v1/hr/me/workforce')) {
      data = {
        timezone: 'America/Managua',
        incidents: [],
        corrections: [],
        overtimeRequests: [],
        leaveRequests: [],
        vacationBalances: [],
        vacationLedger: [],
      };
    }
    if (path.endsWith('/v1/hr/payroll/me/receipts')) data = [];
    if (path.endsWith('/v1/hr/benefits/me/travel-requests')) data = [];
    if (path.endsWith('/v1/hr/benefits/me/loans')) data = [];
    if (path.endsWith('/v1/hr/benefits/me/deductions')) data = [];
    if (path.endsWith('/v1/hr/attendance/policy')) {
      data = {
        version: 1,
        timezone: 'America/Managua',
        requireBiometric: false,
        requireLiveness: false,
        requireGeolocation: false,
        maxLocationAccuracyM: 100,
        earlyCheckInMinutes: 15,
        lateCheckInToleranceM: 10,
        earlyCheckOutToleranceM: 10,
        lateCheckOutMinutes: 15,
        scheduleViolationMode: 'REVIEW',
        geofenceViolationMode: 'REVIEW',
        biometricViolationMode: 'REVIEW',
        allowUnscheduledPunch: true,
        unscheduledViolationMode: 'REVIEW',
        allowManualFallback: true,
        biometricConsentVersion: 'QA-1',
        biometricRetentionDays: 30,
      };
    }
    if (path.endsWith('/v1/hr/me/attendance/today')) {
      data = {
        serverTime: '2026-07-16T18:00:00.000Z',
        timezone: 'America/Managua',
        availableActions: ['CHECK_IN'],
        punches: [],
        scheduledShift: null,
      };
    }
    if (path.endsWith('/v1/hr/biometrics/me')) data = { status: 'NOT_ENROLLED', canEnroll: true };
    if (path.endsWith('/v1/hr/dashboard')) {
      data = {
        employees: {
          total: 0,
          active: 0,
          suspended: 0,
          onLeave: 0,
          inactive: 0,
          internalAccounts: 0,
        },
        catalogs: { departments: 0, jobPositions: 0, costCenters: 0 },
        branches: { total: 0, geofenceConfigured: 0, attendanceEnabled: 0 },
        attention: {
          leaveRequests: 2,
          overtimeRequests: 1,
          attendanceCorrections: 1,
          attendanceIncidents: 0,
          loanRequests: 1,
        },
        payroll: { activeRule: true, draftRuns: 1, reviewRuns: 0, approvedRuns: 0 },
      };
    }
    if (path.includes('/tables/plan/')) {
      data = {
        id: null,
        branchId: 10,
        canvasWidth: 1600,
        canvasHeight: 900,
        version: 1,
        areas: [],
        tables: [],
      };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    });
  });
}

test('login brand icon is centered and the page uses one continuous background', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto('/login');

  const mark = page.locator('.login-brand .login-brand__mark');
  const icon = mark.locator('svg');
  await expect(mark).toBeVisible();
  await expect(icon).toBeVisible();

  const geometry = await page.evaluate(() => {
    const markBox = document
      .querySelector('.login-brand .login-brand__mark')!
      .getBoundingClientRect();
    const iconBox = document
      .querySelector('.login-brand .login-brand__mark svg')!
      .getBoundingClientRect();
    const accessStyles = getComputedStyle(document.querySelector('.login-access')!);

    return {
      horizontalOffset: Math.abs(
        markBox.left + markBox.width / 2 - (iconBox.left + iconBox.width / 2)
      ),
      verticalOffset: Math.abs(
        markBox.top + markBox.height / 2 - (iconBox.top + iconBox.height / 2)
      ),
      accessBackground: accessStyles.backgroundColor,
      accessBackgroundImage: accessStyles.backgroundImage,
      accessBorderLeft: accessStyles.borderLeftWidth,
    };
  });

  expect(geometry.horizontalOffset).toBeLessThanOrEqual(1);
  expect(geometry.verticalOffset).toBeLessThanOrEqual(1);
  expect(geometry.accessBackground).toBe('rgba(0, 0, 0, 0)');
  expect(geometry.accessBackgroundImage).toBe('none');
  expect(geometry.accessBorderLeft).toBe('0px');
});

test('all representative routed views expose the 1700px cap', async ({ page }) => {
  await mockApp(page);
  await page.setViewportSize({ width: 1920, height: 1000 });

  for (const path of ['/kitchen', '/reservations', '/catering-services']) {
    await page.goto(path);
    const view = page.locator('.main-content-inner > *');
    await expect(view).toHaveCount(1);
    await expect(view).toHaveCSS('max-width', '1700px');
  }
});

test('operational table map uses the complete viewport without lateral gutters', async ({
  page,
}) => {
  await mockApp(page);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto('/tables');

  const map = page.locator('.tables-page--map');
  await expect(map).toBeVisible();
  const geometry = await map.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    return {
      left: box.left,
      right: box.right,
      width: box.width,
      paddingLeft: styles.paddingLeft,
      paddingRight: styles.paddingRight,
      viewportWidth: window.innerWidth,
    };
  });

  expect(Math.abs(geometry.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.viewportWidth - geometry.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.viewportWidth - geometry.width)).toBeLessThanOrEqual(1);
  expect(geometry.paddingLeft).toBe('0px');
  expect(geometry.paddingRight).toBe('0px');
});

test('attendance settings activates only its exact navigation option', async ({ page }) => {
  await mockApp(page);
  await page.goto('/rh/asistencia/configuracion');

  const activeItems = page.locator('.sidebar-nav .nav-item.active');
  await expect(activeItems).toHaveCount(1);
  await expect(activeItems).toHaveText('Configurar asistencia');
  await expect(page.getByRole('link', { name: 'Asistencia', exact: true })).not.toHaveClass(
    /\bactive\b/
  );
});

test('menu modal has no nested card spacing or reserved right gutter', async ({ page }) => {
  await mockApp(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/menu');
  await page.getByRole('button', { name: 'Nuevo Plato' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo Plato' })).toBeVisible();
  await expect(page.locator('.sidebar-panel.sidebar-open')).toHaveCSS('right', '0px');

  const section = page.locator('.modal-content-group');
  await expect(section).toHaveCSS('padding-left', '0px');
  await expect(section).toHaveCSS('padding-right', '0px');
  await expect(section).toHaveCSS('border-left-width', '0px');

  const geometry = await page.evaluate(() => {
    const panel = document.querySelector('.sidebar-panel.sidebar-open')!.getBoundingClientRect();
    const tabContent = document.querySelector('.modal-tab-content')!.getBoundingClientRect();
    const sectionBox = document.querySelector('.modal-content-group')!.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      panelLeft: panel.left,
      panelWidth: panel.width,
      panelRight: panel.right,
      contentWidth: tabContent.width,
      contentRight: tabContent.right,
      sectionRight: sectionBox.right,
      gutter: getComputedStyle(document.querySelector('.modal-tab-content')!).scrollbarGutter,
    };
  });

  expect(geometry.gutter).toBe('auto');
  expect(geometry.contentRight - geometry.sectionRight).toBeLessThanOrEqual(25);
  expect(Math.abs(geometry.panelRight - geometry.contentRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry.viewportWidth - geometry.panelRight)).toBeLessThanOrEqual(1);
});

test('menu view action opens a read-only recipe-style detail instead of the editor', async ({
  page,
}) => {
  await mockApp(page);
  await page.goto('/menu');

  await page.getByRole('button', { name: 'Ver detalle de Plato QA' }).click();
  const dialog = page.getByRole('dialog', { name: 'Detalle del Plato' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-testid="menu-item-detail"]')).toBeVisible();
  await expect(dialog.getByText('Ficha del catálogo')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Componentes de la receta' })).toBeVisible();
  await expect(dialog.getByText('Ingrediente QA')).toBeVisible();
  await expect(dialog.locator('form')).toHaveCount(0);
});

test('shared dialogs stay flat in dark mode and reserve blue for active controls', async ({ page }) => {
  await mockApp(page);
  await page.goto('/reservations');
  await page.getByRole('button', { name: 'Nueva Reservación' }).click();

  const dialog = page.getByRole('dialog', { name: 'Nueva Reservación' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('background-image', 'none');
  await expect(dialog.getByRole('heading', { name: 'Nueva Reservación' })).toHaveCSS(
    'color',
    'rgb(248, 250, 252)'
  );
  await expect(dialog.getByRole('tab', { name: 'Cliente' })).toHaveCSS(
    'background-color',
    'rgb(59, 130, 246)'
  );
  await expect(dialog.getByRole('button', { name: 'Crear Reservación' })).toHaveCSS(
    'background-color',
    'rgb(59, 130, 246)'
  );

  const customerName = dialog.getByLabel('Nombre del Cliente');
  await customerName.focus();
  await expect(customerName).toHaveCSS('border-color', 'rgb(59, 130, 246)');
});

test('report header select aligns with Excel and category filters have room', async ({ page }) => {
  await mockApp(page);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto('/reporteria/sales');

  const headerActions = page.locator('.page-header-actions');
  await expect(headerActions).toBeVisible();
  await expect(headerActions.locator('.select-label')).toHaveCount(0);

  const geometry = await page.evaluate(() => {
    const select = document
      .querySelector('.page-header-actions .report-view-select')!
      .getBoundingClientRect();
    const button = document.querySelector('.page-header-actions .btn')!.getBoundingClientRect();
    const category = document.querySelector('.filter-field-category')!.getBoundingClientRect();
    return {
      selectWidth: select.width,
      categoryWidth: category.width,
      selectCenter: select.top + select.height / 2,
      buttonCenter: button.top + button.height / 2,
    };
  });

  expect(geometry.selectWidth).toBeGreaterThanOrEqual(220);
  expect(geometry.categoryWidth).toBeGreaterThanOrEqual(240);
  expect(Math.abs(geometry.selectCenter - geometry.buttonCenter)).toBeLessThanOrEqual(1);
});

test('Catering event modal follows the shared flat modal layout', async ({ page }) => {
  await mockApp(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/catering');
  await page.getByRole('button', { name: 'Nuevo Evento', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Nuevo Evento de Catering' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.catering-event-intro')).toHaveCount(0);
  await expect(dialog.locator('.animate-slide-in')).toHaveCount(0);
  await expect(dialog.locator('.modal-content-group').first()).toHaveCSS('padding-left', '0px');
  await expect(dialog.locator('.modal-content-group').first()).toHaveCSS(
    'border-left-width',
    '0px'
  );
  await dialog.getByRole('tab', { name: 'Logística' }).click();
  await expect(dialog.getByRole('heading', { name: 'Logística y notas' })).toBeVisible();
  await expect(dialog.getByLabel('Ubicación')).toBeVisible();
  await dialog.getByRole('tab', { name: 'Datos' }).click();
  await expect(dialog.getByRole('heading', { name: 'Logística y notas' })).toHaveCount(0);
});

test('Catering services exposes a real paginated table view', async ({ page }) => {
  await mockApp(page);
  await page.goto('/catering');

  await page.getByRole('button', { name: 'Vista de tabla' }).click();
  const table = page.locator('.catering-events-table .catalog-table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Evento' })).toBeVisible();
  await expect(table.getByText('Evento Catering QA')).toBeVisible();
  await expect(table.getByText('C$ 18,000.00')).toBeVisible();
  await expect(table.getByRole('button', { name: 'Ver evento Evento Catering QA' })).toBeVisible();
});

test('KDS empty state spans and centers in the complete result area', async ({ page }) => {
  await mockApp(page);
  await page.setViewportSize({ width: 1743, height: 805 });
  await page.goto('/kitchen');

  const empty = page.locator('.kitchen-grid-new > .empty-state');
  await expect(empty).toBeVisible();
  await expect(empty).toHaveCSS('grid-column-start', '1');
  await expect(empty).toHaveCSS('grid-column-end', '-1');
  const centers = await page.evaluate(() => {
    const grid = document.querySelector('.kitchen-grid-new')!.getBoundingClientRect();
    const emptyState = document
      .querySelector('.kitchen-grid-new > .empty-state')!
      .getBoundingClientRect();
    return {
      gridCenter: grid.left + grid.width / 2,
      emptyCenter: emptyState.left + emptyState.width / 2,
    };
  });
  expect(Math.abs(centers.gridCenter - centers.emptyCenter)).toBeLessThanOrEqual(1);
});

test('catalog view toggles match adjacent primary action height and Kardex stays out of navigation', async ({
  page,
}) => {
  await mockApp(page);
  await page.goto('/menu');

  const toggle = page.locator('.catalog-view-toggle');
  const action = page.getByRole('button', { name: 'Nuevo Plato' });
  const [toggleBox, actionBox] = await Promise.all([toggle.boundingBox(), action.boundingBox()]);
  expect(toggleBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(Math.abs(toggleBox!.height - actionBox!.height)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('link', { name: 'Kardex', exact: true })).toHaveCount(0);
});

test('RH primary and secondary views share the 1700px layout and React Select controls', async ({
  page,
}) => {
  await mockApp(page);
  await page.setViewportSize({ width: 1920, height: 1000 });

  for (const path of ['/rh', '/rh/personal', '/rh/ausencias', '/rh/nomina', '/rh/prestaciones']) {
    await page.goto(path);
    const view = page.locator('.page-wrapper[class*="hr-"]');
    await expect(view).toBeVisible();
    await expect(view).toHaveCSS('max-width', '1700px');
    await expect(view.locator('select')).toHaveCount(0);
  }

  await page.goto('/rh/nomina');
  await expect(page.locator('.hr-react-select .react-select__control').first()).toBeVisible();
});

test('RH dashboard prioritizes pending work and the guided payroll route', async ({ page }) => {
  await mockApp(page);
  await page.goto('/rh');

  await expect(page.getByRole('heading', { name: 'Centro de trabajo RH' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Por atender' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ruta de nómina' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Permisos y vacaciones Revisar solicitudes del equipo 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reglas legales Configuración activa' })).toBeVisible();
});

test('employee portal and Profile expose a cohesive RH self-service entry point', async ({ page }) => {
  await mockApp(page);
  await page.goto('/rh/mi-portal');

  await expect(page.getByRole('heading', { name: 'Mi perfil' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Secciones de mi portal RH' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Mi información laboral' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mi biometría Consentimiento, enrolamiento y revocación' })).toBeVisible();

  await page.getByRole('link', { name: 'Mi horario Turnos publicados y acuse de lectura' }).click();
  await expect(page.getByRole('heading', { name: 'Mi horario' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Volver a Mis accesos de RH' })).toBeVisible();
  await expect(page.locator('.my-hr-page')).toHaveCSS('max-width', '1700px');

  await page.getByRole('link', { name: 'Mis accesos de RH' }).click();
  await expect(page.getByRole('heading', { name: 'Mi información laboral' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ir a marcaje' })).toBeVisible();
});

test('Profile and Mi RH destinations stay inside tablet and mobile viewports', async ({ page }) => {
  test.setTimeout(90_000);
  await mockApp(page);

  for (const viewport of [
    { width: 1024, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/profile?tab=hr');
    await expect(page.getByRole('heading', { name: 'Mi información laboral' })).toBeVisible();

    for (const path of ['/rh/mi-portal/horario', '/rh/mi-portal/gestion', '/rh/mi-portal/nomina', '/rh/mi-portal/prestaciones', '/rh/marcaje', '/rh/biometria']) {
      await page.goto(path);
      const backLink = page.locator('.my-hr-nav a');
      await expect(backLink).toBeVisible();
      const box = await backLink.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
  }
});

test('Profile explains missing employee linkage instead of hiding Mi RH', async ({ page }) => {
  await mockApp(page, { ...user, accountType: 'EXTERNAL', employeeId: undefined, employee: undefined });
  await page.goto('/profile');
  await page.getByRole('tab', { name: 'Mi RH' }).click();
  await expect(page.getByRole('heading', { name: 'Esta cuenta todavía no está vinculada a un empleado' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Vincular en Personal' })).toBeVisible();
});

test('payroll operation stays readable in dark mode', async ({ page }) => {
  await mockApp(page);
  await page.goto('/rh/nomina');
  const workspace = page.locator('.payroll-operation-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace).toHaveCSS('background-color', 'rgb(30, 41, 59)');
  await expect(page.getByRole('heading', { name: 'NOMINA-QA-2026-07' })).toHaveCSS('color', 'rgb(248, 250, 252)');
  await expect(page.getByRole('heading', { name: 'Pago por colaborador' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reportes y colillas' })).toBeVisible();
});

test('legal payroll settings is an independent RH view with one active navigation item', async ({
  page,
}) => {
  let revisionRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/v1/hr/payroll/rules/81/configuration-revisions')) {
      revisionRequests += 1;
    }
  });
  await mockApp(page);
  await page.goto('/rh/nomina/configuracion-legal');

  await expect(page.getByRole('heading', { name: 'IR laboral, INSS e INATEC' })).toBeVisible();
  await expect(page.locator('.sidebar-nav .nav-item.active')).toHaveCount(1);
  await expect(page.locator('.sidebar-nav .nav-item.active')).toHaveText('Reglas IR, INSS e INATEC');
  await expect(page.getByText('Regla legal QA', { exact: false }).first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Parámetros de la versión', exact: true })
  ).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(revisionRequests).toBeGreaterThan(0);
  expect(revisionRequests).toBeLessThanOrEqual(2);
});

test('manual attendance punch uses one compact canonical modal body', async ({ page }) => {
  await mockApp(page);
  await page.goto('/rh/asistencia');

  await page.getByRole('button', { name: 'Marcaje manual' }).click();
  const dialog = page.getByRole('dialog', { name: 'Marcaje manual supervisado' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('width', '800px');
  await expect(dialog.locator('.premium-modal-content')).toHaveCount(1);
  await expect(dialog.locator('.modal-tab-content')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Registrar marcaje manual' })).toBeVisible();
});

test('every HR creation flow uses the canonical modal shell', async ({ page }) => {
  await mockApp(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const expectCanonical = async (title: string) => {
    const dialog = page.getByRole('dialog', { name: title });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('right', '0px');
    await expect(dialog.locator('.premium-modal-content.hr-flow-modal-content')).toHaveCount(1);
    await expect(dialog.locator('.modal-tabs')).toHaveCount(1);
    await expect(dialog.locator('.modal-tab-content')).toHaveCount(1);
    await expect(dialog.locator('.modal-footer')).toHaveCount(1);
    await expect(dialog.locator('.sidebar-body')).toHaveCSS('padding-left', '0px');
    const geometry = await dialog.evaluate((element) => {
      const panel = element.getBoundingClientRect();
      const content = element.querySelector('.modal-tab-content')!.getBoundingClientRect();
      const footer = element.querySelector('.modal-footer')!.getBoundingClientRect();
      return {
        panelRight: panel.right,
        contentRight: content.right,
        footerRight: footer.right,
        viewportWidth: window.innerWidth,
      };
    });
    expect(Math.abs(geometry.panelRight - geometry.viewportWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.contentRight - geometry.panelRight)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.footerRight - geometry.panelRight)).toBeLessThanOrEqual(1);
    await dialog.getByRole('button', { name: `Cerrar ${title}` }).click();
  };

  await page.goto('/rh/jornadas');
  await page.getByRole('button', { name: 'Crear periodo' }).click();
  await expectCanonical('Nuevo periodo');

  await page.goto('/rh/ausencias');
  await page.getByRole('button', { name: 'Solicitud' }).click();
  await expectCanonical('Nueva solicitud');
  await page.getByRole('button', { name: 'Tipo' }).click();
  await expectCanonical('Tipo de ausencia');
  await page.getByRole('button', { name: 'Ajustar' }).click();
  await expectCanonical('Ajuste de vacaciones');

  await page.goto('/rh/nomina');
  await page.getByRole('button', { name: 'Periodos' }).click();
  await expectCanonical('Nuevo periodo de nómina');
  await page.getByRole('button', { name: 'Crear corrida de nómina' }).click();
  await expectCanonical('Crear corrida de nómina');
  await page.getByRole('tab', { name: 'Aguinaldo 0' }).click();
  await page.getByRole('button', { name: 'Crear aguinaldo' }).click();
  await expectCanonical('Crear aguinaldo');

  await page.goto('/rh/nomina/configuracion-legal');
  await page.getByRole('button', { name: 'Nueva versión' }).click();
  await expectCanonical('Nueva versión legal de nómina');

  await page.goto('/rh/prestaciones');
  await page.locator('.hr-benefits-header-actions').getByRole('button', { name: 'Nuevo viático', exact: true }).click();
  await expectCanonical('Nuevo viático');
  await page.getByRole('tab', { name: 'Préstamos 0' }).click();
  await page.locator('.hr-benefits-header-actions').getByRole('button', { name: 'Nuevo préstamo', exact: true }).click();
  await expectCanonical('Nueva solicitud de préstamo');
  await page.getByRole('tab', { name: 'Deducciones 0' }).click();
  await page.locator('.hr-benefits-header-actions').getByRole('button', { name: 'Nueva deducción', exact: true }).click();
  await expectCanonical('Nueva deducción');
});
