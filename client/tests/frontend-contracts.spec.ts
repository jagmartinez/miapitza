import { expect, test, type Page } from '@playwright/test';

async function mockAuthenticatedAdmin(page: Page, options: { companyId: number; branchId: number | null; role?: string }) {
  const role = options.role || 'ADMIN';
  await page.addInitScript(({ companyId, branchId, roleName }) => {
    localStorage.setItem('user', JSON.stringify({
      id: 902,
      name: 'QA Admin',
      companyId,
      branchId,
      roles: [{ id: 1, name: roleName }],
    }));
  }, { companyId: options.companyId, branchId: options.branchId, roleName: role });
}

test('global administrator can select a branch when creating a reservation', async ({ page }) => {
  await mockAuthenticatedAdmin(page, { companyId: 7, branchId: null });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = { id: 902, companyId: 7, branchId: null, roles: ['ADMIN'] };
    if (path.endsWith('/branches')) data = [
      { id: 10, name: 'Centro', status: 'ACTIVE' },
      { id: 11, name: 'Norte', status: 'ACTIVE' },
    ];
    if (path.endsWith('/settings')) data = { currency_symbol: 'C$' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });

  await page.goto('/reservations');
  await page.getByRole('button', { name: /Nueva Reservaci/ }).click();
  await page.getByRole('tab', { name: 'Reserva' }).click();
  await expect(page.getByText('Sucursal', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox').filter({ has: page.locator('option') })).toHaveCount(0);
  await expect(page.locator('.modal-tab-content').getByRole('combobox').first()).toBeVisible();
});

test('branch admin sees only the PedidosYa contract allowed by the server', async ({ page }) => {
  await mockAuthenticatedAdmin(page, { companyId: 7, branchId: 10 });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = { id: 902, companyId: 7, branchId: 10, roles: ['ADMIN'] };
    if (path.endsWith('/pedidosya/config')) {
      data = { id: 99, branchId: 10, environment: 'sandbox', autoAcceptOrders: false, autoSyncStatus: true, active: false };
    }
    if (path.endsWith('/settings')) data = { currency_symbol: 'C$' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });

  await page.goto('/integraciones/pedidosya');
  await expect(page.getByRole('button', { name: 'Configuración', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mapeo de Productos/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Probar Conexión/ })).toHaveCount(0);
  await expect(page.getByText(/\/api\/pedidosya\/webhook\/7$/)).toBeVisible();
});

test('new catering service follows the canonical tabbed modal contract', async ({ page }) => {
  await mockAuthenticatedAdmin(page, { companyId: 7, branchId: 10 });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = { id: 902, companyId: 7, branchId: 10, roles: ['ADMIN'] };
    if (path.endsWith('/settings')) data = { currency_symbol: 'C$' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });

  await page.goto('/catering-services');
  const trigger = page.getByRole('button', { name: 'Nuevo Servicio' });
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Nuevo Servicio de Catering' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Información general' })).toBeVisible();

  await dialog.getByRole('tab', { name: 'Costos y precios' }).click();
  await expect(dialog.getByRole('tab', { name: 'Costos y precios' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Análisis de costos y precios' })).toBeVisible();
  await expect(dialog.locator('.modal-footer')).toBeVisible();
});
