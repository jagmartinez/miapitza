# Rediseño UI — Plan 03: Dashboard BI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El Dashboard BI del mockup (vista 14): filtros globales, KPIs contra metas, tendencia con comparación, hallazgos ordenados por impacto en C$, puente de la venta a la utilidad operativa, mezcla por canal, mapa de calor día × hora, Pareto de margen y comparativo de sucursales.

**Architecture:** Un servicio nuevo `bi.service.ts` en el servidor calcula todas las agregaciones en la zona horaria de la empresa y las expone en `/api/v1/bi/*`; el cliente no agrega datos crudos. Gráficos en `client/src/ui/charts/` como componentes SVG/HTML puros cuya geometría vive en funciones testeables. Las metas salen de `SettingsScopeService` (Plan 02).

**Tech Stack:** Express + Prisma + Jest; React + `@/ui` + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-rediseno-ui-ux-design.md` · mockup vista 14 · hoja de ruta `2026-11-20-rediseno-ui-00-hoja-de-ruta.md`

## Global Constraints

- Requiere Plan 01 completo y Plan 02 Tarea 2 (claves `goal.*` y `finance.fixedMonthlyExpenses`).
- Todas las fechas se agrupan en la zona horaria de la empresa (`SettingService` `timezone`, default `America/Managua`), igual que `ReportService` hoy.
- Ventas = órdenes con estado pagado/cerrado según el mismo criterio que usa `ReportService.getSalesReport`; se excluyen anuladas y líneas con `voidedQuantity`. Notas de crédito fiscales restan venta (como en `getDashboardStats`).
- Definiciones (en el código como comentario junto a cada cálculo):
  - Venta neta = Σ `Order.total` − notas de crédito. Venta bruta = venta neta + Σ `Order.discount`.
  - Costo teórico = Σ unidades vendidas × costo estimado de receta (mismo cálculo de `ReportService.getProfitabilityReport`).
  - Costo real = costo de las salidas de inventario por consumo de venta + mermas registradas en el periodo.
  - Comisiones de canal = Σ `Order.channelCommission`.
  - Costo de personal = Σ (devengado + aportes patronales) de las corridas de nómina cuyo periodo se cruza con el rango, prorrateado por días.
  - Gastos operativos = egresos manuales de caja del periodo + `finance.fixedMonthlyExpenses` prorrateado por días.
  - Utilidad operativa = venta neta − costo real − personal − gastos operativos − comisiones.
- Periodos: `today | 7d | 30d | 12m | custom`; comparación `previous` (mismo largo inmediatamente anterior) o `year` (mismo rango un año antes).
- Respuestas en `number` (no strings); el cliente formatea con `@/ui/format`.
- Solo `SUPERADMIN` y `ADMIN` (como los reportes actuales) y respetando el alcance de sucursal del usuario (`ReportController.resolveBranchScope`).

## Review Focus

1. Periodo sin ventas (sucursal nueva) → todos los KPIs en 0, gráficos vacíos con mensaje, sin divisiones por cero ni `NaN` en porcentajes.
2. Rango que cruza la medianoche local (cierre a las 00:30) → la venta cae en el día local correcto.
3. Comparación `year` sobre 29 de febrero → no lanza error; usa 28/02.
4. Usuario con alcance de una sola sucursal pide `branchIds` de otra → se ignoran o 403, nunca se mezclan datos.
5. Sucursales con metas personalizadas → el semáforo del comparativo usa la meta de cada sucursal, no la de empresa.

---

### Task 1: Rango y filtros

**Files:** Create `server/src/services/bi/bi-range.ts`; Test `server/src/tests/unit/bi-range.test.ts`.

**Interfaces (Produces):**
```ts
export type BiPeriod = 'today' | '7d' | '30d' | '12m' | 'custom';
export type BiCompare = 'previous' | 'year';
export type BiGranularity = 'hour' | 'day' | 'month';
export interface BiQuery { companyId: number; branchIds: number[]; period: BiPeriod; from?: string; to?: string; compare: BiCompare }
export interface BiRange { from: Date; to: Date; cmpFrom: Date; cmpTo: Date; granularity: BiGranularity; timezone: string; days: number }
export function resolveBiRange(q: BiQuery, now: Date, timezone: string): BiRange;
export function bucketKey(date: Date, granularity: BiGranularity, timezone: string): string;   // '2026-11-20T13' | '2026-11-20' | '2026-11'
export function buckets(range: BiRange): string[];
```
- Granularidad: `today` → hour, `7d`/`30d` → day, `12m` → month, `custom` → day si ≤ 62 días, si no month.
- [ ] Step 1: Tests: `today` a las 2026-11-20T02:00Z en Managua ⇒ `from` 2026-11-19T06:00Z; `30d` ⇒ 30 buckets diarios; `compare:'previous'` ⇒ `cmpTo === from`; `compare:'year'` con `from` 2028-02-29 ⇒ `cmpFrom` 2027-02-28; `custom` de 90 días ⇒ granularidad month.
- [ ] Step 2: FAIL. Step 3: Implementar (reutilizar utilidades de `server/src/utils/timezone`). Step 4: PASS. Step 5: Commit `feat(bi): range resolution`.

### Task 2: KPIs del resumen

**Files:** Create `server/src/services/bi/bi-summary.service.ts`; Test `server/src/tests/unit/bi-summary.service.test.ts`.

**Interfaces (Produces):**
```ts
export interface Money { current: number; previous: number; deltaPct: number | null }   // null si previous = 0
export interface BiSummary {
  netSales: Money; grossSales: Money; discounts: Money; orders: Money; avgTicket: Money;
  grossMarginPct: Money; foodCostRealPct: Money; foodCostTheoreticalPct: Money; foodCostGapAmount: number;
  laborCostPct: Money; operatingProfit: Money; operatingMarginPct: Money;
  goals: { monthlySales: number; periodSales: number; avgTicket: number; foodCostPct: number; foodCostGapPts: number;
           grossMarginPct: number; laborCostMaxPct: number; operatingMarginPct: number };
  spark: Record<'netSales' | 'grossMarginPct' | 'foodCostGapPts' | 'avgTicket' | 'laborCostPct' | 'operatingProfit', number[]>;
}
export function getBiSummary(q: BiQuery): Promise<BiSummary>;
```
- `goals.periodSales` = `monthlySales` × días del rango / días del mes (suma por sucursal si hay varias).
- [ ] Step 1: Tests con prisma simulado: 2 órdenes (1,000.00 y 500.00, descuento 50.00) y nota de crédito 100.00 ⇒ `netSales.current = 1400`, `grossSales.current = 1450`, `avgTicket.current = 700`; `previous = 0` ⇒ `deltaPct = null`; costo teórico 420 y real 480 ⇒ `foodCostGapAmount = 60`; sin órdenes ⇒ todos los porcentajes 0.
- [ ] Step 2–4. Step 5: Commit `feat(bi): summary KPIs`.

### Task 3: Tendencia

**Files:** Create `server/src/services/bi/bi-trend.service.ts`; Test `bi-trend.service.test.ts`.

**Interfaces (Produces):** `getBiTrend(q: BiQuery, metric: 'netSales' | 'grossMargin' | 'orders' | 'avgTicket'): Promise<{ buckets: string[]; current: number[]; previous: number[]; goal: number | null }>` — `previous[i]` alineado por posición con `current[i]`; `goal` por bucket (venta: meta mensual prorrateada al bucket; ticket: meta fija; órdenes: `null`).
- [ ] Step 1: Tests: buckets sin ventas valen 0 (no se omiten); `avgTicket` en bucket sin órdenes = 0; largo de `previous` = largo de `current`. Step 2–5 (commit `feat(bi): trend series`).

### Task 4: Puente de utilidad y mezcla por canal

**Files:** Create `server/src/services/bi/bi-pnl.service.ts`; Test `bi-pnl.service.test.ts`.

**Interfaces (Produces):**
```ts
export interface BridgeStep { key: 'gross'|'discounts'|'net'|'cogs'|'grossMargin'|'labor'|'opex'|'commissions'|'operating'; label: string; amount: number; kind: 'total'|'negative' }
export function getBiBridge(q: BiQuery): Promise<BridgeStep[]>;   // 9 pasos en el orden del mockup
export function getBiChannels(q: BiQuery): Promise<{ channel: string; label: string; netSales: number; sharePct: number; netMarginPct: number; avgTicket: number }[]>;
```
- `netMarginPct` por canal = (venta neta − costo real proporcional − comisión del canal) / venta neta.
- [ ] Step 1: Tests: la suma de pasos negativos + `operating` reconstruye `net`; `sharePct` suma 100 ± 0.01; canal sin ventas no aparece. Step 2–5 (commit `feat(bi): pnl bridge and channel mix`).

### Task 5: Mapa de calor y Pareto

**Files:** Create `server/src/services/bi/bi-patterns.service.ts`; Test `bi-patterns.service.test.ts`.

**Interfaces (Produces):**
- `getBiHeatmap(q: BiQuery): Promise<{ hours: number[]; days: { weekday: 1|2|3|4|5|6|7; label: string; values: number[] }[]; peak: { weekday: number; hour: number }; valley: { weekday: number; hour: number } }>` — valor = venta promedio por ocurrencia de ese día de la semana en el rango; horas = horario de operación con ventas (mín. 11–22).
- `getBiPareto(q: BiQuery, limit = 10): Promise<{ items: { menuItemId: number; name: string; margin: number; cumulativePct: number }[]; itemsFor80Pct: number; totalItems: number }>`.
- [ ] Step 1: Tests: dos lunes en el rango con 100 y 300 a las 13 h ⇒ lunes 13 h = 200; `cumulativePct` es no decreciente y el último ≤ 100; `itemsFor80Pct` cuenta sobre todo el menú, no solo el top. Step 2–5 (commit `feat(bi): heatmap and pareto`).

### Task 6: Comparativo de sucursales y hallazgos

**Files:** Create `server/src/services/bi/bi-insights.service.ts`; Test `bi-insights.service.test.ts`.

**Interfaces (Produces):**
```ts
export interface BranchRow { branchId: number; name: string; netSales: number; deltaPct: number | null; spark: number[]; avgTicket: number;
  foodCostPct: number; laborCostPct: number; operatingMarginPct: number; salesPerSqm: number | null;
  status: { foodCost: 'ok'|'warn'|'bad'; labor: 'ok'|'warn'|'bad' } }
export interface Insight { id: string; kind: 'cost'|'branch'|'opportunity'|'channel'; severity: 'danger'|'warning'|'success';
  impactAmount: number; message: string; action: { label: string; route: string } }
export function getBiBranches(q: BiQuery): Promise<BranchRow[]>;
export function getBiInsights(q: BiQuery): Promise<Insight[]>;   // ordenados por |impactAmount| desc, máx. 5
```
- Semáforo con metas por sucursal: `ok` ≤ meta, `warn` ≤ meta + 2 pts, `bad` > meta + 2 pts.
- Reglas de hallazgos (cada una es una función pura con su test):
  1. **Costo:** brecha real − teórico > `goal.foodCostGapPts` ⇒ impacto = brecha × venta neta; mensaje nombra el insumo con mayor diferencia de consumo real vs teórico.
  2. **Sucursal:** sucursal con `deltaPct` < −2 % ⇒ impacto = venta perdida vs periodo comparado.
  3. **Oportunidad:** franja día × hora con venta < 40 % del promedio de su día y personal programado ⇒ impacto estimado = (promedio del día − venta de la franja) × ocurrencias × margen bruto.
  4. **Canal:** participación de delivery sube > 2 pts ⇒ impacto = Δ participación × venta × (margen salón − margen delivery).
- `salesPerSqm`: `null` hasta que exista el dato de metros cuadrados en `Branch` (no se agrega en este plan).
- [ ] Step 1: Tests por regla con datos mínimos; sin datos ⇒ arreglo vacío; orden por impacto. Step 2–5 (commit `feat(bi): branch comparison and insights`).

### Task 7: Rutas BI

**Files:** Create `server/src/routes/bi.routes.ts`, `server/src/controllers/bi.controller.ts`; Modify `server/src/routes/v1.router.ts`; Test `server/src/tests/unit/bi.routes.test.ts`.

**Interfaces (Produces):** `GET /api/v1/bi/summary | trend?metric= | bridge | channels | heatmap | pareto | branches | insights`, query común `period, from, to, compare, branchIds=1,2`. Caché en memoria 60 s por `(companyId, ruta, query normalizada)`.
- [ ] Step 1: Tests: rol cajero ⇒ 403; `branchIds` fuera del alcance del usuario ⇒ 403; `period` inválido ⇒ 400; segunda llamada idéntica dentro de 60 s no vuelve a consultar Prisma. Step 2–5 (commit `feat(bi): routes`).

### Task 8: Gráficos en `@/ui/charts`

**Files:** Create `client/src/ui/charts/types.ts` (espejo de `BridgeStep` e `Insight` del servidor; `services/bi.ts` de la Tarea 9 los importa de aquí), `client/src/ui/charts/geometry.ts`, `Sparkline.tsx`, `TrendChart.tsx`, `WaterfallChart.tsx`, `Heatmap.tsx`, `ParetoBars.tsx`, `DonutChart.tsx`, `InsightList.tsx`, `charts.css`, `charts/geometry.test.ts`, `charts/charts.test.tsx`.

**Interfaces (Produces):**
```ts
export function linePath(values: number[], w: number, h: number, max: number): string;           // 'M0 h L… '
export function areaPath(values: number[], w: number, h: number, max: number): string;
export function sparkPoints(values: number[], w: number, h: number): string;                     // 'x,y x,y'
export function niceMax(v: number): number;                                                       // 1, 2, 2.5, 5 × 10^n
export function waterfallBars(steps: { amount: number; kind: 'total'|'negative' }[]): { bottomPct: number; heightPct: number }[];
export function donutSegments(shares: number[]): { dasharray: string; dashoffset: number }[];
export function Sparkline(p: { values: number[]; tone?: Tone; width?: number; height?: number }): JSX.Element;
export function TrendChart(p: { buckets: string[]; current: number[]; previous?: number[]; goal?: number | null; format(v: number): string; ariaLabel: string; previousLabel: string }): JSX.Element;
export function WaterfallChart(p: { steps: BridgeStep[] }): JSX.Element;
export function Heatmap(p: { rows: { label: string; values: number[] }[]; columns: string[]; format(v: number): string; caption?: ReactNode }): JSX.Element;
export function ParetoBars(p: { items: { name: string; value: number; cumulativePct: number }[]; format(v: number): string }): JSX.Element;
export function DonutChart(p: { segments: { label: string; share: number; tone: string }[]; ariaLabel: string }): JSX.Element;
export function InsightList(p: { items: Insight[] }): JSX.Element;
```
- Colores solo por tokens (`--ui-primary`, `--ui-warning`, `--ui-danger`, `--ui-success`, `--ui-text-muted` para la serie comparada). Cada gráfico tiene `role="img"` + `aria-label` y una tabla oculta para lectores de pantalla (`.ui-visually-hidden`) con los mismos datos.
- [ ] Step 1: Tests de geometría: `niceMax(13650) === 15000`; `linePath([0, 10], 100, 50, 10) === 'M0 50 L100 0'`; `waterfallBars` del ejemplo del mockup ⇒ el paso `operating` arranca en 0; `donutSegments([61,22,17])[1].dashoffset === -61`; arreglos vacíos ⇒ cadena vacía, sin `NaN`. Tests de render: `TrendChart` sin datos muestra "Sin datos en el periodo".
- [ ] Step 2–4. Step 5: Commit `feat(ui): chart components`.

### Task 9: Página Dashboard

**Files:** Create `client/src/pages/dashboard/BiDashboard.tsx`, `client/src/pages/dashboard/useBiFilters.ts`, `client/src/services/bi.ts`, `bi-dashboard.test.tsx`; Modify `client/src/App.tsx` (`/dashboard` → `BiDashboard`), `navConfig.ts`.

**Interfaces (Produces):** `useBiFilters(): { period; compare; branchIds; set(partial) }` sincronizado con la URL (`?period=30d&compare=previous&branches=1,2`) para que una vista se pueda compartir; "Guardar vista" persiste en `localStorage('bi.views')` (try/catch).
- Composición del mockup vista 14: barra de filtros fija; 6 `StatCard` con `Sparkline` y avance a meta; `TrendChart` con selector de métrica; `InsightList`; `WaterfallChart`; `DonutChart` + leyenda de canal; `Heatmap`; `ParetoBars`; `DataTable` de sucursales con semáforo.
- Pestaña secundaria **"Operación en vivo"** en la misma página: conserva lo útil del dashboard actual (mesas ocupadas, cola de cocina, reservas de hoy, alertas de stock) con el formato "Requiere atención" del primer mockup.
- Cada sección carga en paralelo con su propio `Skeleton` y error recuperable (`LoadErrorState`); una sección que falla no tumba la página.
- [ ] Step 1: Tests: cambiar periodo actualiza la URL y vuelve a pedir todas las secciones; sección con error muestra "Reintentar" y las demás siguen visibles; `deltaPct: null` se muestra como "Sin comparación".
- [ ] Step 2–4. Verificar en navegador con la base de desarrollo contra el mockup (claro/oscuro, 1440/768/375).
- [ ] Step 5: Commit `feat(bi): business intelligence dashboard`; PR `feat/ui-03-bi`.
