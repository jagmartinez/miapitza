import { expect, test } from '@playwright/test';

test('shows production yield with explicit unit and base-unit fallback', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('user', JSON.stringify({
      id: 901, name: 'QA Admin', companyId: 1, branchId: 1,
      roles: [{ id: 1, name: 'ADMIN' }],
    }));
  });

  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!requestUrl.pathname.includes('/api/')) return route.continue();
    const path = requestUrl.pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/me')) {
      data = { id: 901, companyId: 1, branchId: 1, roles: ['ADMIN'] };
    } else if (path.endsWith('/settings')) {
      data = { currency_symbol: 'C$' };
    } else if (route.request().method() === 'GET' && path.includes('/production-recipes')) {
      data = [
        {
          id: 1, companyId: 1, productId: 11, name: 'Lote explícito', version: 1,
          status: 'ACTIVE', yieldQuantity: 12, yieldUnitId: 2,
          product: { id: 11, name: 'Producto A', sku: 'PA', type: 'INTERMEDIATE', unit: 'unidad', baseUnit: { id: 1, abbreviation: 'g' } },
          yieldUnit: { id: 2, name: 'Kilogramo', abbreviation: 'kg' }, components: [],
          cost: { batchCost: 120, unitCost: 10, components: [] },
        },
        {
          id: 2, companyId: 1, productId: 12, name: 'Lote base', version: 1,
          status: 'DRAFT', yieldQuantity: 500, yieldUnitId: null,
          product: { id: 12, name: 'Producto B', sku: 'PB', type: 'INTERMEDIATE', unit: 'legacy', baseUnit: { id: 1, abbreviation: 'g' } },
          yieldUnit: null, components: [], cost: { batchCost: 50, unitCost: 0.1, components: [] },
        },
      ];
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });

  await page.goto('/production-recipes');
  await expect(page.getByRole('columnheader', { name: 'Rendimiento' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Producto A/ })).toContainText('12 kg');
  await expect(page.getByRole('row', { name: /Producto B/ })).toContainText('500 g');
});
