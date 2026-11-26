import { expect, test, type Page } from '@playwright/test';

const user = {
  id: 903,
  name: 'QA Admin',
  email: 'qa-admin@example.com',
  username: 'qa-admin',
  companyId: 7,
  branchId: 10,
  role: { id: 1, name: 'ADMIN' },
  roles: [{ id: 1, name: 'ADMIN' }],
  accountType: 'EXTERNAL',
  status: 'ACTIVE',
};

async function mockApi(page: Page, failing: Record<string, { status: number; body: unknown }>) {
  await page.addInitScript((storedUser) => {
    localStorage.setItem('user', JSON.stringify(storedUser));
  }, user);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const failure = Object.entries(failing).find(([suffix]) => path.endsWith(suffix));
    if (failure) {
      await route.fulfill({ status: failure[1].status, contentType: 'application/json', body: JSON.stringify(failure[1].body) });
      return;
    }
    const data = path.endsWith('/auth/me') ? user : path.endsWith('/settings') ? { currency_symbol: 'C$' } : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
}

test('a failed list load is announced in Spanish instead of leaving an empty page', async ({ page }) => {
  await mockApi(page, { '/menu-brands': { status: 500, body: { success: false, message: 'Error interno del servidor' } } });
  await page.goto('/menu-brands');

  const urgent = page.getByTestId('toast-stack-urgent');
  await expect(urgent).toHaveAttribute('aria-live', 'assertive');
  await expect(urgent.locator('.toast-error')).toContainText('No se pudieron cargar las marcas: Error interno del servidor. Intenta de nuevo');
});

test('server domain messages reach the user without duplicate toasts', async ({ page }) => {
  await mockApi(page, { '/roles': { status: 403, body: { success: false, message: 'No autorizado para operar en esta empresa' } } });
  await page.goto('/roles-permissions');
  const toast = page.locator('.toast-error').filter({ hasText: 'No se pudieron cargar los roles y permisos: No autorizado para operar en esta empresa' });
  await expect(toast).toHaveCount(1);
});

test('unhandled promise rejections become a visible toast', async ({ page }) => {
  await mockApi(page, {});
  await page.goto('/dashboard');
  await page.evaluate(() => {
    void Promise.reject(Object.assign(new Error('Seleccione una sucursal antes de continuar')));
  });
  await expect(page.locator('.toast-error')).toContainText('Seleccione una sucursal antes de continuar');
});

test('toasts stay above the tablet bottom navigation', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await mockApi(page, { '/menu-brands': { status: 503, body: { success: false, message: 'Error interno del servidor' } } });
  await page.goto('/menu-brands');
  const toast = page.locator('.toast-error').first();
  await expect(toast).toBeVisible();
  const nav = page.locator('.mobile-bottom-nav');
  await expect(nav).toBeVisible();
  const toastBox = await toast.boundingBox();
  const navBox = await nav.boundingBox();
  expect(toastBox && navBox && toastBox.y + toastBox.height <= navBox.y).toBeTruthy();
});
