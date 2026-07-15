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
  accountType: 'EXTERNAL',
  status: 'ACTIVE',
};

async function mockApp(page: Page) {
  await page.addInitScript((storedUser) => {
    localStorage.setItem('user', JSON.stringify(storedUser));
    localStorage.setItem('sidebar-collapsed', 'true');
    localStorage.setItem('theme', 'dark');
  }, user);

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = user;
    if (path.endsWith('/settings')) data = { currency_symbol: 'C$' };
    if (path.endsWith('/v1/hr/dashboard')) {
      data = {
        employees: { total: 0, active: 0, suspended: 0, onLeave: 0, inactive: 0, internalAccounts: 0 },
        catalogs: { departments: 0, jobPositions: 0, costCenters: 0 },
        branches: { total: 0, geofenceConfigured: 0, attendanceEnabled: 0 },
      };
    }
    if (path.includes('/tables/plan/')) {
      data = { id: null, branchId: 10, canvasWidth: 1600, canvasHeight: 900, version: 1, areas: [], tables: [] };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    });
  });
}

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

test('operational table map uses the complete viewport without lateral gutters', async ({ page }) => {
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
  await expect(page.getByRole('link', { name: 'Asistencia', exact: true })).not.toHaveClass(/\bactive\b/);
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

test('shared dialogs use the muted accent palette in dark mode', async ({ page }) => {
  await mockApp(page);
  await page.goto('/reservations');
  await page.getByRole('button', { name: 'Nueva Reservación' }).click();

  const dialog = page.getByRole('dialog', { name: 'Nueva Reservación' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Nueva Reservación' })).toHaveCSS('color', 'rgb(248, 250, 252)');
  await expect(dialog.getByRole('tab', { name: 'Cliente' })).toHaveCSS('background-color', 'rgb(95, 125, 168)');
  await expect(dialog.getByRole('button', { name: 'Crear Reservación' })).toHaveCSS('background-color', 'rgb(95, 125, 168)');

  const customerName = dialog.getByLabel('Nombre del Cliente');
  await customerName.focus();
  await expect(customerName).toHaveCSS('border-color', 'rgb(95, 125, 168)');
});

test('report header select aligns with Excel and category filters have room', async ({ page }) => {
  await mockApp(page);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto('/reporteria/sales');

  const headerActions = page.locator('.page-header-actions');
  await expect(headerActions).toBeVisible();
  await expect(headerActions.locator('.select-label')).toHaveCount(0);

  const geometry = await page.evaluate(() => {
    const select = document.querySelector('.page-header-actions .report-view-select')!.getBoundingClientRect();
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
  await expect(dialog.locator('.modal-content-group').first()).toHaveCSS('border-left-width', '0px');
});

test('RH primary and secondary views share the 1700px layout and React Select controls', async ({ page }) => {
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
