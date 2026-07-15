import { expect, test } from '@playwright/test';

test('shows the accessible login form', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
  await expect(page.getByLabel('Usuario')).toBeFocused();
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mostrar contraseña' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar Sesión' })).toBeVisible();
});

test('requests and validates the six-digit 2FA code', async ({ page }) => {
  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'x-csrf-token': 'csrf-login-test' },
      body: JSON.stringify({ success: true }),
    });
  });
  await page.route('**/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { requires2FA: true } }),
    });
  });

  await page.goto('/login');
  await page.getByLabel('Usuario').fill('usuario_prueba');
  await page.getByLabel('Contraseña', { exact: true }).fill('clave_prueba');
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();

  const twoFactorInput = page.getByLabel('Código de verificación de 6 dígitos');
  await expect(twoFactorInput).toBeVisible();
  await expect(twoFactorInput).toBeFocused();
  await twoFactorInput.fill('12345');
  await expect(page.getByRole('button', { name: 'Iniciar Sesión' })).toBeDisabled();
  await twoFactorInput.fill('123456');
  await expect(page.getByRole('button', { name: 'Iniciar Sesión' })).toBeEnabled();
});

test('renders translated authentication errors', async ({ page }) => {
  await page.route('**/health', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/auth/login', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Invalid credentials' }),
    });
  });

  await page.goto('/login');
  await page.getByLabel('Usuario').fill('usuario_prueba');
  await page.getByLabel('Contraseña', { exact: true }).fill('clave_incorrecta');
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();

  await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos');
  await expect(page.getByLabel('Usuario')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveAttribute('aria-invalid', 'true');
});
