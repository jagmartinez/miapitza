import { expect, test, type Page } from '@playwright/test';

const baseUser = {
  id: 902,
  name: 'Table Review',
  email: 'table-review@example.com',
  username: 'table-review',
  companyId: 7,
  branchId: 10,
  branch: { id: 10, name: 'Sucursal QA' },
  role: { id: 1, name: 'SUPERADMIN' },
  roles: [{ id: 1, name: 'SUPERADMIN' }],
  accountType: 'INTERNAL',
  employeeId: 321,
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
  branch: { id: 10, name: 'Sucursal QA' },
  mapX: 80,
  mapY: 100,
  mapWidth: 128,
  mapHeight: 86,
  mapRotation: 0,
  mapVersion: 1,
  mapShape: 'RECTANGLE',
};

const order = {
  id: 501,
  branchId: 10,
  tableId: 77,
  userId: 902,
  total: 2_199,
  status: 'IN_PREPARATION',
  financialStatus: 'UNPAID',
  createdAt: '2026-07-22T22:05:00.000Z',
  user: baseUser,
  items: [{
    id: 1,
    orderId: 501,
    menuItemId: 101,
    quantity: 1,
    price: 2_199,
    subtotal: 2_199,
    status: 'IN_PROGRESS',
    menuItem: { id: 101, name: 'Servicio QA', price: 2_199 },
  }],
};

const activeConsolidation = {
  id: 91,
  branchId: 10,
  primaryOrderId: 501,
  destinationTableId: 77,
  status: 'ACTIVE',
  version: 2,
  reason: 'Familia solicitó una sola cuenta',
  createdAt: '2026-07-22T22:00:00.000Z',
  affectedOrderIds: [501, 502],
  originalTableIds: [77, 78],
};

const legacyCandidate = {
  candidateKey: 'a'.repeat(64),
  evidenceHash: 'b'.repeat(64),
  classification: 'NOT_REVERSIBLE',
  reversible: false,
  branchId: 10,
  primaryOrderId: 401,
  absorbedOrderIds: [402, 403],
  auditLogId: 700,
  reasons: ['ORIGINAL_ORDER_FINANCIALS_AND_STATUS_WERE_NOT_SNAPSHOTTED'],
  review: null as null | Record<string, unknown>,
};

interface MockOptions {
  user?: typeof baseUser & { permissions?: string[] };
  reverseStatus?: 200 | 409;
  activeLookupFailures?: number;
  legacyInventoryFailures?: number;
  legacyMarkStatus?: 200 | 409;
  legacyMarkFailures?: number;
  legacyStaleReview?: boolean;
}

async function mockTables(page: Page, options: MockOptions = {}) {
  const activeUser = options.user ?? baseUser;
  let consolidationActive = true;
  let activeLookupFailures = options.activeLookupFailures ?? 0;
  let legacyInventoryFailures = options.legacyInventoryFailures ?? 0;
  let legacyMarkFailures = options.legacyMarkFailures ?? 0;
  const currentLegacyEvidenceHash = options.legacyStaleReview
    ? 'c'.repeat(64)
    : legacyCandidate.evidenceHash;
  let legacyReviewRevision = options.legacyStaleReview ? 1 : 0;
  let currentLegacyEvidenceReviewed = false;
  let legacyReviewNote = options.legacyStaleReview
    ? 'Primera revisión sobre la evidencia anterior'
    : '';
  let legacyReviewResolutionKey = options.legacyStaleReview
    ? 'first-review-resolution-key'
    : '';
  const calls = {
    tableLoads: 0,
    floorPlanLoads: 0,
    orderLoads: 0,
    activeLookups: 0,
    reverseBody: null as Record<string, unknown> | null,
    reverseHeader: '',
    reverseHeaders: [] as string[],
    legacyInventoryLoads: 0,
    legacyMarkBodies: [] as Record<string, unknown>[],
  };

  await page.addInitScript((storedUser) => {
    localStorage.setItem('user', JSON.stringify(storedUser));
    localStorage.setItem('sidebar-collapsed', 'true');
  }, activeUser);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let data: unknown = [];

    if (path.endsWith('/auth/me')) data = activeUser;
    if (path.endsWith('/settings')) data = { currency_symbol: 'C$' };
    if (path.endsWith('/branches')) data = [{ id: 10, name: 'Sucursal QA' }];
    if (path.endsWith('/tables') && request.method() === 'GET') {
      calls.tableLoads += 1;
      data = [table];
    }
    if (path.includes('/tables/plan/')) {
      calls.floorPlanLoads += 1;
      data = {
        id: 1,
        branchId: 10,
        canvasWidth: 1600,
        canvasHeight: 900,
        version: 1,
        areas: [],
        tables: [table],
      };
    }
    if (path.endsWith('/orders')) {
      calls.orderLoads += 1;
      data = [order];
    }
    if (path.endsWith('/tables/consolidations/active')) {
      calls.activeLookups += 1;
      expect(url.searchParams.get('tableId')).toBe('77');
      if (activeLookupFailures > 0) {
        activeLookupFailures -= 1;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'Historial de consolidaciones temporalmente no disponible',
          }),
        });
        return;
      }
      data = consolidationActive ? activeConsolidation : null;
    }
    if (path.endsWith('/tables/consolidations/legacy-inventory')) {
      calls.legacyInventoryLoads += 1;
      expect(url.searchParams.get('branchId')).toBe('10');
      if (legacyInventoryFailures > 0) {
        legacyInventoryFailures -= 1;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'Inventario histórico temporalmente no disponible',
          }),
        });
        return;
      }
      data = {
        summary: {
          reversible: 0,
          notReversible: 1,
          ambiguous: 0,
          reviewed: legacyReviewRevision > 0 ? 1 : 0,
          evidenceChangedAfterReview:
            legacyReviewRevision > 0 && !currentLegacyEvidenceReviewed ? 1 : 0,
        },
        candidates: [{
          ...legacyCandidate,
          evidenceHash: currentLegacyEvidenceHash,
          reviewHistoryCount: legacyReviewRevision,
          currentEvidenceReviewed: currentLegacyEvidenceReviewed,
          review: legacyReviewRevision > 0 ? {
            id: 88,
            revision: legacyReviewRevision,
            evidenceHash: currentLegacyEvidenceReviewed
              ? currentLegacyEvidenceHash
              : legacyCandidate.evidenceHash,
            classification: 'NOT_REVERSIBLE',
            outcome: 'ACKNOWLEDGED_NO_AUTOMATIC_REVERSAL',
            note: legacyReviewNote,
            resolutionKey: legacyReviewResolutionKey,
            reviewedById: 902,
            reviewedAt: '2026-07-23T12:00:00.000Z',
            evidenceChangedAfterReview: !currentLegacyEvidenceReviewed,
          } : null,
        }],
      };
    }
    if (path.endsWith(`/tables/consolidations/legacy-inventory/${legacyCandidate.candidateKey}/mark`)) {
      const body = request.postDataJSON() as Record<string, unknown>;
      calls.legacyMarkBodies.push(body);
      if (legacyMarkFailures > 0 || options.legacyMarkStatus === 409) {
        legacyMarkFailures = Math.max(0, legacyMarkFailures - 1);
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'La evidencia histórica cambió; vuelva a ejecutar el inventario antes de marcar',
          }),
        });
        return;
      }
      legacyReviewRevision += 1;
      currentLegacyEvidenceReviewed = true;
      legacyReviewNote = String(body.note);
      legacyReviewResolutionKey = String(body.resolutionKey);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Revisión histórica registrada sin modificar órdenes ni productos',
          data: {
            idempotent: false,
            review: { id: 88, revision: legacyReviewRevision },
          },
        }),
      });
      return;
    }
    if (path.endsWith('/tables/consolidations/91/reverse')) {
      calls.reverseBody = request.postDataJSON() as Record<string, unknown>;
      calls.reverseHeader = request.headers()['x-idempotency-key'] ?? '';
      calls.reverseHeaders.push(calls.reverseHeader);
      if (options.reverseStatus === 409) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'La orden #501 ya tiene historia fiscal y no puede separarse',
          }),
        });
        return;
      }
      consolidationActive = false;
      data = { consolidationId: 91, version: 3, affectedTableIds: [77, 78], orders: [] };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    });
  });

  return calls;
}

async function openTable(page: Page) {
  await page.goto('/tables');
  await page.getByRole('button', { name: /Mesa ABANICO/ }).click();
  await expect(page.getByRole('dialog', { name: 'Mesa ABANICO' })).toBeVisible();
}

test('authorized operator reverses a rediscovered ACTIVE consolidation and refreshes state', async ({ page }) => {
  const calls = await mockTables(page);
  await openTable(page);

  const panel = page.getByRole('region', { name: 'Consolidación activa' });
  await expect(panel).toContainText('Consolidación activa #91');
  await expect(panel).toContainText('2 cuentas · 2 mesas originales');
  await expect(panel).toContainText('El estado ACTIVE no garantiza que el reverso siga siendo posible');
  await panel.getByRole('button', { name: 'Solicitar reverso' }).click();

  const reason = panel.getByLabel('Motivo obligatorio');
  const submit = panel.getByRole('button', { name: 'Confirmar reverso' });
  await expect(submit).toBeDisabled();
  await reason.fill('Las cuentas se consolidaron en la mesa equivocada');
  await submit.click();

  const confirmation = page.getByRole('alertdialog', { name: 'Confirmar reverso de consolidación' });
  await expect(confirmation).toContainText('pagos, factura, entrega, cambios en productos u otra ocupación');
  await confirmation.getByRole('button', { name: 'Confirmar', exact: true }).click();

  await expect(page.getByText('Consolidación revertida. Las cuentas regresaron a sus mesas originales.')).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(calls.reverseBody).toMatchObject({
    expectedVersion: 2,
    reason: 'Las cuentas se consolidaron en la mesa equivocada',
  });
  expect(typeof calls.reverseBody?.reversalKey).toBe('string');
  expect(calls.reverseHeader).toBe(calls.reverseBody?.reversalKey);
  expect(calls.tableLoads).toBeGreaterThanOrEqual(2);
  expect(calls.floorPlanLoads).toBeGreaterThanOrEqual(2);
  expect(calls.orderLoads).toBeGreaterThanOrEqual(2);
  expect(calls.activeLookups).toBeGreaterThanOrEqual(2);
});

test('409 counterflow reports the server reason, keeps ACTIVE visible and reuses the retry key', async ({ page }) => {
  const calls = await mockTables(page, { reverseStatus: 409 });
  await openTable(page);

  const panel = page.getByRole('region', { name: 'Consolidación activa' });
  await panel.getByRole('button', { name: 'Solicitar reverso' }).click();
  await panel.getByLabel('Motivo obligatorio').fill('Reverso solicitado por operación');
  await panel.getByRole('button', { name: 'Confirmar reverso' }).click();
  await page.getByRole('alertdialog', { name: 'Confirmar reverso de consolidación' })
    .getByRole('button', { name: 'Confirmar', exact: true })
    .click();

  await expect(page.locator('.toast-message').filter({
    hasText: 'La orden #501 ya tiene historia fiscal y no puede separarse',
  })).toBeVisible();
  await expect(panel).toContainText('Consolidación activa #91');
  const blocked = panel.getByRole('alert');
  await expect(blocked).toContainText('El reverso no se completó');
  await expect(blocked).toContainText('La orden #501 ya tiene historia fiscal y no puede separarse');
  await expect(blocked).toContainText('La consolidación continúa activa');
  await expect(panel.getByLabel('Motivo obligatorio')).toHaveValue('Reverso solicitado por operación');

  await panel.getByRole('button', { name: 'Confirmar reverso' }).click();
  await page.getByRole('alertdialog', { name: 'Confirmar reverso de consolidación' })
    .getByRole('button', { name: 'Confirmar', exact: true })
    .click();
  await expect.poll(() => calls.reverseHeaders.length).toBe(2);
  expect(calls.reverseHeaders[0]).toBe(calls.reverseHeaders[1]);
});

test('user without tables.consolidate neither discovers nor sees reversal controls', async ({ page }) => {
  const calls = await mockTables(page, {
    user: {
      ...baseUser,
      permissions: ['tables.map.view', 'orders.view'],
    },
  });
  await openTable(page);

  await expect(page.getByRole('region', { name: 'Consolidación activa' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Solicitar reverso' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Históricos' })).toHaveCount(0);
  expect(calls.activeLookups).toBe(0);
  expect(calls.legacyInventoryLoads).toBe(0);
});

test('lookup failure is explicit and retry rediscovers the ACTIVE consolidation', async ({ page }) => {
  const calls = await mockTables(page, { activeLookupFailures: 1 });
  await openTable(page);

  const error = page.getByRole('alert').filter({ hasText: 'No se pudo verificar el historial de consolidación' });
  await expect(error).toContainText('Historial de consolidaciones temporalmente no disponible');
  await expect(page.getByRole('button', { name: 'Solicitar reverso' })).toHaveCount(0);
  await error.getByRole('button', { name: 'Reintentar' }).click();

  await expect(page.getByRole('region', { name: 'Consolidación activa' })).toContainText('Consolidación activa #91');
  expect(calls.activeLookups).toBe(2);
});

test('historical inventory is explicit, non-reversible and records review without operational mutation', async ({ page }) => {
  const calls = await mockTables(page);
  await page.goto('/tables');
  await page.getByRole('button', { name: 'Históricos' }).click();

  const dialog = page.getByRole('dialog', { name: 'Consolidaciones históricas' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('no reversibles desde esta pantalla');
  await expect(dialog).toContainText('No restaura órdenes, productos, pagos ni mesas');
  await expect(dialog).toContainText('Consolidación histórica de orden #401');
  await expect(dialog).toContainText('No reversible automáticamente');

  await dialog.getByRole('button', { name: 'Registrar revisión', exact: true }).click();
  const note = dialog.getByLabel('Nota de revisión obligatoria');
  const submit = dialog.getByRole('button', { name: 'Registrar revisión sin reversar' });
  await expect(submit).toBeDisabled();
  await note.fill('Validado contra el expediente físico de caja');
  await submit.click();

  await expect(dialog).toContainText('Evidencia actual revisada · revisión #1');
  await expect(dialog).toContainText('Validado contra el expediente físico de caja');
  expect(calls.legacyMarkBodies).toHaveLength(1);
  expect(calls.legacyMarkBodies[0]).toMatchObject({
    expectedEvidenceHash: legacyCandidate.evidenceHash,
    outcome: 'ACKNOWLEDGED_NO_AUTOMATIC_REVERSAL',
    note: 'Validado contra el expediente físico de caja',
  });
  expect(typeof calls.legacyMarkBodies[0].resolutionKey).toBe('string');
  expect(calls.legacyInventoryLoads).toBeGreaterThanOrEqual(2);
  expect(calls.reverseHeaders).toHaveLength(0);
});

test('changed evidence keeps revision one visible and permits a versioned second review', async ({ page }) => {
  const calls = await mockTables(page, {
    legacyStaleReview: true,
    legacyMarkFailures: 1,
  });
  await page.goto('/tables');
  await page.getByRole('button', { name: 'Históricos' }).click();

  const dialog = page.getByRole('dialog', { name: 'Consolidaciones históricas' });
  await expect(dialog).toContainText('Revisión previa #1');
  await expect(dialog).toContainText('Primera revisión sobre la evidencia anterior');
  await expect(dialog).toContainText('el registro anterior no certifica el estado actual');
  await dialog.getByRole('button', {
    name: 'Registrar nueva revisión de la evidencia actual',
  }).click();
  await dialog.getByLabel('Nota de revisión obligatoria')
    .fill('Segunda revisión sobre la nueva huella de evidencia');

  const submit = dialog.getByRole('button', { name: 'Registrar revisión sin reversar' });
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('La evidencia histórica cambió');
  await submit.click();

  await expect(dialog).toContainText('Evidencia actual revisada · revisión #2');
  await expect(dialog).toContainText('2 revisiones históricas registradas');
  await expect(dialog).toContainText('Segunda revisión sobre la nueva huella de evidencia');
  expect(calls.legacyMarkBodies).toHaveLength(2);
  expect(calls.legacyMarkBodies[0]).toMatchObject({
    expectedEvidenceHash: 'c'.repeat(64),
    outcome: 'ACKNOWLEDGED_NO_AUTOMATIC_REVERSAL',
    note: 'Segunda revisión sobre la nueva huella de evidencia',
  });
  expect(calls.legacyMarkBodies[0].resolutionKey)
    .toBe(calls.legacyMarkBodies[1].resolutionKey);
});

test('historical inventory load failure shows the server message and supports retry', async ({ page }) => {
  const calls = await mockTables(page, { legacyInventoryFailures: 1 });
  await page.goto('/tables');
  await page.getByRole('button', { name: 'Históricos' }).click();

  const dialog = page.getByRole('dialog', { name: 'Consolidaciones históricas' });
  const error = dialog.getByRole('alert');
  await expect(error).toContainText('Inventario histórico temporalmente no disponible');
  await error.getByRole('button', { name: 'Reintentar' }).click();
  await expect(dialog).toContainText('Consolidación histórica de orden #401');
  expect(calls.legacyInventoryLoads).toBe(2);
});

test('historical review conflict remains explicit and reuses the resolution key', async ({ page }) => {
  const calls = await mockTables(page, { legacyMarkStatus: 409 });
  await page.goto('/tables');
  await page.getByRole('button', { name: 'Históricos' }).click();

  const dialog = page.getByRole('dialog', { name: 'Consolidaciones históricas' });
  await dialog.getByRole('button', { name: 'Registrar revisión', exact: true }).click();
  await dialog.getByLabel('Nota de revisión obligatoria').fill('Revisión con expediente externo');
  await dialog.getByRole('button', { name: 'Registrar revisión sin reversar' }).click();

  const error = dialog.getByRole('alert');
  await expect(error).toContainText('La evidencia histórica cambió');
  await dialog.getByRole('button', { name: 'Registrar revisión sin reversar' }).click();
  await expect.poll(() => calls.legacyMarkBodies.length).toBe(2);
  expect(calls.legacyMarkBodies[0].resolutionKey).toBe(calls.legacyMarkBodies[1].resolutionKey);
});
