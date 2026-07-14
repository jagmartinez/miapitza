import { expect, test, type Page } from '@playwright/test';

async function mockAdmin(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('user', JSON.stringify({
      id: 902,
      name: 'QA Admin',
      companyId: 7,
      branchId: 10,
      roles: [{ id: 1, name: 'ADMIN' }],
    }));
  });

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/me')) {
      data = { id: 902, companyId: 7, branchId: 10, roles: ['ADMIN'] };
    }
    if (path.endsWith('/settings')) data = { currency_symbol: 'C$' };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    });
  });
}

test('new catering event keeps auxiliary actions aligned and footer explicit', async ({ page }) => {
  await page.setViewportSize({ width: 795, height: 862 });
  await mockAdmin(page);
  await page.goto('/catering');

  await page.getByRole('button', { name: 'Nuevo Evento' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo Evento de Catering' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Menú' }).click();

  const stockButton = dialog.getByRole('button', { name: 'Verificar inventario' });
  await expect(stockButton).toBeVisible();
  await expect(stockButton).toHaveCSS('white-space', 'nowrap');
  await expect(dialog.getByText('Menú pendiente')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Crear Evento' })).toBeVisible();
  await expect(dialog.locator('.modal-footer')).toBeVisible();
});

test('cash register editor exposes keyboard-accessible tabs', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('/cash-registers');

  await page.getByRole('button', { name: 'Nueva Caja' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva Caja Registradora' });
  const general = dialog.getByRole('tab', { name: 'General' });
  const configuration = dialog.getByRole('tab', { name: 'Configuración' });

  await expect(general).toHaveAttribute('aria-selected', 'true');
  await configuration.click();
  await expect(configuration).toHaveAttribute('aria-selected', 'true');
  await expect(general).toHaveAttribute('aria-selected', 'false');
  await expect(dialog.getByRole('button', { name: 'Guardar Caja' })).toBeVisible();
});
