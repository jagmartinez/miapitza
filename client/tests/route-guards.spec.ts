import { expect, test } from '@playwright/test';

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
