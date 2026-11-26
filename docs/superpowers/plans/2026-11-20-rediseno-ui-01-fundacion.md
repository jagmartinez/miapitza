# Rediseño UI — Plan 01: Fundación del design system

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear `client/src/ui/`, el design system que usarán todas las pantallas: tokens claro/oscuro, formato numérico, primitivas, formularios con `AppSelect`, `DataTable` paginada, `FullScreenModal`, shell de aplicación y guardas de consistencia, sin romper ninguna pantalla existente.

**Architecture:** Capa nueva `src/ui/` exportada por un barrel `@/ui`. Los componentes viejos (`Modal`, `Sidebar`, `CatalogTable`, `Select`, `Pagination`) pasan a ser adaptadores delgados sobre los nuevos, así toda la app adopta el estilo nuevo sin migrar pantallas todavía. Colores solo por variables `--ui-*`; los tokens viejos `--color-*` se remapean a los nuevos.

**Tech Stack:** React 18, TypeScript 5, Vite 8, Vitest 4 (+ jsdom, Testing Library), react-select 5, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-20-rediseno-ui-ux-design.md` · mockup vistas 1–6 · hoja de ruta `2026-11-20-rediseno-ui-00-hoja-de-ruta.md`

## Global Constraints

- Todos los comandos se corren en `client/`.
- Números: `Intl.NumberFormat('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })` → `1,234.50`; celdas numéricas `text-align: right` + `font-variant-numeric: tabular-nums`.
- Paginación por defecto 25 filas; opciones `[10, 25, 50, 100]`.
- Anchos de columna en `fr` / `minmax()`; `px` solo para columnas de acción o selección (`48px`).
- Tokens exactos (claro / oscuro) — copiados del mockup vista 1:
  `--ui-bg #F7F7F8 / #0F1013` · `--ui-surface #FFFFFF / #17181C` · `--ui-surface-2 #F1F2F4 / #1F2126` · `--ui-border #E4E5E9 / #2B2E35` · `--ui-text #17181C / #ECECEF` · `--ui-text-muted #5F6370 / #A0A4AE` · `--ui-primary #3451D1 / #8EA2FF` · `--ui-primary-hover #2A41A8 / #A9B8FF` · `--ui-primary-fg #FFFFFF / #0F1013` · `--ui-primary-soft #E8ECFD / #232A4D` · `--ui-success #1F7A4D / #4CCF8F` · `--ui-success-soft #E3F4EA / #14301F` · `--ui-warning #A15C07 / #F0B44C` · `--ui-warning-soft #FDF1DC / #35280F` · `--ui-danger #C4322B / #FF7B72` · `--ui-danger-soft #FCE8E6 / #3A1714` · `--ui-overlay rgba(15,16,19,.55) / rgba(0,0,0,.7)`.
- Radios `--ui-radius-sm 6px`, `--ui-radius-md 8px`, `--ui-radius-lg 12px`. Espaciado `--ui-space-1..8` = 4, 8, 12, 16, 20, 24, 32, 48 px. Fuente `--ui-font-sans: 'Inter', system-ui, sans-serif`. Z-index `--ui-z-modal 1000`, `--ui-z-select-menu 1100`, `--ui-z-toast 1200`.
- Alturas de control: 40 px (`md`), 32 px (`sm`), 44 px mínimo en vistas táctiles.
- Modo oscuro por la clase `.dark` en `<html>` que ya pone `context/ThemeContext.tsx`; no se cambia ese mecanismo.
- Ningún componente de `src/ui/` usa colores literales fuera de `tokens.css`.
- Textos de interfaz en español.

## Review Focus

1. Montos que llegan como `string` con comas, `Decimal` de Prisma (`{ toNumber() }`), `null` o `NaN` → deben verse `0.00`, nunca `NaN` ni vacío. (Tarea 3)
2. Cambiar un filtro estando en la página 7 → la tabla vuelve a la página 1; con 0 filas → estado vacío y "0 resultados". (Tarea 7)
3. Menú de `AppSelect` dentro de un `FullScreenModal` → visible por encima del modal y con colores oscuros en `.dark`. (Tareas 6 y 8)
4. Cerrar un `FullScreenModal` con cambios sin guardar (Esc, botón cerrar o "Cancelar") → pide confirmación; el foco vuelve al botón que lo abrió. (Tarea 8)
5. Pantallas existentes que usan `Modal`, `Sidebar` y `CatalogTable` siguen funcionando igual (props, callbacks, paginación de servidor) tras volverlos adaptadores. (Tarea 10)

---

## Estructura de archivos

```
client/src/ui/
  index.ts                      barrel único (@/ui)
  tokens.css  base.css
  format/number.ts              formatNumber, formatMoney, formatQty, formatPercent, parseNumber
  primitives/  Button.tsx IconButton.tsx Badge.tsx StatusBadge.tsx statusTone.ts Spinner.tsx Skeleton.tsx primitives.css
  forms/       Field.tsx Input.tsx NumberInput.tsx Textarea.tsx Checkbox.tsx Switch.tsx SegmentedControl.tsx
               FormSection.tsx FormGrid.tsx DateInput.tsx AppSelect.tsx appSelectStyles.ts forms.css
  data/        DataTable.tsx Pagination.tsx EmptyState.tsx TableToolbar.tsx useTablePagination.ts columnTemplate.ts data.css
  overlays/    FullScreenModal.tsx ConfirmDialog.tsx Drawer.tsx overlays.css
  layout/      AppShell.tsx NavRail.tsx Topbar.tsx PageHeader.tsx PageContent.tsx StatCard.tsx Tabs.tsx layout.css
client/src/navigation/navConfig.ts   definición de menú (grupos, rutas, iconos, permisos)
```

---

### Task 1: Infraestructura de tests de componentes y alias `@/ui`

**Files:**
- Modify: `client/package.json` (devDependencies), `client/vitest.config.ts`, `client/vite.config.ts`, `client/tsconfig.json`
- Create: `client/src/ui/index.ts`, `client/src/ui/smoke.test.tsx`, `client/src/test/setup.ts`

**Interfaces:**
- Produces: alias `@/ui` (→ `src/ui/index.ts`) y `@/ui/*` (→ `src/ui/*`); archivos `*.test.tsx` con `// @vitest-environment jsdom` y matchers de `@testing-library/jest-dom`.

- [ ] **Step 1: Instalar dependencias**

Run: `npm i -D jsdom@25 @testing-library/react@16 @testing-library/user-event@14 @testing-library/jest-dom@6`
Expected: instalación sin errores de peer dependencies.

- [ ] **Step 2: Escribir el test de humo** `src/ui/smoke.test.tsx`

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { UI_VERSION } from '@/ui';

it('resuelve el alias @/ui y renderiza en jsdom', () => {
  render(<span>{UI_VERSION}</span>);
  expect(screen.getByText('1')).toBeInTheDocument();
});
```

- [ ] **Step 3: Correrlo** — Run: `npx vitest run src/ui/smoke.test.tsx` · Expected: FAIL (no resuelve `@/ui`).

- [ ] **Step 4: Configurar**
  - `vitest.config.ts`: `include: ['src/**/*.test.ts', 'src/**/*.test.tsx']`, `setupFiles: ['src/test/setup.ts']`, `resolve.alias` con `{ '@/ui': fileURLToPath(new URL('./src/ui', import.meta.url)) }`.
  - `vite.config.ts`: el mismo `resolve.alias`.
  - `tsconfig.json`: `"baseUrl": "."`, `"paths": { "@/ui": ["src/ui/index.ts"], "@/ui/*": ["src/ui/*"] }`.
  - `src/test/setup.ts`: `import '@testing-library/jest-dom/vitest';`
  - `src/ui/index.ts`: `export const UI_VERSION = '1';`

- [ ] **Step 5: Verificar** — Run: `npx vitest run src/ui/smoke.test.tsx && npm test && npm run typecheck` · Expected: todo PASS (los contract tests existentes siguen en `node`).

- [ ] **Step 6: Commit** — `git add -A client && git commit -m "chore(ui): component test infra and @/ui alias"`

---

### Task 2: Tokens y estilos base

**Files:**
- Create: `client/src/ui/tokens.css`, `client/src/ui/base.css`, `client/src/ui/tokens.contract.test.ts`
- Modify: `client/src/main.tsx` (importar `./ui/tokens.css` y `./ui/base.css` antes de `./index.css`)

**Interfaces:**
- Produces: las variables `--ui-*` de Global Constraints en `:root` y en `.dark`; alias heredados `--color-*` y `--dialog-*` apuntando a `--ui-*`.

- [ ] **Step 1: Test** `tokens.contract.test.ts` (entorno node, lee el CSS como texto)

```ts
const TOKENS = ['--ui-bg','--ui-surface','--ui-surface-2','--ui-border','--ui-text','--ui-text-muted','--ui-primary','--ui-primary-hover','--ui-primary-fg','--ui-primary-soft','--ui-success','--ui-success-soft','--ui-warning','--ui-warning-soft','--ui-danger','--ui-danger-soft','--ui-overlay'];
it('define cada token de color en :root y en .dark', () => {
  const css = read('./tokens.css');
  const root = block(css, ':root'); const dark = block(css, '.dark');
  for (const t of TOKENS) { expect(root).toContain(`${t}:`); expect(dark).toContain(`${t}:`); }
});
it('usa los valores aprobados', () => {
  expect(block(read('./tokens.css'), ':root')).toMatch(/--ui-primary:\s*#3451d1/i);
  expect(block(read('./tokens.css'), '.dark')).toMatch(/--ui-primary:\s*#8ea2ff/i);
});
it('remapea los tokens heredados a los nuevos', () => {
  const css = read('./tokens.css');
  expect(css).toMatch(/--color-primary:\s*var\(--ui-primary\)/);
  expect(css).toMatch(/--color-surface:\s*var\(--ui-surface\)/);
  expect(css).toMatch(/--dialog-accent:\s*var\(--ui-primary\)/);
});
```
(`read` y `block(css, selector)` son helpers locales del test: `block` devuelve el texto entre la llave del primer selector exacto y su cierre.)

- [ ] **Step 2:** Run `npx vitest run src/ui/tokens.contract.test.ts` → FAIL.
- [ ] **Step 3:** Crear `tokens.css` con los valores de Global Constraints. Al final del archivo, bloque `:root, .dark { --color-primary: var(--ui-primary); --color-background: var(--ui-bg); --color-surface: var(--ui-surface); --color-text: var(--ui-text); --color-text-secondary: var(--ui-text-muted); --color-border: var(--ui-border); --color-danger: var(--ui-danger); --color-success: var(--ui-success); --color-warning: var(--ui-warning); --color-primary-light: var(--ui-primary-soft); --color-surface-hover: var(--ui-surface-2); --dialog-accent: var(--ui-primary); --dialog-overlay: var(--ui-overlay); }`. `base.css`: fuente Inter (Google Fonts en `index.html`), `body { background: var(--ui-bg); color: var(--ui-text); }`, `:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }`, scrollbars finas, `color-scheme` por tema.
- [ ] **Step 4:** Run el test → PASS; `npm run build` → OK. Abrir la app (`preview_start` con el dev server del proyecto) y revisar Login, Dashboard y una lista en claro y oscuro: deben verse con la paleta nueva sin roturas de layout.
- [ ] **Step 5:** Commit `feat(ui): design tokens and base styles`.

---

### Task 3: Formato numérico

**Files:** Create `client/src/ui/format/number.ts`, `client/src/ui/format/number.test.ts`; Modify `client/src/ui/index.ts`.

**Interfaces:**
- Consumes: `coerceMoneyAmount(amount: unknown): number` de `src/utils/currency.ts`.
- Produces:
  - `formatNumber(value: unknown, decimals = 2, locale = 'es-NI'): string`
  - `formatMoney(value: unknown, symbol = 'C$', decimals = 2): string` → `'C$ 1,500.00'`
  - `formatQty(value: unknown, decimals = 2): string`
  - `formatPercent(value: unknown, decimals = 2): string` → `'32.50 %'` (recibe 32.5, no 0.325)
  - `parseNumber(text: string): number | null` → quita comas y espacios; `null` si no es número finito.

- [ ] **Step 1: Tests**

```ts
expect(formatNumber(1234567.891)).toBe('1,234,567.89');
expect(formatNumber('1,234.5')).toBe('1,234.50');
expect(formatNumber(null)).toBe('0.00');
expect(formatNumber(NaN)).toBe('0.00');
expect(formatNumber(-0.004)).toBe('0.00');           // sin "-0.00"
expect(formatNumber({ toNumber: () => 3 })).toBe('3.00');
expect(formatNumber(12, 0)).toBe('12');
expect(formatMoney(1500)).toBe('C$ 1,500.00');
expect(formatMoney(-350, 'C$')).toBe('-C$ 350.00');
expect(formatPercent(32.5)).toBe('32.50 %');
expect(parseNumber(' 12,345.67 ')).toBe(12345.67);
expect(parseNumber('abc')).toBeNull();
expect(parseNumber('')).toBeNull();
```
- [ ] **Step 2:** FAIL. **Step 3:** Implementar con `Intl.NumberFormat` cacheado por `locale|decimals` en un `Map`; normalizar `Object.is(rounded, -0)` a `0`. Exportar desde `index.ts`.
- [ ] **Step 4:** PASS. **Step 5:** Commit `feat(ui): number formatters`.

---

### Task 4: Primitivas

**Files:** Create `primitives/Button.tsx`, `IconButton.tsx`, `Badge.tsx`, `StatusBadge.tsx`, `statusTone.ts`, `Spinner.tsx`, `Skeleton.tsx`, `primitives.css`, `primitives/primitives.test.tsx`.

**Interfaces (Produces):**
- `Button(props: ButtonHTMLAttributes & { variant?: 'primary'|'secondary'|'ghost'|'danger'; size?: 'sm'|'md'|'lg'; icon?: LucideIcon; loading?: boolean })` — `type="button"` por defecto; `loading` ⇒ `disabled` + `aria-busy="true"` + Spinner.
- `IconButton(props: ButtonHTMLAttributes & { icon: LucideIcon; label: string; size?: 'sm'|'md' })` — `aria-label={label}`, `title={label}`.
- `type Tone = 'neutral'|'primary'|'success'|'warning'|'danger'`; `Badge({ tone, dot?, children })`.
- `statusTone.ts`: `export const STATUS_TONE: Record<string, Tone>` con al menos `OPEN:'primary', PAID:'success', CANCELLED:'neutral', PENDING:'warning', APPROVED:'success', REJECTED:'danger', DRAFT:'primary', COMPLETED:'success', IN_PROGRESS:'primary', VOID:'neutral'`; `toneFor(status: string): Tone` (default `'neutral'`).
- `StatusBadge({ status, label })` = `Badge` con `toneFor(status)` y `dot`.

- [ ] **Step 1: Tests** — `Button loading` deshabilita y expone `aria-busy`; `Button` sin `type` renderiza `type="button"`; `IconButton` tiene nombre accesible igual a `label`; `toneFor('PAID')==='success'`, `toneFor('X')==='neutral'`; `StatusBadge` agrega la clase `ui-badge--warning` para `PENDING`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar; clases BEM `ui-button ui-button--primary ui-button--md`, `ui-badge ui-badge--{tone}`; estilos solo con `--ui-*`.
- [ ] **Step 4:** PASS. **Step 5:** Commit `feat(ui): primitives`.

---

### Task 5: Controles de formulario

**Files:** Create `forms/Field.tsx`, `Input.tsx`, `NumberInput.tsx`, `Textarea.tsx`, `Checkbox.tsx`, `Switch.tsx`, `SegmentedControl.tsx`, `FormSection.tsx`, `FormGrid.tsx`, `DateInput.tsx`, `forms.css`, `forms/forms.test.tsx`.

**Interfaces (Produces):**
- `Field({ label, htmlFor, hint?, error?, required?, children })` — `error` se muestra con `role="alert"` y pone `aria-invalid` + `aria-describedby` en el control hijo (vía `cloneElement` cuando el hijo es un elemento de `src/ui`).
- `Input(InputHTMLAttributes & { prefix?: ReactNode; suffix?: ReactNode })`.
- `NumberInput({ value: number | null; onChange(v: number | null): void; decimals?: number; prefix?: string; suffix?: string; min?: number; id?: string; 'aria-label'?: string; disabled?: boolean })` — al enfocar muestra el número sin agrupar; al salir muestra `formatNumber(value, decimals)`; alineado a la derecha; usa `parseNumber`.
- `Switch({ checked, onChange(checked: boolean), label, id? })` — `role="switch"` + `aria-checked`.
- `SegmentedControl<T extends string>({ options: { value: T; label: string }[]; value: T; onChange(v: T); ariaLabel: string; size?: 'sm'|'md' })` — botones con `aria-pressed`.
- `FormSection({ title, description?, step?: number, children })` — encabezado con número opcional (mockup vista 5).
- `FormGrid({ columns?: string, children })` — default `repeat(auto-fit, minmax(16rem, 1fr))`.
- `DateInput` — envoltorio de `<input type="date">` que respeta `color-scheme` del tema y reutiliza `src/utils/dateInput.ts`.

- [ ] **Step 1: Tests** — `NumberInput`: escribir `1234.5` y salir ⇒ el input muestra `1,234.50` y `onChange` recibe `1234.5`; escribir `abc` ⇒ `onChange(null)`; enfocar con valor 1234.5 ⇒ muestra `1234.5`. `Field` con `error` ⇒ el input tiene `aria-invalid="true"` y el mensaje tiene `role="alert"`. `Switch` click ⇒ `onChange(true)` y `aria-checked`. `SegmentedControl` ⇒ la opción activa tiene `aria-pressed="true"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:** Commit `feat(ui): form controls`.

---

### Task 6: `AppSelect` (react-select)

**Files:** Create `forms/AppSelect.tsx`, `forms/appSelectStyles.ts`, `forms/AppSelect.test.tsx`; Modify `src/utils/reactSelectTheme.ts` (re-exporta `appSelectStyles`), `src/components/hr/HrReactSelect.tsx` (delegar en `AppSelect`).

**Interfaces (Produces):**
```ts
type Opt<V> = { value: V; label: string; description?: string; isDisabled?: boolean };
type Common<V> = { inputId?: string; 'aria-label'?: string; placeholder?: string; isClearable?: boolean;
  isDisabled?: boolean; size?: 'sm'|'md'; invalid?: boolean; noOptionsText?: string };
export function AppSelect<V>(p: Common<V> & ({ kind?: 'single'; options: Opt<V>[] | GroupBase<Opt<V>>[]; value: V | null; onChange(v: V | null): void }
  | { kind: 'multi'; options: Opt<V>[]; value: V[]; onChange(v: V[]): void }
  | { kind: 'async'; loadOptions(q: string): Promise<Opt<V>[]>; value: Opt<V> | null; onChange(o: Opt<V> | null): void; debounceMs?: number }
  | { kind: 'creatable'; options: Opt<V>[]; value: V | null; onChange(v: V | null): void; onCreate(label: string): void })): JSX.Element
export const appSelectStyles: StylesConfig;   // todo con var(--ui-*)
```
- Siempre: `classNamePrefix="app-select"`, `menuPortalTarget={document.body}`, `menuPosition="fixed"`, `styles.menuPortal → zIndex: var(--ui-z-select-menu)`, `noOptionsMessage → 'Sin resultados'`, `loadingMessage → 'Cargando…'`, `isClearable` true por defecto en `single`. `async` aplica debounce (default 300 ms, reutiliza `src/utils/useDebounce.ts` o un timer local).

- [ ] **Step 1: Tests** — abrir el menú ⇒ la lista se renderiza como hijo de `document.body` (no del contenedor del test); seleccionar opción ⇒ `onChange` recibe el `value` (no el objeto); `kind="multi"` ⇒ `onChange` recibe arreglo de valores; sin coincidencias ⇒ texto `Sin resultados`; `invalid` ⇒ el control tiene `aria-invalid="true"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS y `npm test` completo (los contract tests de RH que leen `HrReactSelect` siguen pasando; si alguno valida texto interno, actualizar solo la aserción de importación y anotarlo en el commit).
- [ ] **Step 5:** Commit `feat(ui): AppSelect over react-select`.

---

### Task 7: `DataTable`, `Pagination` y estados vacíos

**Files:** Create `data/DataTable.tsx`, `data/Pagination.tsx`, `data/EmptyState.tsx`, `data/TableToolbar.tsx`, `data/useTablePagination.ts`, `data/columnTemplate.ts`, `data/data.css`, `data/DataTable.test.tsx`.

**Interfaces (Produces):**
```ts
export type ColumnType = 'text'|'number'|'money'|'qty'|'percent'|'date'|'status'|'actions';
export interface Column<T> { key: string; header: ReactNode; width?: string; type?: ColumnType;
  accessor?: (row: T) => unknown; render?: (row: T) => ReactNode; decimals?: number;
  total?: boolean; sortable?: boolean; hideBelow?: 'md'|'lg' }
export type PaginationMode = { mode: 'client' }
  | { mode: 'server'; page: number; pageSize: number; total: number; onChange(page: number, pageSize: number): void };
export interface DataTableProps<T> { columns: Column<T>[]; rows: T[]; rowKey(row: T): string|number;
  ariaLabel: string; pagination?: PaginationMode; pageSizeOptions?: number[]; defaultPageSize?: number;
  resetKey?: unknown; loading?: boolean; empty?: ReactNode; toolbar?: ReactNode; footerLabel?: ReactNode;
  onRowClick?(row: T): void; rowTone?(row: T): Tone | undefined; minWidth?: string }
export function columnTemplate(cols: Column<unknown>[]): string;   // 'minmax(0,2.4fr) minmax(0,1fr) 48px'
export function useTablePagination(total: number, opts: { defaultPageSize?: number; resetKey?: unknown }):
  { page: number; pageSize: number; setPage(p: number): void; setPageSize(s: number): void; range: [number, number] };
export function Pagination(p: { page: number; pageSize: number; total: number; pageSizeOptions?: number[];
  onChange(page: number, pageSize: number): void; label?: string }): JSX.Element;
```
- Layout: `<table>` semántico con `display: grid` en `thead tr`/`tbody tr`/`tfoot tr` y `grid-template-columns: columnTemplate(columns)`; contenedor con `overflow-x: auto` y `min-width` (default `48rem`).
- `width` por defecto `1fr`; `columnTemplate` envuelve cada `Nfr` como `minmax(0,Nfr)` y deja `px`, `rem` y `minmax(...)` tal cual.
- Tipos `number|money|qty|percent` ⇒ celda derecha `ui-cell--numeric` con `formatNumber/formatPercent` sobre `accessor(row)`; `money` sin símbolo (el símbolo va en el encabezado, p. ej. `Total (C$)`).
- `total: true` ⇒ fila `tfoot` con la suma de la **página visible** en esa columna; `footerLabel` en la primera celda.
- `Pagination`: texto `"{inicio}–{fin} de {total}"` o `"0 resultados"`, selector de tamaño (`SegmentedControl` compacto), anterior/siguiente y números de página con elipsis (máx. 7 botones). Siempre visible.
- `onRowClick` ⇒ fila con `tabIndex=0`, Enter abre; los clics en `button, a, input, label, [role=switch]` dentro de la fila se ignoran (mismo criterio que `CatalogTable`).

- [ ] **Step 1: Tests**
  - 60 filas, modo cliente ⇒ 25 filas en `tbody` y texto `1–25 de 60`.
  - En página 3 cambiar `resetKey` ⇒ vuelve a `1–25 de 60`.
  - Columna `money` con `accessor: r => 1234.5` ⇒ celda `1,234.50` con clase `ui-cell--numeric`.
  - `columnTemplate([{width:'2.4fr'},{width:'minmax(8rem,1fr)'},{width:'48px'}])` ⇒ `'minmax(0,2.4fr) minmax(8rem,1fr) 48px'`.
  - 0 filas ⇒ renderiza `empty` dentro de la tabla y el paginador dice `0 resultados`.
  - `total: true` en página 2 ⇒ suma solo las filas visibles.
  - Modo servidor ⇒ no recorta `rows`; clic en "Página siguiente" llama `onChange(2, 25)`.
  - Valor `null` en columna `number` ⇒ `0.00`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(ui): DataTable with fr columns and pagination`.

---

### Task 8: Overlays — `FullScreenModal`, `ConfirmDialog`, `Drawer`

**Files:** Create `overlays/FullScreenModal.tsx`, `overlays/ConfirmDialog.tsx`, `overlays/Drawer.tsx`, `overlays/overlays.css`, `overlays/FullScreenModal.test.tsx`.

**Interfaces:**
- Consumes: `useDialogA11y(isOpen, onClose, containerRef, { closeOnEscape?, lockScroll? })` de `src/hooks/useDialogA11y.ts` (devuelve `{ titleId, descriptionId }`).
- Produces:
```ts
export interface ModalTab { id: string; label: string; badge?: string | number; disabled?: boolean }
export interface FullScreenModalProps { isOpen: boolean; onClose(): void; title: string; subtitle?: ReactNode;
  breadcrumb?: string[]; status?: ReactNode; tabs?: ModalTab[]; activeTab?: string; onTabChange?(id: string): void;
  aside?: ReactNode; footer?: ReactNode; footerStart?: ReactNode; dirty?: boolean; dirtyMessage?: string;
  headerActions?: ReactNode; children: ReactNode }
export function ConfirmDialog(p: { isOpen: boolean; title: string; message: ReactNode; confirmLabel?: string;
  cancelLabel?: string; tone?: 'primary'|'danger'; loading?: boolean; onConfirm(): void; onCancel(): void }): JSX.Element | null;
export function Drawer(p: { isOpen: boolean; onClose(): void; title: string; width?: 'sm'|'md'; footer?: ReactNode; children: ReactNode }): JSX.Element | null;
```
- `FullScreenModal`: portal a `document.body`, `100dvw × 100dvh`, `role="dialog" aria-modal="true"`. Anatomía (mockup vista 5): header fijo (breadcrumb, título, `status`, `headerActions`, cerrar) → `role="tablist"` (flechas izquierda/derecha cambian de pestaña) → cuerpo con un único scroll y grilla `minmax(0,1fr) 20rem` cuando hay `aside` (en < 1024 px el `aside` baja debajo) → footer fijo: `footerStart` a la izquierda, `footer` a la derecha.
- `dirty` ⇒ cualquier intento de cierre (Esc, botón cerrar) abre `ConfirmDialog` "¿Descartar cambios?" (`dirtyMessage`), con "Seguir editando" / "Descartar".
- `ConfirmDialog`: centrado, ancho 28rem, `role="alertdialog"`, foco inicial en cancelar si `tone="danger"`.
- `Drawer`: panel lateral derecho solo para filtros y vistas rápidas (no para formularios de alta/edición).

- [ ] **Step 1: Tests** — abierto ⇒ el diálogo es hijo de `document.body` con `aria-modal`; `Esc` sin `dirty` ⇒ `onClose` una vez; `Esc` con `dirty` ⇒ aparece "¿Descartar cambios?" y `onClose` no se llama hasta "Descartar"; al cerrar, el foco vuelve al botón que lo abrió; con `tabs`, flecha derecha ⇒ `onTabChange('siguiente')`; `ConfirmDialog` llama `onConfirm`/`onCancel`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(ui): full-screen modal, confirm dialog, drawer`.

---

### Task 9: Shell de aplicación y navegación

**Files:**
- Create: `client/src/navigation/navConfig.ts`, `ui/layout/AppShell.tsx`, `NavRail.tsx`, `Topbar.tsx`, `PageHeader.tsx`, `PageContent.tsx`, `StatCard.tsx`, `Tabs.tsx`, `layout.css`, `ui/layout/layout.test.tsx`
- Modify: `client/src/components/Layout.tsx` (renderizar `AppShell` con `navConfig`; conservar `Outlet`, `ConfirmProvider`, `ErrorBoundary`, `NetworkStatus`, `SyncStatus`, logout y reglas de permisos actuales), `components/responsive-navigation.contract.test.ts`, `components/navigationPermissions.contract.test.ts`

**Interfaces (Produces):**
```ts
export interface NavItem { id: string; label: string; to: string; icon: LucideIcon; permission?: string; roles?: readonly string[] }
export interface NavGroup { id: string; label: string; items: NavItem[] }
export const NAV_GROUPS: NavGroup[];   // Operación, Inventario, Compras, Producción, Finanzas, Recursos humanos, Configuración
export function visibleNav(groups: NavGroup[], user: AuthUser): NavGroup[];   // aplica las mismas reglas de Layout.tsx de hoy
export function AppShell(p: { nav: NavGroup[]; collapsed: boolean; onToggleCollapsed(): void; topbar: ReactNode; children: ReactNode }): JSX.Element;
export function NavRail(p: { nav: NavGroup[]; activePath: string }): JSX.Element;   // 64 px, solo iconos con aria-label y title
export function PageHeader(p: { title: string; description?: ReactNode; breadcrumb?: string[]; actions?: ReactNode }): JSX.Element;
export function StatCard(p: { label: string; value: ReactNode; context: ReactNode; tone?: Tone; action?: { label: string; to?: string; onClick?(): void } }): JSX.Element;
export function Tabs(p: { tabs: ModalTab[]; active: string; onChange(id: string): void; ariaLabel: string }): JSX.Element;
```
- `StatCard.context` es **obligatorio** (regla del spec: valor + contexto; sin conteos sueltos).
- Estado `collapsed` persistido en `localStorage('ui.nav.collapsed')` con try/catch. En < 768 px el menú se abre como `Drawer`.
- `Topbar`: migas, buscador global (abre con `Ctrl+K`, solo navega por `NAV_GROUPS` en esta fase), selector de sucursal existente, `ThemeToggle`, `KitchenNotificationBell`, avatar → `/profile`. (Desviación: `KitchenNotificationBell` queda fuera del Topbar porque `table-operations.contract.test` lo prohíbe en Layout; las pantallas que lo necesitan lo inyectan vía `controls`.)

- [ ] **Step 1: Tests** — `visibleNav` oculta Nómina a un usuario con rol cajero y la muestra a ADMIN (usar los mismos roles/permisos que hoy usa `Layout.tsx`); `NavRail` marca `aria-current="page"` en la ruta activa; `StatCard` exige `context` (test de tipos con `// @ts-expect-error` cuando falta); los dos contract tests de navegación actualizados a la nueva estructura → FAIL antes de implementar.
- [ ] **Step 2:** FAIL. **Step 3:** Mover la definición de menú de `Layout.tsx` a `navConfig.ts` sin cambiar permisos; implementar componentes; `Layout.tsx` queda como composición.
- [ ] **Step 4:** PASS; `npm run test:e2e` (navegación) PASS; verificar en navegador a 1440/768/375 px en claro y oscuro.
- [ ] **Step 5:** Commit `feat(ui): app shell, nav rail and page primitives`.

---

### Task 10: Adaptadores de componentes heredados

**Files:** Modify `client/src/components/Modal.tsx`, `Sidebar.tsx`, `CatalogTable.tsx`, `Select.tsx`, `Pagination.tsx`, `ConfirmDialog.tsx`; Create `client/src/components/legacy-adapters.test.tsx`.

**Interfaces:**
- Consumes: Tareas 6, 7, 8.
- Produces: mismas props públicas que hoy; por dentro:
  - `Modal` (center) → `ConfirmDialog`-like compacto para `size="sm"`; `md`/`lg` y `variant="sidebar"` → `FullScreenModal` (`footer` se pasa tal cual).
  - `Sidebar` → `FullScreenModal` (`width` se ignora).
  - `CatalogTable` → `DataTable` (`align:'right'` ⇒ `type:'number'` solo para alineación, conserva `render`; `pageSize` ⇒ `defaultPageSize`; `pagination` servidor ⇒ modo `server` con `pageSize` fijo).
  - `Select` → `AppSelect` single.
  - `Pagination` → `ui/data/Pagination` (convierte `onPageChange(page)` a `onChange(page, pageSize)`).

- [ ] **Step 1: Tests** — `CatalogTable` con `pagination` de servidor llama `onPageChange(2)` al avanzar; `Sidebar isOpen` renderiza un diálogo a pantalla completa con el `title`; `Modal size="sm"` sigue centrado; `dialog-foundation.contract.test.ts` sigue en verde (todos siguen usando `createPortal` + `document.body`).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar adaptadores.
- [ ] **Step 4:** `npm test && npm run build && npm run test:e2e` → PASS. Recorrer en navegador Menú, Mesas, Inventario, Compras y RH: abrir un formulario y una tabla en cada uno.
- [ ] **Step 5:** Commit `refactor(ui): legacy components delegate to the design system`.

---

### Task 11: Página de referencia viva

**Files:** Create `client/src/pages/UiPlayground.tsx`; Modify `client/src/App.tsx` (ruta `/dev/ui` solo cuando `import.meta.env.DEV`).

- [ ] **Step 1:** Página que muestra cada componente de `@/ui` con los mismos ejemplos del mockup vista 2 (incluye `DataTable` con 60 filas, `FullScreenModal` con tabs y `aside`, `AppSelect` en sus cuatro variantes).
- [ ] **Step 2:** Verificar en navegador en claro/oscuro y 375 px; captura de pantalla adjunta al PR.
- [ ] **Step 3:** Commit `docs(ui): live component playground`.

---

### Task 12: Guardas de consistencia

**Files:** Modify `client/eslint.config.js`; Create `client/src/ui/no-legacy.contract.test.ts`, `client/src/ui/legacy-allowlist.json`.

**Interfaces (Produces):** `legacy-allowlist.json` = `{ "nativeSelect": string[], "rawTable": string[], "reactSelectImport": string[], "toFixedInJsx": string[] }` con las rutas actuales que aún violan cada regla. El Plan 04 la vacía módulo a módulo.

- [ ] **Step 1: Test** — recorre `src/**/*.tsx` (excepto `src/ui/**`); por regla, falla si un archivo viola y **no** está en la allowlist, y también falla si un archivo de la allowlist **ya no** viola (obliga a sacarlo de la lista). Reglas: `<select` · `<table` · `from 'react-select'` · `.toFixed(` dentro de JSX.
- [ ] **Step 2:** Generar la allowlist inicial con un script de una sola vez y revisar que coincide con el inventario del spec (≈27 tablas, 42 imports de react-select, 5 selects nativos).
- [ ] **Step 3:** ESLint `no-restricted-imports` en nivel `warn`: `react-select` fuera de `src/ui/**`; `**/components/Modal`, `**/components/Sidebar`, `**/components/CatalogTable` en archivos nuevos (`warn` hasta el Plan 05).
- [ ] **Step 4:** `npm run lint && npm test` → PASS.
- [ ] **Step 5:** Commit `chore(ui): consistency guards with shrinking allowlist`; abrir PR `feat/ui-01-fundacion` → `main`.
