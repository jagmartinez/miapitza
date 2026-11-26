# Rediseño UI/UX — Hoja de ruta de implementación

**Spec:** `docs/superpowers/specs/2026-11-20-rediseno-ui-ux-design.md`
**Mockup aprobado (2026-11-20):** https://claude.ai/artifact/SXJwiavUbQi2uWHJ3Pyszb (18 vistas)

El rediseño se divide en cinco planes. Cada uno entrega software que funciona por sí solo y se puede revisar y fusionar por separado.

| Plan | Archivo | Entrega | Depende de | Tamaño |
|---|---|---|---|---|
| 01 | `2026-11-20-rediseno-ui-01-fundacion.md` | Design system `src/ui/`: tokens claro/oscuro, formato numérico, primitivas, `AppSelect`, `DataTable` paginada con columnas `fr`, `FullScreenModal`, `AppShell` + `NavRail`, adaptadores de los componentes viejos y guardas de lint | — | 12 tareas |
| 02 | `2026-11-20-rediseno-ui-02-configuracion.md` | Parámetros con alcance empresa → sucursal (backend + migración), API de parámetros tipados con auditoría y la pantalla Configuración (vista 18) | 01 | 7 tareas |
| 03 | `2026-11-20-rediseno-ui-03-bi.md` | Endpoints `/api/v1/bi/*`, gráficos `src/ui/charts/` y el Dashboard BI (vista 14) | 01, 02 (metas) | 9 tareas |
| 04 | `2026-11-20-rediseno-ui-04-migracion-modulos.md` | Migración de todas las pantallas al design system, módulo por módulo (vistas 3–13, 15–17) | 01 (02 y 03 solo para KPIs que leen metas) | 9 tareas |
| 05 | incluido al final de 04 | Retiro de componentes y CSS viejos; guardas en modo error | 04 | 1 tarea |

## Orden y paralelismo

1. **Plan 01 primero, completo.** Todo lo demás importa de `@/ui`.
2. Con 01 fusionado, **02 y 04 (módulos que no usan metas)** pueden avanzar en paralelo: tocan archivos distintos.
3. **03** empieza cuando 02 tenga fusionada la Tarea 2 (claves de metas en `SettingService`).
4. Dentro de 04, cada módulo es una rama y un PR. Orden sugerido: Catálogos → Inventario → Compras → Producción → Operación (Mesas, Cocina, POS, Caja) → RH → Admin y reportes.
5. Plan 05 (limpieza) solo cuando el contrato `no-legacy` del Plan 01 tenga la lista de excepciones vacía.

## Ramas y entrega

- Una rama por plan o por módulo, a partir de `main`: `feat/ui-01-fundacion`, `feat/ui-02-configuracion`, `feat/ui-03-bi`, `feat/ui-04-<modulo>`.
- Cada tarea termina en un commit; cada plan o módulo termina en un PR.
- La rama actual `feat/app-android` no se mezcla con este trabajo.

## Definición de terminado (aplica a todo PR)

- `npm run lint`, `npm run typecheck`, `npm test` y `npm run build` en `client/` en verde; `npm test` en `server/` si se tocó el servidor.
- `npm run test:e2e` en verde para el módulo tocado.
- Verificado en navegador en claro y oscuro, a 1440, 768 y 375 px, sin scroll horizontal de página.
- Toda tabla nueva tiene paginación y columnas en `fr`; todo número usa `@/ui/format`; todo select es `AppSelect`.
- Las tarjetas KPI cumplen la regla del spec: información que lleva a una decisión, nunca conteos triviales.

## Decisiones que el spec dejó abiertas (resueltas aquí)

| Tema | Decisión |
|---|---|
| Tests de componentes | Se agregan `jsdom` y `@testing-library/react`; los archivos `*.test.tsx` declaran `// @vitest-environment jsdom`. Los `*.contract.test.ts` existentes siguen igual. |
| Alias de importación | `@/ui` → `client/src/ui` (Vite, Vitest y `tsconfig`). |
| Parámetros por sucursal | Nueva columna `branchId` opcional en `Setting` (único `companyId, branchId, name`) y tabla `SettingAudit`. Ver Plan 02. |
| Gastos operativos para el puente de utilidad (BI) | No existen como dato contable: se usan los egresos de caja del periodo + el parámetro nuevo `finance.fixedMonthlyExpenses` prorrateado por días. |
| Food cost teórico vs real | Teórico = unidades vendidas × costo estimado de receta (mismo cálculo del reporte de rentabilidad). Real = costo de las salidas de inventario por consumo de venta + mermas del periodo. |
| Gráficos | SVG propio en `src/ui/charts/` (sin librería nueva). `recharts` deja de usarse al terminar el Plan 04 y se elimina en el 05. |
