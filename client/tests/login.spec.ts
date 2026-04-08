import { expect, test } from '@playwright/test';

test('shows the login form', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByLabel('Usuario')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar Sesión' })).toBeVisible();
});
