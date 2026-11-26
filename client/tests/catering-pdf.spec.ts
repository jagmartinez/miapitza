import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const user = {
  id: 902,
  name: 'PDF Review',
  email: 'pdf-review@example.com',
  username: 'pdf-review',
  companyId: 7,
  branchId: 10,
  role: { id: 1, name: 'SUPERADMIN' },
  roles: [{ id: 1, name: 'SUPERADMIN' }],
  accountType: 'INTERNAL',
  employeeId: 321,
  status: 'ACTIVE',
};

const event = {
  id: 41,
  title: 'Evento Catering QA',
  customer: {
    name: 'Cliente QA',
    phone: '8888-0000',
    taxId: '0010101000001A',
  },
  date: '2026-07-30T18:00:00.000Z',
  peopleCount: 60,
  status: 'RESERVED',
  totalAmount: 18_000,
  balance: 9_000,
  fiscalSubtotal: 15_652.17,
  fiscalTax: 2_347.83,
  fiscalTaxRatePercent: 15,
  subtotal: 15_652.17,
  tax: 2_347.83,
  location: 'Salón QA',
};

async function mockCatering(page: Page, contractResponse: 'pdf' | 'incomplete') {
  await page.addInitScript((storedUser) => {
    localStorage.setItem('user', JSON.stringify(storedUser));
    localStorage.setItem('sidebar-collapsed', 'true');
  }, user);

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/catering/41/contract')) {
      if (contractResponse === 'incomplete') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'No se puede generar el contrato: falta el RUC de la empresa.',
          }),
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: {
          'Content-Disposition': 'attachment; filename="contrato-catering-EVT-00041.pdf"',
          'Cache-Control': 'private, no-store',
        },
        body: Buffer.from('%PDF-1.7\n% isolated contract fixture\n%%EOF'),
      });
      return;
    }

    let data: unknown = [];
    if (path.endsWith('/auth/me')) data = user;
    if (path.endsWith('/settings')) data = { currency_symbol: 'C$', tax_rate: '15' };
    if (path.endsWith('/catering')) data = [event];
    if (path.endsWith('/catering/41')) data = event;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    });
  });
}

test('contract PDF stays unloaded until the server-authoritative download is requested', async ({ page }) => {
  const contractRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/catering/41/contract')) contractRequests.push(request.url());
  });
  await mockCatering(page, 'pdf');

  await page.goto('/dashboard');
  await expect(page.locator('.dashboard-header-hero')).toBeVisible();
  expect(contractRequests).toEqual([]);

  await page.goto('/catering');
  await expect(page.getByText('Evento Catering QA')).toBeVisible();
  expect(contractRequests).toEqual([]);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar contrato de Evento Catering QA' }).click();
  await expect(page.locator('.catering-contract-status[role="status"]')).toContainText('Preparando contrato PDF');

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('contrato-catering-EVT-00041.pdf');
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  expect(readFileSync(downloadPath!).subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(contractRequests).toHaveLength(1);
  await expect(page.getByText('Contrato PDF descargado')).toBeVisible();
});

test('incomplete authoritative contract fails closed with the backend reason', async ({ page }) => {
  await mockCatering(page, 'incomplete');

  await page.goto('/catering');
  await page.getByRole('button', { name: 'Descargar contrato de Evento Catering QA' }).click();

  const alert = page.getByRole('alert').filter({ hasText: 'falta el RUC de la empresa' });
  await expect(alert).toBeVisible();
  await expect(page.getByText('Contrato PDF descargado')).toHaveCount(0);
});
