# Rediseño UI — Plan 02: Parámetros con alcance por sucursal y pantalla Configuración

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un registro tipado de parámetros con valores por empresa y, cuando el parámetro lo permite, personalizados por sucursal, con auditoría de cada cambio; y la pantalla Configuración del mockup (vista 18) construida sobre él.

**Architecture:** El servidor mantiene la tabla `Setting` actual (clave `"{companyId}_{name}"`) como valor de empresa, agrega `BranchSettingOverride` para los valores por sucursal y `SettingAudit` para el historial. Un registro `SETTINGS_REGISTRY` declara tipo, rango, valor por defecto, si es por sucursal y en qué sección aparece; la API valida contra él. El cliente arma la pantalla a partir de la respuesta del registro: no hay formularios escritos a mano por sección.

**Tech Stack:** Express + Prisma (MySQL) + Jest en `server/`; React + `@/ui` (Plan 01) + Vitest en `client/`.

**Spec:** `docs/superpowers/specs/2026-11-20-rediseno-ui-ux-design.md` · mockup vista 18 · hoja de ruta `2026-11-20-rediseno-ui-00-hoja-de-ruta.md`

## Global Constraints

- Las claves existentes de `WRITABLE_SETTING_KEYS` y `DEFAULT_COMPANY_SETTINGS` (`server/src/services/setting.service.ts`) **no cambian de nombre**: el registro las referencia tal cual. `GET /api/v1/settings` y `PUT /api/v1/settings` siguen respondiendo igual para no romper pantallas viejas.
- Valores siempre se guardan como texto; números con punto decimal y sin separador de miles (`"6400000.00"`). El formato `1,234.50` es solo de presentación.
- Escritura solo para `requireRole(...ADMINS)`; lectura para cualquier usuario autenticado de la empresa.
- Los parámetros legales de nómina (INSS, INATEC, divisor de hora extra) se muestran de solo lectura desde la versión legal activa; no se escriben por esta API.
- Cada cambio registra `SettingAudit` con usuario, alcance, valor anterior y nuevo, dentro de la misma transacción.

## Review Focus

1. Guardar una sucursal con un valor igual al de la empresa → no crea override (o lo elimina si existía): "Heredado" se mantiene coherente.
2. Cambiar el valor de empresa de un parámetro con overrides → las sucursales personalizadas no cambian; las heredadas sí.
3. Número con coma de miles o vacío enviado a un parámetro numérico → 400 con mensaje por clave, nada se guarda (la operación es atómica).
4. Usuario de otra empresa pidiendo `branchId` ajeno → 403/404, nunca datos.
5. Dos administradores guardan la misma sección casi al mismo tiempo → la segunda escritura recibe 409 si el `version` que envió no coincide.

---

### Task 1: Modelo de datos

**Files:** Modify `server/prisma/schema.prisma`; Create migración `server/prisma/migrations/<timestamp>_settings_branch_scope/migration.sql`; Test `server/src/tests/unit/settings-schema.contract.test.ts`.

**Interfaces (Produces):**
```prisma
model BranchSettingOverride {
  id          Int      @id @default(autoincrement())
  companyId   Int
  branchId    Int
  name        String   @db.VarChar(100)   // sin prefijo de empresa
  value       String   @db.Text
  updatedById Int?
  updatedAt   DateTime @updatedAt
  company Company @relation(fields: [companyId], references: [id])
  branch  Branch  @relation(fields: [branchId], references: [id], onDelete: Cascade)
  @@unique([branchId, name])
  @@index([companyId, name])
}
model SettingAudit {
  id        Int      @id @default(autoincrement())
  companyId Int
  branchId  Int?
  name      String   @db.VarChar(100)
  oldValue  String?  @db.Text
  newValue  String?  @db.Text
  userId    Int
  createdAt DateTime @default(now())
  @@index([companyId, name, createdAt])
}
```
- [ ] Step 1: Contract test que lee `schema.prisma` y verifica ambos modelos, `@@unique([branchId, name])` y las relaciones inversas en `Company` y `Branch` → FAIL.
- [ ] Step 2: Editar el schema, `npx prisma migrate dev --name settings_branch_scope` contra la base de desarrollo (no la de costeo `miapitza_costeo_20261119`).
- [ ] Step 3: Test PASS; `npx prisma generate`; `npm test` PASS.
- [ ] Step 4: Commit `feat(settings): branch overrides and audit tables`.

### Task 2: Registro de parámetros y resolución de valores

**Files:** Create `server/src/constants/settings-registry.ts`, `server/src/services/settings-scope.service.ts`; Test `server/src/tests/unit/settings-scope.service.test.ts`.

**Interfaces (Produces):**
```ts
export type SettingType = 'string' | 'number' | 'integer' | 'boolean' | 'enum';
export interface SettingDef { key: string; type: SettingType; default: string; group: SettingGroup; section: string;
  label: string; description: string; min?: number; max?: number; options?: { value: string; label: string }[];
  prefix?: string; suffix?: string; branchable: boolean; readOnly?: 'system' | 'legal-version' }
export type SettingGroup = 'organizacion' | 'ventas' | 'operacion' | 'metas' | 'rrhh' | 'seguridad';
export const SETTINGS_REGISTRY: readonly SettingDef[];
export const SETTINGS_SECTIONS: readonly { id: string; group: SettingGroup; title: string; description: string; note?: string }[];
export interface ResolvedSetting { key: string; value: string; source: 'company' | 'branch' | 'default'; companyValue: string }
export class SettingsScopeService {
  static resolve(companyId: number, branchId: number | null): Promise<Record<string, ResolvedSetting>>;
  static getNumber(companyId: number, branchId: number | null, key: string): Promise<number>;
  static update(companyId: number, branchId: number | null, userId: number, changes: Record<string, string | number | boolean>, expectedVersion?: string):
    Promise<{ resolved: Record<string, ResolvedSetting>; version: string }>;
  static history(companyId: number, opts: { section?: string; key?: string; limit?: number }):
    Promise<{ name: string; branchId: number | null; oldValue: string | null; newValue: string | null; userName: string; createdAt: Date }[]>;
}
```
- Registro: una entrada por fila del mockup vista 18. Claves existentes reutilizadas: `restaurant_name`, `ruc`, `timezone`, `currency_symbol`, `tax_rate`, `invoicePrefix`, `credit_note_series`, `invoiceFooter`, `tipEnabled`, `tipRate`, `cash_reconciliation_tolerance`, `kds_warning_minutes`, `kds_urgent_minutes`, `reservation_table_window_minutes`, `password_expiry_days`, `session_timeout_minutes`, `fiscal_tax_id_length`. Claves nuevas con prefijo de dominio: `goal.monthlySales` (number, branchable, default `0`), `goal.foodCostPct` (32, branchable), `goal.foodCostGapPts` (1), `goal.grossMarginPct` (68), `goal.avgTicket` (550, branchable), `goal.laborCostMaxPct` (25, branchable), `goal.operatingMarginPct` (25), `finance.fixedMonthlyExpenses` (0, branchable), `pos.priceIncludesTax` (boolean, true), `pos.cashRounding` (enum `none|0.50|1.00`), `cash.openingFloat` (2000, branchable), `cash.forcedDropAbove` (30000, branchable), `cash.closeWithDifferenceNeedsSupervisor` (true), `inventory.sellWithoutStock` (enum `block|warn|allow`), `inventory.wasteTolerancePct` (3, branchable), `inventory.coverageDays` (7, branchable), `kitchen.targetMinutes` (15, branchable), `kitchen.newTicketSound` (true), `channel.pedidosYaCommissionPct` (18), `security.twoFactorRequired` (enum `none|admins|all`), `security.maxFailedLogins` (5). Las claves nuevas se agregan a `WRITABLE_SETTING_KEYS`.
- `version` = hash SHA-1 de los `updatedAt` de las filas de la empresa + overrides de la sucursal pedida.
- `update`: valida cada clave contra el registro (tipo, `min`/`max`, `options`, `branchable` si `branchId`, rechaza `readOnly`); normaliza números (`"1,234.5"` → `"1234.50"` para `number`, entero para `integer`); si `branchId` y el valor normalizado es igual al de empresa ⇒ borra el override; escribe `SettingAudit` por clave cambiada; todo en `prisma.$transaction`. Error de validación ⇒ `SettingValidationError` con `{ errors: Record<key, mensaje> }`.

- [ ] Step 1: Tests (Jest con `jest.spyOn(prisma.…)` como `bi-dashboard-metrics.test.ts`):
  - `resolve(1, 3)` con valor de empresa `goal.foodCostPct=32` y override de sucursal `34` ⇒ `{ value:'34', source:'branch', companyValue:'32' }`; sin override ⇒ `source:'company'`; sin fila ⇒ `source:'default'`.
  - `update(1, null, 9, { tax_rate: '1,5' })` ⇒ lanza `SettingValidationError` con `errors.tax_rate`; no llama a `setting.upsert`.
  - `update(1, 3, 9, { tax_rate: 15 })` ⇒ error "no se puede personalizar por sucursal".
  - `update(1, 3, 9, { 'goal.avgTicket': '550.00' })` con empresa `550` ⇒ elimina el override y escribe auditoría.
  - `update` con `expectedVersion` distinto ⇒ `SettingConflictError`.
  - Cada `SETTINGS_REGISTRY[i].section` existe en `SETTINGS_SECTIONS`; no hay claves duplicadas.
- [ ] Step 2: FAIL. Step 3: Implementar. Step 4: PASS.
- [ ] Step 5: Commit `feat(settings): typed registry and scoped resolution`.

### Task 3: API

**Files:** Modify `server/src/routes/setting.routes.ts`, `server/src/controllers/setting.controller.ts`, `server/src/middlewares/validate-schemas.ts`; Test `server/src/tests/unit/settings-scope.routes.test.ts`.

**Interfaces (Produces):**
- `GET /api/v1/settings/registry` → `{ success, data: { sections: SETTINGS_SECTIONS, definitions: SETTINGS_REGISTRY } }`
- `GET /api/v1/settings/resolved?branchId=3` → `{ success, data: { values: Record<key, ResolvedSetting>, version } }`
- `PATCH /api/v1/settings/resolved` body `{ branchId: number | null, version: string, changes: Record<key, string | number | boolean> }` → mismo formato; `400 { errors }`, `409` en conflicto. Solo `ADMINS`.
- `GET /api/v1/settings/history?section=metas&limit=20`.
- `branchId` se valida contra las sucursales de `req.user.companyId` (reutilizar el helper de alcance de sucursal que usa `ReportController.resolveBranchScope`).

- [ ] Step 1: Tests de controlador: rol no admin ⇒ 403 en PATCH; `branchId` de otra empresa ⇒ 404; errores de validación ⇒ 400 con `errors`; conflicto ⇒ 409. Step 2: FAIL. Step 3: Implementar. Step 4: PASS y `npm test`.
- [ ] Step 5: Commit `feat(settings): scoped settings API`.

### Task 4: Cliente — servicio y estado de edición

**Files:** Create `client/src/services/settingsScope.ts`, `client/src/pages/settings/useSettingsDraft.ts`, `client/src/pages/settings/useSettingsDraft.test.ts`.

**Interfaces (Produces):**
```ts
export function fetchRegistry(): Promise<{ sections: SectionDef[]; definitions: SettingDef[] }>;
export function fetchResolved(branchId: number | null): Promise<{ values: Record<string, ResolvedSetting>; version: string }>;
export function saveResolved(branchId: number | null, version: string, changes: Record<string, string | number | boolean>): Promise<{ values: Record<string, ResolvedSetting>; version: string }>;
export function useSettingsDraft(defs: SettingDef[], resolved: Record<string, ResolvedSetting>): {
  draft: Record<string, string>; set(key: string, v: string): void; reset(key: string): void;   // reset = volver a heredado
  dirtyKeys: string[]; errors: Record<string, string>; discard(): void; changes(): Record<string, string> };
```
- [ ] Step 1: Tests de `useSettingsDraft` (función pura + hook): cambiar y volver al valor original ⇒ `dirtyKeys` vacío; número `'abc'` ⇒ `errors[key]` = `'Ingresa un número válido, mayor o igual a 0'`; `reset` en una clave con override ⇒ queda marcada para enviar el valor de empresa. Step 2: FAIL. Step 3: Implementar. Step 4: PASS.
- [ ] Step 5: Commit `feat(settings): client draft state`.

### Task 5: Componentes de configuración en `@/ui`

**Files:** Create `client/src/ui/settings/SettingsRow.tsx`, `ScopeSelector.tsx`, `UnsavedChangesBar.tsx`, `settings.css`, `settings.test.tsx`; export desde `@/ui`.

**Interfaces (Produces):**
- `SettingsRow({ def: SettingDef; value: string; source: 'company'|'branch'|'default'; companyValue: string; scope: 'company' | { branchName: string }; error?: string; dirty: boolean; onChange(v: string): void; onReset(): void })` — elige el control por `def.type` (`Input`, `NumberInput` con `prefix/suffix`, `Switch`, `SegmentedControl` si `options.length ≤ 4` o `AppSelect` si más, texto de solo lectura si `readOnly` o si `scope` es sucursal y `!def.branchable`). Muestra "Heredado de empresa" / "Personalizado en {sucursal} · Restablecer" / "Solo se define a nivel empresa".
- `ScopeSelector({ branches: { id: number; name: string }[]; value: number | null; onChange(id: number | null): void })`.
- `UnsavedChangesBar({ count: number; hasErrors: boolean; saving: boolean; onDiscard(): void; onSave(): void })` — fija abajo, `role="region"` con `aria-label="Cambios sin guardar"`.
- [ ] Step 1: Tests: `def.type='number'` con `prefix='C$'` renderiza `NumberInput` alineado a la derecha; en alcance sucursal y `branchable=false` no hay control editable; `onReset` visible solo si `source==='branch'`; la barra deshabilita "Guardar" con `hasErrors`. Step 2–4: FAIL → implementar → PASS. Step 5: Commit `feat(ui): settings row, scope selector, unsaved bar`.

### Task 6: Pantalla Configuración

**Files:** Create `client/src/pages/settings/SettingsPage.tsx`, `settings-page.test.tsx`; Modify `client/src/App.tsx` (ruta `/settings` apunta a la nueva página; la vieja `pages/Settings.tsx` queda accesible en `/settings/legacy` hasta el Plan 05), `client/src/navigation/navConfig.ts`.

- Layout del mockup vista 18: navegación por grupos (con punto ámbar en secciones con cambios), buscador que filtra por `label` + `description` en todas las secciones, `ScopeSelector`, una `section` por grupo de filas, pie con auditoría ("Última modificación: {usuario} · {fecha}" desde `history`) y enlace "Ver historial" que abre un `Drawer` con la lista. Enlaces de administración (Sucursales y bodegas, Roles y permisos, Dispositivos, Integraciones) apuntan a las rutas existentes.
- Nómina: muestra INSS, INATEC y divisor desde la versión legal activa (servicio existente de `PayrollLegalSettings`) con nota y enlace a esa pantalla.
- [ ] Step 1: Tests: buscar "iva" muestra la fila de `tax_rate` aunque la sección activa sea otra; cambiar un número muestra "1 cambio sin guardar"; guardar llama `saveResolved` con solo las claves cambiadas y el `version` recibido; respuesta 409 ⇒ toast "Otro usuario guardó cambios; recarga para continuar" y no se pierde el borrador. Step 2–4. Verificar en navegador (claro/oscuro, 375 px) contra el mockup.
- [ ] Step 5: Commit `feat(settings): new configuration screen`.

### Task 7: Consumidores de las metas

**Files:** Modify los puntos que hoy leen valores fijos: tolerancia de caja (`cash-shift.service.ts`), tiempos KDS (`kitchen` / `Kitchen.tsx`), y crear `client/src/hooks/useGoals.ts`.

**Interfaces (Produces):** `useGoals(branchId: number | null): { foodCostPct: number; foodCostGapPts: number; grossMarginPct: number; avgTicket: number; laborCostMaxPct: number; operatingMarginPct: number; monthlySales: number }` (consume `fetchResolved`, cache de 60 s).
- [ ] Step 1: Tests: `cash-shift` usa la tolerancia de la sucursal del turno cuando hay override; `useGoals` convierte texto a número. Step 2–4. Step 5: Commit `feat(settings): goals and scoped values consumed by cash and kitchen`; PR `feat/ui-02-configuracion`.
