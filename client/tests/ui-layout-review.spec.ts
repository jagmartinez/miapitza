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
  }, user);

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = user;
    if (path.endsWith('/settings')) data = { currency_symbol: 'C$' };
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
