# Rediseño total UI/UX — Especificación de diseño

> Documento de diseño aprobado el 2026-11-20 junto con el mockup. La ejecución está en `docs/superpowers/plans/2026-11-20-rediseno-ui-00-hoja-de-ruta.md` y los planes 01–05; las secciones "Tarea N" de abajo son el desglose original y quedan como referencia.

**Objetivo:** Rehacer el layout y el sistema visual del cliente web (React + Vite) con un design system propio, minimalista, con modo oscuro, componentes estándar reutilizables, modales a pantalla completa jerarquizados, tablas paginadas con columnas en `fr` y montos con separador de miles, 2 decimales y alineados a la derecha.

**Arquitectura:** Se crea una capa `src/ui/` (design system) con tokens CSS, primitivas y patrones de página. Las páginas se migran módulo por módulo a esa capa; los componentes viejos (`Modal`, `Sidebar`, `CatalogTable`, `Select`, `Pagination`, `Card`, `Button`, `Input`) quedan como *shims* que re-exportan la nueva implementación hasta que la última página migre, y luego se eliminan junto con su CSS.

**Stack:** React 18, TypeScript, Vite 8, react-select 5, lucide-react, Vitest, Playwright. Sin librería CSS nueva (CSS con tokens + CSS Modules o archivos por componente).

**Mockup aprobado:** artifact "Rediseño UI Restaurante" (ver enlace en la conversación). Es la referencia visual de cada tarea.

## Estado actual (inventario 2026-11-20)

- 152 `.tsx`, 98 `.css`; `index.css` tiene 1 677 líneas con tokens mezclados con estilos de módulos.
- Modales: `Modal` (centrado sm/md/lg) y `Sidebar` (panel lateral, 38 páginas) conviven; patrón `premium-modal-content` documentado en `docs/AUDITORIA_UX_UI_MODALES_2026-07-13.md`.
- Tablas: `CatalogTable` (paginada, 20 páginas) + 27 archivos con `<table>` crudo (Inventory, Kardex, Reports, PurchaseOrders, CostReport, HR…). Anchos de columna sin control.
- Selects: 42 archivos usan `react-select` directo, 39 usan `components/Select`, 5 `<select>` nativo; tema en `utils/reactSelectTheme.ts` y `components/hr/HrReactSelect.tsx` (duplicado).
- Números: 36 archivos formatean a mano (`toFixed`, `toLocaleString`, `Intl`); existe `formatCurrencyGrouped` en `utils/currency.ts`.
- Dark mode: clase `.dark` en `<html>` vía `ThemeContext` — se conserva el mecanismo.

## Restricciones globales

- Montos y cantidades: `Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })`, locale por defecto `es-NI` → `12,345.67`. Siempre `text-align: right` + `font-variant-numeric: tabular-nums`. Moneda: símbolo en la celda, no en cada fila si la columna ya lo indica en el encabezado (`Total (C$)`).
- Toda tabla tiene paginación (cliente o servidor); tamaños 10/25/50/100, por defecto 25.
- Anchos de columna con `grid-template-columns` en `fr` / `minmax()`; nunca `px` fijos salvo columnas de acción/checkbox (`48px`).
- Todo select usa `<AppSelect>` (react-select). Prohibido `<select>` nativo y `import Select from 'react-select'` fuera de `src/ui/`.
- Modales de formulario/detalle: pantalla completa (`100dvw × 100dvh`), header fijo, cuerpo con scroll único, footer fijo. Confirmaciones: diálogo compacto centrado (`ConfirmDialog`).
- Colores solo vía tokens `--ui-*`; contraste AA en claro y oscuro.
- Tarjetas KPI (`StatCard`): solo información que lleve a una decisión — dinero en riesgo, reposición requerida, desviación contra meta/costo teórico, concentración, vencimientos. Cada tarjeta = valor + contexto (comparación o detalle) + acción opcional. Prohibidos los conteos triviales ("activos", "inactivos", "total de registros"). Si una vista no tiene un KPI accionable, no lleva tarjetas. La definición de KPIs por módulo se valida con el usuario antes de migrar ese módulo (ver tabla de Tareas 7–13).
- No se cambian contratos API ni lógica transaccional.
- Accesibilidad: foco atrapado y devuelto, `Esc`, `aria-modal`, tabs con `role=tablist`; reutilizar `hooks/useDialogA11y.ts`.

## Foco de revisión

1. Valores nulos/strings/`Decimal` de Prisma en celdas numéricas → deben mostrar `0.00` o `—`, nunca `NaN`.
2. Tabla con 0 filas o filtro sin resultados → estado vacío dentro de la tabla y paginador "0 resultados", sin saltos de layout.
3. Cambiar filtro estando en página 7 → vuelve a página 1.
4. Modal pantalla completa en móvil (375 px) con teclado virtual → footer visible, sin scroll horizontal.
5. Dark mode en react-select (menú en portal) y en inputs `date` → colores de tokens, no blanco.

---

## Estructura de archivos

```
src/ui/
  tokens.css            colores, tipografía, espaciado, radios, sombras, z-index (claro + .dark)
  base.css              reset, tipografía base, scrollbars, focus-visible
  format/number.ts      formatNumber, formatMoney, formatQty, formatPercent
  primitives/           Button, IconButton, Input, NumberInput, Textarea, Checkbox, Switch,
                        Badge, Tooltip, Spinner, Skeleton, Divider
  forms/                Field (label+hint+error), FormGrid, FormSection, AppSelect, DateInput
  data/                 DataTable, Pagination, TableToolbar, EmptyState, NumericCell, StatusBadge
  overlays/             FullScreenModal, ConfirmDialog, Drawer (solo filtros), Toast
  layout/               AppShell, Sidebar nav, Topbar, PageHeader, PageContent, Tabs, StatCard
  index.ts              barrel único: import { DataTable, AppSelect } from '@/ui'
```

---

### Tarea 1: Tokens, base y alias `@/ui`

**Archivos:** Crear `src/ui/tokens.css`, `src/ui/base.css`, `src/ui/index.ts`. Modificar `src/main.tsx`, `vite.config.ts`, `tsconfig.json` (alias `@/ui`).

**Produce:** variables `--ui-bg`, `--ui-surface`, `--ui-surface-2`, `--ui-border`, `--ui-text`, `--ui-text-muted`, `--ui-primary`, `--ui-primary-fg`, `--ui-success`, `--ui-warning`, `--ui-danger`, `--ui-radius-sm|md|lg` (6/8/12 px), `--ui-space-1..8` (4 px base), `--ui-font-sans` (Inter), `--ui-font-mono`, `--ui-z-modal` (1000), `--ui-z-select-menu` (1100). Valores exactos en el mockup.

- [ ] Paso 1: test `src/ui/tokens.contract.test.ts` — lee `tokens.css` y verifica que cada token existe en `:root` y en `.dark`.
- [ ] Paso 2: ejecutar `npx vitest run src/ui/tokens.contract.test.ts` → FAIL.
- [ ] Paso 3: crear tokens/base; importar en `main.tsx` antes de `index.css`; mapear tokens viejos (`--color-*`) a los nuevos al final de `tokens.css` para que las pantallas no migradas hereden la nueva paleta.
- [ ] Paso 4: test PASS; `npm run build` verde.
- [ ] Paso 5: commit `feat(ui): design tokens and base styles`.

### Tarea 2: Formato numérico

**Archivos:** Crear `src/ui/format/number.ts`, test `src/ui/format/number.test.ts`.

**Produce:** `formatNumber(v: unknown, decimals = 2, locale = 'es-NI'): string`, `formatMoney(v: unknown, symbol?: string): string`, `formatQty(v: unknown, decimals = 2): string`, `formatPercent(v: unknown, decimals = 2): string`. Usa `coerceMoneyAmount` de `utils/currency.ts`.

- [ ] Paso 1: tests: `formatNumber(1234567.891) === '1,234,567.89'`; `formatNumber('1,234.5') === '1,234.50'`; `formatNumber(null) === '0.00'`; `formatNumber(NaN) === '0.00'`; `formatNumber(-0.004) === '0.00'`; `formatMoney(1500, 'C$') === 'C$ 1,500.00'`; objeto `{ toNumber: () => 3 }` → `'3.00'`.
- [ ] Paso 2: FAIL. Paso 3: implementar con `Intl.NumberFormat` cacheado por locale/decimales; normalizar `-0`. Paso 4: PASS.
- [ ] Paso 5: commit `feat(ui): shared number formatters`.

### Tarea 3: Primitivas y formularios (Button, Input, NumberInput, Field, FormSection, FormGrid, AppSelect)

**Archivos:** `src/ui/primitives/*`, `src/ui/forms/*`, tests `src/ui/forms/AppSelect.test.tsx`, `src/ui/primitives/NumberInput.test.tsx`.

**Produce:**
- `Button` props `{ variant: 'primary'|'secondary'|'ghost'|'danger'; size?: 'sm'|'md'; icon?: LucideIcon; loading?: boolean }`.
- `NumberInput` `{ value: number|null; onChange(v: number|null); decimals?: number; prefix?: string }` — muestra agrupado y alineado a la derecha al perder foco, valor crudo al enfocar.
- `Field` `{ label; htmlFor; hint?; error?; required? }`.
- `FormSection` `{ title; description?; icon? }` — título h3 + divisor; `FormGrid` `{ columns?: string }` (por defecto `repeat(auto-fit, minmax(16rem, 1fr))`).
- `AppSelect<T>` envuelve `react-select` (`Select`, `AsyncSelect`, `CreatableSelect` vía prop `kind`) con `classNamePrefix="app-select"`, `menuPortalTarget={document.body}`, estilos 100 % por tokens, `isClearable`, `noOptionsMessage="Sin resultados"`, `loadingMessage="Cargando…"`. Reemplaza `utils/reactSelectTheme.ts` y `components/hr/HrReactSelect.tsx`.

- [ ] Paso 1: tests — AppSelect renderiza opciones con `aria-label`, menú en `document.body` con `z-index` `var(--ui-z-select-menu)`; NumberInput blur `1234.5` → muestra `1,234.50`, `onChange(1234.5)`.
- [ ] Paso 2: FAIL. Paso 3: implementar. Paso 4: PASS.
- [ ] Paso 5: `components/Select.tsx` re-exporta `AppSelect` (shim); `utils/reactSelectTheme.ts` delega. Commit `feat(ui): primitives, form fields and AppSelect`.

### Tarea 4: DataTable + Pagination

**Archivos:** `src/ui/data/DataTable.tsx`, `DataTable.css`, `Pagination.tsx`, `NumericCell.tsx`, `EmptyState.tsx`, `TableToolbar.tsx`; test `src/ui/data/DataTable.test.tsx`.

**Produce:**
```ts
interface Column<T> {
  key: string; header: ReactNode; render?: (row: T) => ReactNode;
  width?: string;              // fr/minmax, p.ej. '2fr', 'minmax(8rem,1fr)', '48px'
  type?: 'text'|'number'|'money'|'qty'|'percent'|'date'|'status'|'actions';
  accessor?: (row: T) => unknown;  // usado por type numérico y orden
  sortable?: boolean; total?: boolean; // total: suma en fila pie
}
interface DataTableProps<T> {
  columns: Column<T>[]; rows: T[]; rowKey(row: T): string|number;
  pagination?: { mode: 'client' } | { mode: 'server'; page; pageSize; total; onChange(page, pageSize) };
  pageSizeOptions?: number[];  // [10,25,50,100], default 25
  resetKey?: unknown; loading?: boolean; onRowClick?(row: T); empty?: ReactNode;
  toolbar?: ReactNode; stickyHeader?: boolean; ariaLabel: string;
}
```
- Layout: CSS grid (`role="table"`/`row`/`cell` o `<table>` con `display: grid` en `thead/tbody/tr` y `grid-template-columns` calculado de `width`, por defecto `1fr`).
- Columnas `number|money|qty|percent` → `NumericCell` (derecha, `tabular-nums`, formateadas con Tarea 2).
- Paginación siempre visible: "1–25 de 312", selector de tamaño (AppSelect compacto), primera/anterior/siguiente/última.

- [ ] Paso 1: tests — 60 filas → 25 renderizadas y texto `1–25 de 60`; cambiar `resetKey` en pág. 3 vuelve a pág. 1; columna `money` con `1234.5` muestra `1,234.50` y clase `is-numeric`; `grid-template-columns` = `2fr minmax(8rem,1fr) 48px` para esos widths; 0 filas → empty + `0 resultados`; `total: true` suma la página visible.
- [ ] Paso 2: FAIL. Paso 3: implementar. Paso 4: PASS.
- [ ] Paso 5: `components/CatalogTable.tsx` se vuelve adaptador sobre `DataTable` (mapea `align:'right'` → `type:'number'`). Commit `feat(ui): DataTable with fr columns and pagination`.

### Tarea 5: Overlays — FullScreenModal, ConfirmDialog, Drawer, Toast

**Archivos:** `src/ui/overlays/*`; test `src/ui/overlays/FullScreenModal.test.tsx`.

**Produce:** `FullScreenModal { isOpen; onClose; title; subtitle?; breadcrumb?: string[]; tabs?: {id,label,icon?,badge?}[]; activeTab?; onTabChange?; aside?: ReactNode; footer?: ReactNode; dirty?: boolean; children }`.
Anatomía: header fijo (breadcrumb · título · subtítulo · cerrar) → tabs → grid `minmax(0,1fr) 20rem` (contenido + resumen lateral `aside`, colapsa bajo 1024 px) → footer fijo (secundarias a la izquierda, `Cancelar` + primaria a la derecha). Si `dirty`, cerrar pide confirmación. Reusa `useDialogA11y`.

- [ ] Paso 1: tests — ocupa `100dvh`; `Esc` cierra; con `dirty` muestra ConfirmDialog antes de cerrar; foco vuelve al disparador; tabs con `role="tab"` y flechas.
- [ ] Paso 2: FAIL. Paso 3: implementar. Paso 4: PASS.
- [ ] Paso 5: `components/Modal.tsx` y `components/Sidebar.tsx` delegan a `FullScreenModal` (shims). Commit `feat(ui): full-screen modal and dialogs`.

### Tarea 6: Shell de aplicación (AppShell, nav lateral, Topbar, PageHeader, StatCard, Tabs)

**Archivos:** `src/ui/layout/*`; modificar `src/components/Layout.tsx` para usar `AppShell` (conservar permisos de `navigationPermissions` y rutas). Eliminar `Layout.css` al final.

**Produce:** `AppShell` (nav colapsable 16rem/4rem, agrupada por módulo: Operación, Inventario, Compras, Producción, Finanzas, RH, Configuración; Topbar con buscador global ⌘K, sucursal, tema, notificaciones, usuario). `PageHeader { title; description?; actions?; breadcrumb? }`. `PageContent` max-width fluido con padding de tokens.

- [ ] Paso 1: actualizar `responsive-navigation.contract.test.ts` y `navigationPermissions.contract.test.ts` a la nueva estructura → FAIL.
- [ ] Paso 2: implementar; PASS; verificar en navegador claro/oscuro, 1440/768/375 px.
- [ ] Paso 3: commit `feat(ui): new app shell and navigation`.

### Tareas 7–13: Migración por módulo

Cada tarea: reemplazar `Sidebar`/`Modal` por `FullScreenModal`, tablas por `DataTable` (definir `width` en `fr` y `type` por columna), selects por `AppSelect`, montos por `formatMoney/NumberInput`, cabecera por `PageHeader`; eliminar el CSS local obsoleto; actualizar contract tests del módulo; captura en claro/oscuro; commit por tarea.

| # | Módulo | Pantallas |
|---|--------|-----------|
| 7 | Catálogos | Menu, Categories, Brands, UnitsOfMeasure, ProductUnitSettings, Suppliers, Branches, Companies, Warehouses, CashRegisters |
| 8 | Inventario | Inventory, Kardex, WasteReport, CostReport |
| 9 | Compras | PurchaseOrders, PurchaseOrderForm, PurchaseOrderImport, InvoiceHistory, BankReconciliation |
| 10 | Producción | ProductionDashboard, ProductionOrders, ProductionRecipes |
| 11 | Operación | Tables, Reservations, Orders, Kitchen, POS, CashShift, Catering, CateringServices, Promotions, PedidosYa. POS y Cocina usan layout operativo a pantalla completa con objetivos táctiles de 44 px o más (ver mockups 8 y 9) |
| 12 | RH | pages/hr/* y components/hr/* — unificar 20 CSS de `pages/hr` en el design system |
| 13 | Admin y reportes | Dashboard, Reports, Users, RolesPermissions, Settings, Profile, ChangePassword, Login, NotFound |

#### Referencia visual y KPIs por vista (mockup)

| Mockup | Layout | Tarjetas / información accionable |
|---|---|---|
| 7 Mesas | Rail + plano por zona + panel de detalle de la mesa | Consumo abierto y pre-cuentas sin cobrar · mesas con más de 90 min · próxima reserva y mesa a liberar |
| 8 Cocina (KDS) | Pantalla completa, oscuro por defecto, columnas Recibidas / En preparación / Listas | Tiempo promedio vs meta · comandas atrasadas · insumo agotado |
| 9 POS | Rail + catálogo táctil + orden lateral fija | Stock bajo/agotado en la tarjeta del producto |
| 10 Caja | Arqueo por denominación + conciliación | Esperado vs contado, faltante/sobrante con bloqueo de cierre |
| 11 Menú | Tabla + panel de costeo del plato | Margen ponderado vs meta · platos sobre food cost meta · platos sin receta · clasificación popularidad × margen |
| 12 Recetas | Maestro-detalle | Variación del costo unitario vs versión anterior y su causa · insumo de mayor peso |
| 13 Producción | Lista paginada | Sobrecosto real vs estimado · plan bloqueado por insumos · rendimiento vs estándar |
| 14 Dashboard BI | Barra de filtros fija (periodo, comparar con periodo/año anterior, sucursales) + 6 KPIs con sparkline y avance a meta + tendencia con meta y comparación + hallazgos ordenados por impacto en C$ + puente venta→utilidad operativa + mezcla de canal + mapa de calor día×hora + Pareto de margen + comparativo de sucursales con semáforo | Todo se calcula contra las metas de Configuración › Metas del negocio |
| 15 Reportes | Catálogo lateral + visor | Lectura rápida en texto + gráfico + tabla con totales y comparación interanual |
| 16 Perfil | Encabezado (roles, sucursales, completitud) + pestañas Resumen / Seguridad y accesos / Preferencias / Notificaciones | Esperan mi aprobación (con montos), mi desempeño como aprobador, mi nómina, vacaciones por vencer, horario; salud de la cuenta, sesiones, historial de accesos, matriz de permisos; matriz evento × canal de notificación |
| 17 Nómina | Stepper de estado + tabla por empleado | Neto vs quincena anterior · costo empresa · incidencias que bloquean la aprobación |
| 18 Configuración | Navegación por grupos + buscador de parámetros + selector de alcance (empresa / sucursal con herencia y "Restablecer") + filas etiqueta/descripción/control + barra de cambios sin guardar + auditoría por sección | Grupos: Organización, Ventas, Operación, Metas y alertas, Recursos humanos, Seguridad. Los parámetros legales de nómina son de solo lectura y se versionan |

Componentes nuevos derivados: `SettingsRow`, `ScopeSelector` (herencia empresa→sucursal), `UnsavedChangesBar`, `Sparkline`, `TrendChart`, `WaterfallChart`, `Heatmap`, `ParetoBars`, `DonutChart`, `InsightList`. Los gráficos viven en `src/ui/charts/` y reciben datos ya agregados por el servidor (endpoints de BI con agregación por periodo, sucursal y canal).

Nuevo componente de layout: `NavRail` (64 px, iconos con `aria-label`), alternativa colapsada del `AppShell` para vistas operativas.

### Tarea 14: Guardas de consistencia y limpieza

- [ ] Regla ESLint `no-restricted-imports`: `react-select` solo en `src/ui/**`; `components/Modal|Sidebar|CatalogTable|Select` prohibidos.
- [ ] Test `src/ui/no-legacy.contract.test.ts`: ningún `.tsx` fuera de `src/ui` contiene `<select`, `<table`, `.toFixed(` en JSX ni `px` en `grid-template-columns` de tablas.
- [ ] Borrar shims, `index.css` reducido a imports, CSS huérfanos.
- [ ] `npm run lint && npm test && npm run build && npm run test:e2e` verde.
- [ ] Commit `chore(ui): remove legacy components and enforce design system`.
