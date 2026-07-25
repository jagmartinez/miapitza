import { expect, test, type Page } from '@playwright/test';

type ShiftTemplate = {
  id: number;
  revision: number;
  name: string;
  code: string;
  branchId: number | null;
  jobPositionId: number | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  paidBreak: boolean;
  notes: string | null;
  color: string;
  active: boolean;
  crossesMidnight: boolean;
  branch: { id: number; name: string } | null;
  jobPosition: { id: number; name: string } | null;
};

type CapturedMutation = {
  method: string;
  path: string;
  body: Record<string, unknown>;
};

type MockOptions = {
  templates?: ShiftTemplate[];
  permissions?: string[];
  templateReadError?: string;
  templateMutationError?: string;
};

const manager = {
  id: 902,
  name: 'Responsable de horarios',
  email: 'schedules.qa@example.com',
  username: 'schedules-qa',
  companyId: 7,
  branchId: 10,
  role: { id: 2, name: 'ADMIN' },
  roles: [{ id: 2, name: 'ADMIN' }],
  permissions: ['hr.schedule.read', 'hr.schedule.manage', 'hr.schedule.publish'],
  accountType: 'INTERNAL',
  employeeId: 321,
  employee: { id: 321, employeeCode: 'EMP-321', status: 'ACTIVE' },
  status: 'ACTIVE',
};

const branch = { id: 10, name: 'Sucursal QA', status: 'ACTIVE' };
const position = { id: 4, name: 'Servicio', active: true };
const worker = {
  id: 903,
  name: 'Trabajador QA',
  username: 'trabajador-qa',
  status: 'ACTIVE',
  accountType: 'INTERNAL',
  branchId: 10,
  employee: {
    id: 322,
    employeeCode: 'EMP-322',
    status: 'ACTIVE',
    jobPositionId: 4,
    branchAssignments: [{ branchId: 10, isPrimary: true }],
  },
};

const templateDefinitions = [
  { name: 'Matutina', code: 'MAT', startTime: '08:00', endTime: '16:00', color: '#2563EB' },
  { name: 'Vespertina', code: 'VES', startTime: '14:00', endTime: '22:00', color: '#A16207' },
  { name: 'Nocturna', code: 'NOC', startTime: '22:00', endTime: '06:00', color: '#7C3AED' },
] as const;

function makeTemplates(count: number): ShiftTemplate[] {
  return templateDefinitions.slice(0, count).map((definition, index) => ({
    id: index + 1,
    revision: 1,
    ...definition,
    branchId: null,
    jobPositionId: null,
    breakMinutes: 30,
    paidBreak: false,
    notes: null,
    active: true,
    crossesMidnight: definition.endTime <= definition.startTime,
    branch: null,
    jobPosition: null,
  }));
}

async function mockScheduleCatalog(page: Page, options: MockOptions = {}) {
  const activeUser = { ...manager, permissions: options.permissions ?? manager.permissions };
  const state = {
    templates: (options.templates ?? []).map((template) => ({ ...template })),
    schedule: {
      id: 61,
      companyId: 7,
      weekStart: '2026-07-20',
      status: 'DRAFT',
      version: 1,
      revision: 1,
      shifts: [] as Array<Record<string, unknown>>,
    },
  };
  const mutations: CapturedMutation[] = [];

  await page.addInitScript((storedUser) => {
    localStorage.setItem('user', JSON.stringify(storedUser));
    localStorage.setItem('sidebar-collapsed', 'true');
    localStorage.setItem('theme', 'dark');
  }, activeUser);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const path = requestUrl.pathname;
    const method = request.method();
    const body = method === 'GET'
      ? {}
      : (request.postDataJSON() as Record<string, unknown> | null) ?? {};

    if (path.endsWith('/auth/me')) return route.fulfill({ json: activeUser });
    if (path.endsWith('/settings')) return route.fulfill({ json: { currency_symbol: 'C$' } });
    if (path.endsWith('/v1/hr/schedules/lookups')) {
      return route.fulfill({
        json: { branches: [branch], positions: [position], users: [worker] },
      });
    }
    if (path.endsWith('/v1/hr/holidays')) return route.fulfill({ json: [] });

    if (path.endsWith('/v1/hr/shift-templates') && method === 'GET') {
      if (options.templateReadError) {
        return route.fulfill({ status: 503, json: { message: options.templateReadError } });
      }
      return route.fulfill({ json: state.templates });
    }

    if (path.endsWith('/v1/hr/shift-templates') && method === 'POST') {
      mutations.push({ method, path, body });
      if (options.templateMutationError) {
        return route.fulfill({ status: 500, json: { message: options.templateMutationError } });
      }
      const created: ShiftTemplate = {
        id: Math.max(0, ...state.templates.map((template) => template.id)) + 1,
        revision: 1,
        name: String(body.name),
        code: body.code ? String(body.code) : `SHIFT_MOCK_${state.templates.length + 1}`,
        branchId: body.branchId == null ? null : Number(body.branchId),
        jobPositionId: body.jobPositionId == null ? null : Number(body.jobPositionId),
        startTime: String(body.startTime),
        endTime: String(body.endTime),
        breakMinutes: Number(body.breakMinutes),
        paidBreak: Boolean(body.paidBreak),
        notes: body.notes == null ? null : String(body.notes),
        color: String(body.color),
        active: true,
        crossesMidnight: String(body.endTime) <= String(body.startTime),
        branch: body.branchId == null ? null : { id: branch.id, name: branch.name },
        jobPosition: body.jobPositionId == null ? null : { id: position.id, name: position.name },
      };
      state.templates.push(created);
      return route.fulfill({ json: created });
    }

    const templateIdMatch = path.match(/\/v1\/hr\/shift-templates\/(\d+)$/);
    if (templateIdMatch && method === 'PUT') {
      mutations.push({ method, path, body });
      if (options.templateMutationError) {
        return route.fulfill({ status: 500, json: { message: options.templateMutationError } });
      }
      const template = state.templates.find((item) => item.id === Number(templateIdMatch[1]));
      if (!template) return route.fulfill({ status: 404, json: { message: 'Jornada no encontrada' } });
      Object.assign(template, body, {
        revision: template.revision + 1,
        crossesMidnight: String(body.endTime) <= String(body.startTime),
      });
      return route.fulfill({ json: template });
    }

    const statusMatch = path.match(/\/v1\/hr\/shift-templates\/(\d+)\/status$/);
    if (statusMatch && method === 'PATCH') {
      mutations.push({ method, path, body });
      if (options.templateMutationError) {
        return route.fulfill({ status: 500, json: { message: options.templateMutationError } });
      }
      const template = state.templates.find((item) => item.id === Number(statusMatch[1]));
      if (!template) return route.fulfill({ status: 404, json: { message: 'Jornada no encontrada' } });
      template.active = Boolean(body.active);
      template.revision += 1;
      return route.fulfill({ json: template });
    }

    if (path.endsWith('/v1/hr/schedules') && method === 'GET') {
      state.schedule.weekStart = requestUrl.searchParams.get('weekStart') ?? state.schedule.weekStart;
      return route.fulfill({ json: [state.schedule] });
    }

    if (path.endsWith('/v1/hr/schedules/61') && method === 'PUT') {
      mutations.push({ method, path, body });
      state.schedule.revision += 1;
      state.schedule.shifts = ((body.shifts as Array<Record<string, unknown>> | undefined) ?? []).map((shift, index) => {
        const selectedTemplate = state.templates.find((template) => template.id === shift.shiftTemplateId);
        return {
          ...shift,
          id: 700 + index,
          scheduleId: state.schedule.id,
          timezoneSnapshot: 'America/Managua',
          user: worker,
          branch: { id: branch.id, name: branch.name },
          jobPosition: { id: position.id, name: position.name },
          shiftTemplate: selectedTemplate
            ? { id: selectedTemplate.id, name: selectedTemplate.name, code: selectedTemplate.code, color: selectedTemplate.color }
            : null,
          templateNameSnapshot: selectedTemplate?.name ?? null,
          templateColorSnapshot: selectedTemplate?.color ?? null,
        };
      });
      return route.fulfill({ json: state.schedule });
    }

    return route.fulfill({ json: [] });
  });

  return { state, mutations };
}

async function openSchedules(page: Page) {
  await page.goto('/rh/horarios');
  await expect(page.getByRole('heading', { name: 'Horarios semanales' })).toBeVisible();
}

async function openTemplates(page: Page) {
  await page.goto('/rh/horarios/jornadas');
  await expect(page.getByRole('heading', { name: 'Jornadas configuradas' })).toBeVisible();
}

test('catálogo representa 0, 1, 2 y 3 jornadas con sus colores configurados', async ({ page }) => {
  const mock = await mockScheduleCatalog(page);

  for (const count of [0, 1, 2, 3]) {
    mock.state.templates.splice(0, mock.state.templates.length, ...makeTemplates(count));
    await openTemplates(page);

    if (count === 0) {
      await expect(page.getByText('No hay jornadas configuradas.')).toBeVisible();
      await expect(page.locator('.hr-template-card')).toHaveCount(0);
    } else {
      const catalog = page.locator(`[aria-label="${count} jornadas configuradas"]`);
      await expect(catalog).toBeVisible();
      await expect(catalog.locator('.hr-template-card')).toHaveCount(count);
      for (const template of mock.state.templates) {
        const card = catalog.locator('.hr-template-card').filter({ hasText: template.name });
        await expect(card).toContainText(`${template.startTime}–${template.endTime}`);
        await expect.poll(async () => (
          await card.evaluate((element) => getComputedStyle(element).getPropertyValue('--template-color').trim().toUpperCase())
        )).toBe(template.color);
      }
    }

    if (count < 3) await page.reload();
  }
});

test('selector rápido asigna por teclado la jornada, horas y color al trabajador y día', async ({ page }) => {
  const mock = await mockScheduleCatalog(page, { templates: makeTemplates(2) });
  await openSchedules(page);

  await page.getByRole('button', { name: /Agregar turno para Trabajador QA/i }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Asignar jornada' });
  const selector = dialog.getByLabel('Jornada configurada');
  await selector.focus();
  await selector.press('ArrowDown');
  await selector.press('ArrowDown');
  await selector.press('Enter');
  await expect(dialog).toContainText('Vespertina · 14:00–22:00');
  await dialog.getByRole('button', { name: 'Asignar jornada', exact: true }).click();

  await expect.poll(() => mock.mutations.filter((item) => item.path.endsWith('/v1/hr/schedules/61')).length).toBe(1);
  const update = mock.mutations.find((item) => item.path.endsWith('/v1/hr/schedules/61'))!;
  const assigned = (update.body.shifts as Array<Record<string, unknown>>)[0];
  expect(update.body.expectedRevision).toBe(1);
  expect(assigned).toMatchObject({
    userId: worker.id,
    branchId: branch.id,
    jobPositionId: position.id,
    shiftTemplateId: 2,
    startTime: '14:00',
    endTime: '22:00',
    breakMinutes: 30,
  });

  const shiftCard = page.locator('.hr-shift-card').filter({ hasText: 'Vespertina' }).first();
  await expect(shiftCard).toBeVisible();
  await expect.poll(async () => (
    await shiftCard.evaluate((element) => getComputedStyle(element).getPropertyValue('--shift-accent').trim().toUpperCase())
  )).toBe('#A16207');
});

test('administrador crea, edita y desactiva una jornada con revisión optimista', async ({ page }) => {
  const mock = await mockScheduleCatalog(page, { templates: makeTemplates(1) });
  await openTemplates(page);

  await page.getByRole('button', { name: 'Nueva jornada' }).click();
  let dialog = page.getByRole('dialog', { name: 'Nueva jornada' });
  await dialog.getByLabel('Nombre').fill('Tarde QA');
  await expect(dialog.getByLabel('Código')).toHaveCount(0);
  await expect(dialog.getByLabel('Sucursal')).toHaveCount(0);
  await expect(dialog.getByLabel('Puesto (opcional)')).toHaveCount(0);
  await expect(dialog.getByText('Descanso pagado')).toHaveCount(0);
  await dialog.getByLabel('Violeta').check();
  await dialog.getByRole('button', { name: 'Crear jornada' }).click();

  await expect(page.locator('.hr-template-card').filter({ hasText: 'Tarde QA' })).toBeVisible();
  const created = mock.mutations.find((item) => item.method === 'POST');
  expect(created?.body).toEqual({
    name: 'Tarde QA',
    startTime: '08:00',
    endTime: '17:00',
    breakMinutes: 0,
    notes: null,
    color: '#7C3AED',
  });

  await page.getByRole('button', { name: 'Editar jornada Tarde QA' }).click();
  dialog = page.getByRole('dialog', { name: 'Editar jornada' });
  await dialog.getByLabel('Nombre').fill('Tarde editada');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('.hr-template-card').filter({ hasText: 'Tarde editada' })).toBeVisible();
  const edited = mock.mutations.find((item) => item.method === 'PUT' && item.path.includes('/shift-templates/'));
  expect(edited?.body).toMatchObject({ name: 'Tarde editada', expectedRevision: 1 });
  expect(edited?.body).not.toHaveProperty('code');
  expect(edited?.body).not.toHaveProperty('branchId');
  expect(edited?.body).not.toHaveProperty('jobPositionId');
  expect(edited?.body).not.toHaveProperty('paidBreak');

  await page.getByRole('button', { name: 'Desactivar jornada Tarde editada' }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Desactivar Tarde editada' });
  await confirmation.getByRole('button', { name: 'Desactivar', exact: true }).click();
  const inactiveCard = page.locator('.hr-template-card').filter({ hasText: 'Tarde editada' });
  await expect(inactiveCard).toContainText('Inactiva');
  const status = mock.mutations.find((item) => item.method === 'PATCH');
  expect(status?.body).toEqual({ active: false, expectedRevision: 2 });
});

test('lector ve todas las jornadas y trabajadores, pero no puede mutar ni asignar', async ({ page }) => {
  await mockScheduleCatalog(page, {
    templates: makeTemplates(3),
    permissions: ['hr.schedule.read'],
  });
  await openTemplates(page);
  await expect(page.locator('.hr-template-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Nueva jornada' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Editar jornada/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Desactivar jornada/ })).toHaveCount(0);
  await openSchedules(page);
  await expect(page.getByText('Trabajador QA')).toBeVisible();
  await expect(page.getByRole('button', { name: /Agregar turno para Trabajador QA/i })).toHaveCount(0);
});

test('fallos de lectura y escritura quedan visibles y no producen éxito aparente', async ({ page }) => {
  await mockScheduleCatalog(page, {
    templateReadError: 'Catálogo de jornadas temporalmente no disponible.',
  });
  await openTemplates(page);
  await expect(page.getByRole('alert')).toContainText('Catálogo de jornadas temporalmente no disponible.');

  await page.unroute('**/api/**');
  const failingMutation = await mockScheduleCatalog(page, {
    templates: makeTemplates(1),
    templateMutationError: 'No fue posible persistir la jornada QA.',
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Jornadas configuradas' })).toBeVisible();
  await page.getByRole('button', { name: 'Editar jornada Matutina' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar jornada' });
  await dialog.getByLabel('Nombre').fill('Nombre que no debe persistir');
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(dialog.getByRole('alert')).toContainText('No fue posible persistir la jornada QA.');
  await expect(dialog).toBeVisible();
  await expect(page.locator('.hr-template-card').filter({ hasText: 'Matutina' })).toBeVisible();
  expect(failingMutation.mutations.filter((item) => item.method === 'PUT')).toHaveLength(1);
});

test('fallo del catálogo no se presenta como una jornada vacía al asignar', async ({ page }) => {
  await mockScheduleCatalog(page, {
    templateReadError: 'Catálogo de jornadas temporalmente no disponible.',
  });
  await openSchedules(page);

  await page.getByRole('button', { name: /Agregar turno para Trabajador QA/i }).first().click();
  const shiftDialog = page.getByRole('dialog', { name: 'Asignar jornada' });
  await expect(shiftDialog.getByRole('alert')).toContainText('Catálogo de jornadas temporalmente no disponible.');
  await expect(shiftDialog).not.toContainText('No hay jornadas activas compatibles');
  await expect(shiftDialog.getByRole('button', { name: 'Reintentar jornadas' })).toBeVisible();
});

test('catálogo vacío permite pasar de la celda al alta de jornada', async ({ page }) => {
  await mockScheduleCatalog(page);
  await openSchedules(page);

  await page.getByRole('button', { name: /Agregar turno para Trabajador QA/i }).first().click();
  const shiftDialog = page.getByRole('dialog', { name: 'Asignar jornada' });
  await expect(shiftDialog).toContainText('No hay jornadas activas compatibles');
  await shiftDialog.getByRole('button', { name: 'Configurar jornadas' }).click();
  await expect(shiftDialog).toBeHidden();
  await expect(page).toHaveURL(/\/rh\/horarios\/jornadas$/);
  await expect(page.getByRole('heading', { name: 'Jornadas configuradas' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Nueva jornada' })).toHaveCount(0);
});
