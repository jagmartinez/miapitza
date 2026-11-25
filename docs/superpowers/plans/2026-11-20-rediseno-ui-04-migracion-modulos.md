# Rediseño UI — Plan 04: Migración de módulos (incluye Plan 05: limpieza)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Llevar cada pantalla del cliente al design system `@/ui` con el layout de su mockup, y al final retirar componentes, CSS y dependencias viejas.

**Architecture:** Un módulo por tarea, una rama y un PR por módulo. Todas las tareas siguen la misma receta (abajo); cada tarea solo agrega lo propio del módulo: pantallas, tarjetas KPI con su fuente de datos y pruebas de aceptación. El contrato `no-legacy` del Plan 01 garantiza el avance: cada módulo saca sus archivos de `legacy-allowlist.json`.

**Tech Stack:** React + `@/ui` + Vitest + Playwright; Express/Jest solo donde una tarjeta necesita un dato nuevo.

**Spec:** `docs/superpowers/specs/2026-11-20-rediseno-ui-ux-design.md` · mockup vistas 3–13 y 15–17 · hoja de ruta `2026-11-20-rediseno-ui-00-hoja-de-ruta.md`

## Global Constraints

- Requiere Plan 01 fusionado. Las tarjetas que comparan contra metas requieren Plan 02 (`useGoals`).
- No se cambian contratos de API ni reglas transaccionales; si un KPI necesita un dato que el servidor no entrega, se agrega un endpoint de solo lectura con su test, o la tarjeta no se muestra (nunca datos inventados en el cliente).
- Regla de tarjetas: valor + contexto + acción opcional; sin conteos triviales. Si un módulo no tiene un KPI accionable, no lleva tarjetas.
- Formularios de alta/edición/detalle → `FullScreenModal`; confirmaciones → `ConfirmDialog`; filtros rápidos → `Drawer` o barra de filtros.
- Las reglas de layout de RH en memoria del proyecto se mantienen: sin tarjetas anidadas, tabla independiente, filtros sin caja.
- Verificación en navegador obligatoria por módulo (claro/oscuro, 1440/768/375 px) con capturas en el PR.

## Review Focus

1. Pantallas con paginación de servidor (Inventario, Kardex, Facturas, Órdenes) → el cambio de página/tamaño sigue pidiendo al servidor con los mismos parámetros que hoy.
2. Formularios largos convertidos a `FullScreenModal` → no se pierde ningún campo ni validación existente (comparar el payload enviado antes y después en el test).
3. Flujos de dinero (POS, pagos, caja) → mismos montos y redondeos; los tests de contrato existentes (`pos-money-format`, `cash-shift-*`, `PaymentModal.contract`) siguen verdes sin tocar sus aserciones de negocio.
4. Vistas táctiles (POS, Cocina, Mesas) → objetivos ≥ 44 px y uso completo con teclado.
5. Vistas con permisos por rol → lo que un rol no puede ver sigue oculto (botones y columnas).

## Receta común (se repite en cada tarea)

- [ ] **R1. Inventario del módulo:** listar sus archivos `.tsx/.css` y sus entradas en `legacy-allowlist.json`.
- [ ] **R2. Test de aceptación primero:** por pantalla, un test `*.test.tsx` que verifica: usa `PageHeader`; tablas son `DataTable` con paginación y columnas numéricas alineadas a la derecha con formato `1,234.50`; los formularios abren `FullScreenModal`; los selects son `AppSelect`. Correrlo → FAIL.
- [ ] **R3. Migrar** la pantalla: `PageHeader` + (tarjetas) + barra de filtros + `DataTable` + `FullScreenModal` con `FormSection`/`FormGrid`; borrar estilos locales que ya cubre `@/ui`; mover reglas propias que queden a un `*.module.css` del módulo.
- [ ] **R4. Sacar** los archivos del módulo de `legacy-allowlist.json`.
- [ ] **R5. Verificar:** `npm run lint && npm run typecheck && npm test && npm run build`; `npx playwright test <specs del módulo>`; navegador claro/oscuro en 3 anchos; comparar contra el mockup.
- [ ] **R6. Commit** `feat(ui): migrate <módulo> to design system` y PR `feat/ui-04-<módulo>`.

---

### Task 1: Catálogos y administración básica

**Pantallas:** `Categories`, `Brands`, `UnitsOfMeasure`, `ProductUnitSettings`, `Suppliers`, `Branches`, `Companies`, `Warehouses`, `CashRegisters`, `Users`, `RolesPermissions`.
- Sin tarjetas KPI (no hay decisión que mostrar); excepción `Suppliers`: tarjeta "Saldo por pagar vencido (C$)" con los 3 proveedores de mayor saldo, si el endpoint de cuentas por pagar lo entrega; si no, sin tarjeta.
- `RolesPermissions`: matriz de permisos con el mismo patrón visual del Perfil (vista 16, pestaña Seguridad).
- Aceptación específica: `Users` mantiene los estados del contrato `users-status.contract.test.ts`.
- Archivos de estilo a eliminar al terminar: `Categories.css`, `Suppliers.css`, `Branches.css`, `Companies.css`, `CashRegisters.css`, `UnitsOfMeasure.css`, `ProductUnitSettings.css`, `Users.css`, `RolesPermissions.css`.

### Task 2: Inventario (mockups 3–4)

**Pantallas:** `Inventory`, `Kardex`, `WasteReport`, `CostReport`, `LowStockAlert`.
- Tarjetas de `Inventory`: **Valor del inventario (C$)** con distribución por bodega · **Reposición requerida (C$)** = Σ (2 × mínimo − existencia) × costo de los productos bajo mínimo, con productos agotados y acción "Generar orden de compra sugerida" (usa `auto-purchase-order.service`) · **Concentración del capital** = % del valor en los 3 productos principales.
- Columnas de `Inventory` (exactas del mockup): Código `minmax(5.5rem,.8fr)` · Producto `2.4fr` · Categoría `1.2fr` · Bodega `1.1fr` · Existencia `1fr qty` · Unidad `.6fr` · Costo (C$) `1fr money` · Valor (C$) `1.2fr money total` · Estado `1fr status` · acciones `48px`.
- Aceptación específica: test de la fórmula de reposición con 3 productos (uno agotado, uno bajo mínimo, uno sano).

### Task 3: Compras (mockup 5)

**Pantallas:** `PurchaseOrders`, `PurchaseOrderForm`, `PurchaseOrderImport`, `InvoiceHistory`, `BankReconciliation`.
- `PurchaseOrderForm` pasa a `FullScreenModal` con pestañas "Datos y productos / Recepción / Adjuntos / Historial", secciones numeradas, tabla de líneas editable (`NumberInput` en cantidad y costo), resumen lateral (subtotal, descuento, IVA, total, equivalente en USD con el tipo de cambio de Configuración) y `dirty` para confirmar descarte.
- Tarjetas de `PurchaseOrders`: **Comprometido sin recibir (C$)** con órdenes vencidas · **Variación de precio vs última compra** (top 3 insumos con mayor alza).
- Aceptación específica: el payload que envía el formulario es idéntico al actual para una orden de 3 líneas (test con snapshot del body).

### Task 4: Menú, recetas y producción (mockups 11–13)

**Pantallas:** `Menu`, `ProductionRecipes`, `ProductionOrders`, `ProductionDashboard`.
- `Menu`: tabla con Precio, Costo, Food cost, Margen, Vendidos (30 días) y clasificación popularidad × margen (Estrella, Caballo de batalla, Rompecabezas, Perro); panel lateral de costeo con "precio para llegar a la meta" (`goal.foodCostPct`). Datos: `GET /reports/profitability` existente; si no trae unidades vendidas por plato, agregar `GET /reports/menu-engineering?days=30` (servidor, con test).
- Tarjetas de `Menu`: margen ponderado vs meta con brecha en C$ · platos sobre la meta de food cost · platos sin receta.
- `ProductionRecipes`: maestro-detalle; aviso de variación del costo unitario contra la versión anterior y su insumo causante; peso de cada insumo en el costo; "Se usa en".
- `ProductionOrders`: columnas de costo estimado, real y variación; tarjetas sobrecosto del mes, plan bloqueado por insumos (acción crear compra), rendimiento real vs estándar.
- Aceptación específica: clasificación del menú con 4 platos de ejemplo cae en los 4 cuadrantes; `production-recipes-detail.contract.test.ts` verde.

### Task 5: Salón — Mesas, reservas y órdenes (mockup 7)

**Pantallas:** `Tables`, `Reservations`, `Orders`, `TableMap`, `TableOrdersModal`, `TableOperationModal`, `TableSelectionModal`, `TableGroupModal`.
- `Tables`: plano por zona (segmentado Todas/zonas), tarjeta de mesa con estado, minutos y consumo; panel de detalle con líneas y acciones (Agregar productos, Pre-cuenta, Cobrar, Dividir, Mover, Unir).
- Tarjetas: consumo abierto y pre-cuentas sin cobrar · mesas sobre el tiempo objetivo · próxima reserva y mesa que debe liberarse.
- Aceptación específica: `table-operations.contract.test.ts`, `TableMap.test.ts` verdes; las acciones respetan `utils/tableAccess.ts`.

### Task 6: Cocina y POS (mockups 8–9)

**Pantallas:** `Kitchen`, `KitchenLineVoidModal`, `KitchenNotificationBell`, `POS`, `POSProductCard`, `OrderCart`, `PaymentModal`, `NumericKeypad`, `TicketPrintModal`, `Catering`, `CateringServices`, `Promotions`, `PedidosYaIntegration`.
- `Kitchen`: pantalla completa, oscuro por defecto (respeta el tema si el usuario lo fijó), columnas Recibidas / En preparación / Listas, semáforo por minutos desde Configuración (`kds_warning_minutes`, `kds_urgent_minutes`, `kitchen.targetMinutes`), indicadores de tiempo promedio vs meta, atrasadas e insumo agotado.
- `POS`: catálogo táctil por categoría, aviso de existencia en la tarjeta del producto, orden lateral fija, tipo de orden segmentado, botones de 52 px para Enviar/Cobrar.
- Aceptación específica: `pos-money-format`, `pos-fiscal-customer`, `PaymentModal.contract`, `hardware-failure.contract` verdes; Playwright del flujo vender → cobrar → imprimir.

### Task 7: Caja (mockup 10)

**Pantallas:** `CashShift` (+ reporte de turno).
- Conteo por denominación editable, conciliación esperado vs contado con faltante/sobrante y bloqueo de cierre según `cash_reconciliation_tolerance` y `cash.closeWithDifferenceNeedsSupervisor`, ventas por medio de pago, movimientos manuales paginados.
- Aceptación específica: `cash-shift-report`, `cash-shift-responsive` verdes; test: diferencia −350 con tolerancia 50 ⇒ "Cerrar turno" exige supervisor.

### Task 8: Recursos humanos (mockup 17)

**Pantallas:** todas las de `pages/hr/` y `components/hr/` (incluye `HrWorkspace`, `MyHrNav`, `TimeClock`, `Biometrics`).
- Unificar los 20 CSS de `pages/hr/*.css` y `pages/hr/layouts/*.css` en el design system; `HrModalFormShell` → `FullScreenModal`; los seis `*StatusPill` → `StatusBadge` con `statusTone.ts`.
- `PayrollManagement`: stepper de estado de la corrida, tarjetas neto vs quincena anterior, costo empresa e incidencias bloqueantes (con "Resolver"), tabla por empleado con totales.
- Aceptación específica: todos los `*.contract.test.ts` de `components/hr` y `pages/hr` verdes (actualizar solo aserciones de clases CSS, nunca de reglas de negocio; listar cada aserción cambiada en el PR).

### Task 9: Reportes, perfil y pantallas generales (mockups 15–16)

**Pantallas:** `Reports`, `Profile`, `ChangePassword`, `Login`, `NotFound`, `ErrorBoundary`, `LoadErrorState`.
- `Reports`: catálogo lateral por grupo + visor con lectura rápida en texto, gráfico (`@/ui/charts`) y `DataTable` con totales y comparación; exportación Excel/PDF existente.
- `Profile`: encabezado (roles, sucursales, completitud), pestañas Resumen (aprobaciones pendientes con montos, desempeño, actividad, mi nómina, vacaciones, horario, datos laborales), Seguridad y accesos (salud de la cuenta, sesiones, historial de accesos, matriz de permisos), Preferencias (tema, densidad, filas por página, página de inicio, sucursal, formato), Notificaciones (matriz evento × canal). Datos: endpoints existentes `my-stats`, `my-activity`, `my-performance`, `my-password-info` y los de RH de autoservicio; las preferencias de densidad y filas por página se guardan por usuario (endpoint nuevo `PUT /users/me/preferences` con test).
- Aceptación específica: `identityUx.contract.test.ts` verde; cambiar "Filas por página" a 50 hace que un `DataTable` nuevo arranque en 50.

### Task 10 (Plan 05): Limpieza y guardas en modo error

**Files:** borrar `components/Modal.tsx/.css`, `Sidebar.tsx/.css`, `CatalogTable.tsx`, `CatalogView.css`, `Select.tsx/.css`, `Pagination.tsx`, `Card.tsx/.css`, `Button.tsx/.css`, `Input.tsx/.css`, `utils/reactSelectTheme.ts`, `components/hr/HrReactSelect.tsx`, `pages/Settings.tsx` legacy, `styles/responsive.css` y los CSS de página vacíos; reducir `index.css` a imports; quitar `recharts` de `package.json`.
- [ ] Step 1: `legacy-allowlist.json` vacío y el contrato `no-legacy` en verde.
- [ ] Step 2: ESLint `no-restricted-imports` de `warn` a `error`; agregar regla que prohíba importar archivos borrados.
- [ ] Step 3: `grep -r "var(--color-" src` → solo en `ui/tokens.css` (alias); eliminar los alias si no quedan usos.
- [ ] Step 4: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e` → PASS; tamaño del bundle comparado con `main` en el PR.
- [ ] Step 5: Commit `chore(ui): remove legacy components and enforce design system`; PR `feat/ui-05-limpieza`.
