import { expect, test, type Page } from '@playwright/test';

async function mockAuthenticatedRole(page: Page, role: string, accountType: 'INTERNAL' | 'EXTERNAL' = 'EXTERNAL') {
  const user = {
    id: 902,
    name: 'QA User',
    email: 'qa@example.com',
    username: 'qa-user',
    companyId: 7,
    branchId: 10,
    role: { id: 1, name: role },
    roles: [{ id: 1, name: role }],
    accountType,
    employeeId: accountType === 'INTERNAL' ? 1902 : null,
    status: 'ACTIVE',
  };
  await page.addInitScript((storedUser) => {
    localStorage.setItem('user', JSON.stringify(storedUser));
  }, user);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/auth/me')
      ? user
      : path.endsWith('/settings')
        ? { currency_symbol: 'C$' }
        : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    });
  });
}

test('redirects unauthenticated users to login from POS', async ({ page }) => {
  await page.goto('/pos');
  await expect(page).toHaveURL(/\/login$/);
});

test('redirects unauthenticated users to login from cash registers', async ({ page }) => {
  await page.goto('/cash-registers');
  await expect(page).toHaveURL(/\/login$/);
});

test('redirects unauthenticated users to login from manual', async ({ page }) => {
  await page.goto('/manual');
  await expect(page).toHaveURL(/\/login$/);
});

test('redirects unauthenticated users from the HR self-service portal', async ({ page }) => {
  await page.goto('/rh/mi-portal');
  await expect(page).toHaveURL(/\/login$/);
});

test('keeps HR administration restricted to the initial Owner role', async ({ page }) => {
  await mockAuthenticatedRole(page, 'ADMIN');
  await page.goto('/rh');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('allows an internal employee to open its own HR portal', async ({ page }) => {
  await mockAuthenticatedRole(page, 'AUDITOR_RH', 'INTERNAL');
  await page.goto('/rh/mi-portal');
  await expect(page).toHaveURL(/\/rh\/mi-portal$/);
});

test('keeps external accounts out of employee self-service', async ({ page }) => {
  await mockAuthenticatedRole(page, 'AUDITOR_RH', 'EXTERNAL');
  await page.goto('/rh/mi-portal');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('keeps external accounts out of attendance and biometric self-service', async ({ page }) => {
  await mockAuthenticatedRole(page, 'AUDITOR_RH', 'EXTERNAL');
  await page.goto('/rh/marcaje');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/rh/biometria');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('allows the Owner role to open attendance settings and benefits', async ({ page }) => {
  await mockAuthenticatedRole(page, 'SUPERADMIN', 'INTERNAL');
  await page.goto('/rh/asistencia/configuracion');
  await expect(page).toHaveURL(/\/rh\/asistencia\/configuracion$/);
  await page.goto('/rh/prestaciones');
  await expect(page).toHaveURL(/\/rh\/prestaciones$/);
});

test('loads the standalone html manual', async ({ page }) => {
  await page.goto('/manual-usuario.html');
  await expect(page.getByRole('heading', { name: 'Manual de usuario del sistema RestaurantOS' })).toBeVisible();
  await expect(page.getByRole('link', { name: '1. Acceso, sesion y perfil' })).toBeVisible();

  const search = page.getByPlaceholder('Buscar: cocina, caja, bodegas');
  await search.fill('catering');

  await expect(page.locator('#count')).toContainText('1 capitulo visible');
  await expect(page.locator('#capitulo-10')).toBeVisible();
  await expect(page.locator('#capitulo-03')).toBeHidden();
});
