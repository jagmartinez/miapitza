import { expect, test, type Page } from '@playwright/test';

const user = {
  id: 910,
  name: 'Auditor monetario',
  email: 'money.qa@example.com',
  username: 'money-qa',
  companyId: 7,
  branchId: 10,
  role: { id: 1, name: 'SUPERADMIN' },
  roles: [{ id: 1, name: 'SUPERADMIN' }],
  accountType: 'INTERNAL',
  status: 'ACTIVE',
};

const table = {
  id: 77,
  number: 'MONEDA',
  capacity: 4,
  status: 'AVAILABLE',
  operationalState: 'AVAILABLE',
  location: 'Salón QA',
  branchId: 10,
  mapX: 80,
  mapY: 100,
  mapWidth: 128,
  mapHeight: 86,
  mapRotation: 0,
  mapVersion: 1,
  mapShape: 'RECTANGLE',
};

async function mockMoneyPos(page: Page) {
  await page.addInitScript((storedUser) => {
    localStorage.setItem('user', JSON.stringify(storedUser));
    localStorage.setItem('sidebar-collapsed', 'true');
    localStorage.setItem('theme', 'dark');
  }, user);

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];

    if (path.endsWith('/auth/me')) data = user;
    if (path.endsWith('/settings')) {
      data = {
        currency_symbol: 'C$',
        currency_locale: 'es-NI',
        tax_rate: '0',
        tipEnabled: 'false',
        enablePromotions: 'false',
      };
    }
    if (path.endsWith('/tables')) data = [table];
    if (path.includes('/tables/plan/')) {
      data = {
        id: null,
        branchId: 10,
        canvasWidth: 1600,
        canvasHeight: 900,
        version: 1,
        areas: [],
        tables: [table],
      };
    }
    if (path.endsWith('/orders') || path.endsWith('/orders/active')) data = [];
    if (path.endsWith('/menu-items')) {
      data = [{
        id: 1375,
        name: 'Producto Mil Trescientos Setenta y Cinco',
        description: 'Fixture monetario',
        price: 1375,
        categoryId: 3,
        branchId: null,
        brandId: null,
        category: { id: 3, name: 'Especialidades' },
        recipes: [],
        images: [],
        active: true,
      }];
    }
    if (path.endsWith('/categories')) {
      data = [{ id: 3, name: 'Especialidades', active: true, showInMenu: true }];
    }
    if (path.endsWith('/menu-brands')) data = [];
    if (path.endsWith('/warehouses')) {
      data = [{ id: 3, name: 'Bodega QA', code: 'QA', type: 'BRANCH', branchId: 10 }];
    }
    if (path.endsWith('/cash-shifts/active-status')) {
      data = {
        hasActiveShift: true,
        requiresClose: false,
        activeShift: { id: 301, branchId: 10, status: 'OPEN' },
      };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    });
  });
}

test('POS shows C$ 1,375.00 consistently on product, cart line and total', async ({ page }) => {
  await mockMoneyPos(page);
  await page.setViewportSize({ width: 1620, height: 768 });
  await page.goto('/tables');

  await page.getByRole('button', { name: /Mesa MONEDA/ }).click();
  await page
    .getByRole('dialog', { name: 'Mesa MONEDA' })
    .getByRole('button', { name: 'Menú', exact: true })
    .click();

  const pos = page.getByRole('dialog', { name: 'Pedido de mesa MONEDA' });
  const product = pos.locator('.product-card-new').filter({
    hasText: 'Producto Mil Trescientos Setenta y Cinco',
  });
  await expect(product).toContainText('C$ 1,375.00');

  await product.click();

  const cartLine = pos.locator('.cart-item-compact');
  await expect(cartLine.getByText('C$ 1,375.00', { exact: true })).toHaveCount(2);
  await expect(pos.locator('.total-final')).toContainText('C$ 1,375.00');
  await expect(pos.locator('.mobile-cart-summary')).toContainText('C$ 1,375.00');
});
