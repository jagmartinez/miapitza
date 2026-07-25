import { expect, test, type Page } from '@playwright/test';

const user = {
  id: 902,
  name: 'Fiscal QA',
  email: 'fiscal-qa@example.com',
  username: 'fiscal-qa',
  companyId: 7,
  branchId: 10,
  role: { id: 1, name: 'SUPERADMIN' },
  roles: [{ id: 1, name: 'SUPERADMIN' }],
  status: 'ACTIVE',
};

const table = {
  id: 77,
  number: 'ABANICO',
  capacity: 4,
  status: 'OCCUPIED',
  operationalState: 'PREPARING',
  location: 'Salón principal',
  branchId: 10,
  mapX: 80,
  mapY: 100,
  mapWidth: 128,
  mapHeight: 86,
  mapRotation: 0,
  mapVersion: 1,
  mapShape: 'RECTANGLE',
};

const originalOrder = {
  id: 501,
  branchId: 10,
  tableId: 77,
  table: { id: 77, number: 'ABANICO' },
  userId: 902,
  total: 250,
  subtotal: 250,
  tax: 0,
  discount: 0,
  tipAmount: 0,
  status: 'IN_PREPARATION',
  financialStatus: 'UNPAID',
  customerName: 'Cliente Original',
  customerTaxId: 'J031000000001',
  customerTaxIdType: 'RUC',
  customerFiscalAddress: 'Dirección original',
  customerEmail: 'cliente@example.com',
  customerPhone: '8888-0000',
  createdAt: '2026-07-25T12:00:00.000Z',
  user,
  items: [{
    id: 1,
    orderId: 501,
    menuItemId: 1,
    quantity: 1,
    price: 250,
    subtotal: 250,
    status: 'IN_PROGRESS',
    menuItem: { id: 1, name: 'Plato QA', price: 250 },
  }],
};

interface FiscalMock {
  fiscalWrites: Array<Record<string, unknown>>;
  invoiceWrites: string[];
}

async function mockFiscalApp(page: Page, failFiscalSave = false): Promise<FiscalMock> {
  const state: FiscalMock = { fiscalWrites: [], invoiceWrites: [] };
  let activeOrder = { ...originalOrder };

  await page.addInitScript((storedUser) => {
    localStorage.setItem('user', JSON.stringify(storedUser));
    localStorage.setItem('sidebar-collapsed', 'true');
  }, user);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    let data: unknown = [];

    if (method !== 'GET' && path.includes('/invoices')) {
      state.invoiceWrites.push(path);
    }

    if (path.endsWith('/auth/me')) data = user;
    else if (path.endsWith('/cash-shifts/active-status')) {
      data = {
        hasActiveShift: true,
        shift: { startDate: '2026-07-25T08:00:00.000Z' },
        requiresClose: false,
        message: null,
      };
    } else if (path.endsWith('/tables')) data = [table];
    else if (path.includes('/tables/plan/')) {
      data = {
        id: null,
        branchId: 10,
        canvasWidth: 1600,
        canvasHeight: 900,
        version: 1,
        areas: [],
        tables: [table],
      };
    } else if (path.endsWith('/orders/active')) data = [activeOrder];
    else if (path.endsWith('/orders/501/fiscal-customer') && method === 'PATCH') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      state.fiscalWrites.push(payload);
      if (failFiscalSave) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'La orden ya fue facturada por otro usuario.' }),
        });
        return;
      }
      activeOrder = {
        ...activeOrder,
        customerName: String(payload.customerName || ''),
        customerTaxId: String(payload.customerTaxId || ''),
        customerTaxIdType: String(payload.customerTaxIdType || ''),
        customerFiscalAddress: String(payload.customerFiscalAddress || ''),
        customerEmail: String(payload.customerEmail || ''),
        customerPhone: String(payload.customerPhone || ''),
      };
      data = activeOrder;
    } else if (path.endsWith('/orders')) data = [activeOrder];
    else if (path.endsWith('/menu-items')) {
      data = [{
        id: 1,
        name: 'Plato QA',
        description: 'Producto de prueba',
        price: 250,
        categoryId: 3,
        branchId: null,
        brandId: null,
        category: { id: 3, name: 'Especialidades' },
        recipes: [],
        images: [],
        active: true,
      }];
    } else if (path.endsWith('/settings')) data = { currency_symbol: 'C$' };
    else if (path.endsWith('/categories')) data = [{ id: 3, name: 'Especialidades', active: true }];
    else if (path.endsWith('/menu-brands')) data = [];
    else if (path.endsWith('/warehouses')) {
      data = [{ id: 4, branchId: 10, name: 'Bodega QA', code: 'QA', type: 'BRANCH' }];
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    });
  });

  return state;
}

async function openEmbeddedFiscalDialog(page: Page) {
  await page.goto('/tables');
  await page.getByRole('button', { name: /Mesa ABANICO/ }).click();
  await page
    .getByRole('dialog', { name: 'Mesa ABANICO' })
    .getByRole('button', { name: 'Agregar producto', exact: true })
    .click();

  const pos = page.getByRole('dialog', { name: 'Pedido de mesa ABANICO' });
  await expect(pos).toBeVisible();
  await pos.getByRole('button', { name: /Datos fiscales del cliente/ }).click();
  const fiscalDialog = page.getByRole('dialog', { name: 'Datos fiscales del cliente' });
  await expect(fiscalDialog).toBeVisible();
  return fiscalDialog;
}

test('embedded POS displays the fiscal dialog above its workspace and cancel discards edits', async ({
  page,
}) => {
  const requests = await mockFiscalApp(page);
  await page.setViewportSize({ width: 1620, height: 768 });
  let fiscalDialog = await openEmbeddedFiscalDialog(page);

  await expect(fiscalDialog.getByLabel('Nombre o razón social')).toHaveValue('Cliente Original');
  await expect(fiscalDialog.getByLabel('Identificación tributaria')).toHaveValue('J031000000001');

  const layering = await fiscalDialog.evaluate((overlay) => {
    const workspace = document.querySelector<HTMLElement>('.table-pos-workspace');
    const panel = overlay.querySelector<HTMLElement>('.modal-container');
    if (!workspace || !panel) throw new Error('No se encontró la jerarquía POS/modal');
    const panelBox = panel.getBoundingClientRect();
    const topElement = document.elementFromPoint(
      panelBox.left + panelBox.width / 2,
      panelBox.top + Math.min(30, panelBox.height / 2),
    );
    return {
      modalZIndex: Number(getComputedStyle(overlay).zIndex),
      workspaceZIndex: Number(getComputedStyle(workspace).zIndex),
      hitTargetBelongsToModal: Boolean(topElement && overlay.contains(topElement)),
    };
  });

  expect(layering.modalZIndex).toBeGreaterThan(layering.workspaceZIndex);
  expect(layering.hitTargetBelongsToModal).toBe(true);

  await fiscalDialog.getByLabel('Nombre o razón social').fill('Edición descartada');
  await fiscalDialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(fiscalDialog).toBeHidden();
  expect(requests.fiscalWrites).toHaveLength(0);
  expect(requests.invoiceWrites).toHaveLength(0);

  const pos = page.getByRole('dialog', { name: 'Pedido de mesa ABANICO' });
  await pos.getByRole('button', { name: /Datos fiscales del cliente/ }).click();
  fiscalDialog = page.getByRole('dialog', { name: 'Datos fiscales del cliente' });
  await expect(fiscalDialog.getByLabel('Nombre o razón social')).toHaveValue('Cliente Original');
});

test('saving fiscal data persists the active order without issuing an invoice', async ({ page }) => {
  const requests = await mockFiscalApp(page);
  const fiscalDialog = await openEmbeddedFiscalDialog(page);

  await fiscalDialog.getByLabel('Nombre o razón social').fill('Cliente Actualizado');
  await fiscalDialog.getByLabel('Teléfono').fill('7777-1111');
  await fiscalDialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(fiscalDialog).toBeHidden();

  expect(requests.fiscalWrites).toHaveLength(1);
  expect(requests.fiscalWrites[0]).toMatchObject({
    customerName: 'Cliente Actualizado',
    customerTaxId: 'J031000000001',
    customerTaxIdType: 'RUC',
    customerPhone: '7777-1111',
  });
  expect(requests.invoiceWrites).toHaveLength(0);
});

test('a failed fiscal save stays open and explains the backend error', async ({ page }) => {
  const requests = await mockFiscalApp(page, true);
  const fiscalDialog = await openEmbeddedFiscalDialog(page);

  await fiscalDialog.getByLabel('Nombre o razón social').fill('Cliente en conflicto');
  await fiscalDialog.getByRole('button', { name: 'Guardar' }).click();

  await expect(fiscalDialog).toBeVisible();
  await expect(fiscalDialog.getByRole('alert')).toHaveText(
    'La orden ya fue facturada por otro usuario.',
  );
  expect(requests.fiscalWrites).toHaveLength(1);
  expect(requests.invoiceWrites).toHaveLength(0);
});
