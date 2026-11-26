# App Android — Fase 5b: Inventario (conteo ciego + aprobación) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BODEGA y CHEF entran con su PIN en la tablet de servicio, cuentan una bodega a ciegas (sin ver la existencia del sistema), con guardado continuo que tolera cortes de red, y envían el conteo a revisión. Un ADMIN en la web ve las diferencias en cantidad y costo, pide reconteo de productos o aprueba, y la aprobación genera los ajustes de stock en una sola transacción.

**Architecture:**
- **Servidor:** módulo nuevo `/api/v1/inventory-counts` con dos modelos (`InventoryCountSheet`, `InventoryCountLine`).
  - Endpoints del contador gateados por el permiso nuevo `inventory.count`. Nunca devuelven `expectedAtCount` ni existencias.
  - Endpoints de revisión para SUPERADMIN/ADMIN.
  - La aprobación reutiliza la lógica de conteo físico: se extrae de `InventoryMovementService.physicalCount` un helper transaccional que posta el ajuste (ADJUSTMENT IN/OUT, FIFO/promedio, costo, auditoría). `physicalCount` y la aprobación lo llaman.
- **App:** módulo `features/inventory` de carga diferida. Usa la capa de datos del mesero (`loadWaiterData`: cola offline Dexie + `api.mutate`). Se entra por la ruta `inventory` de `WaiterHome` (botón "Inventario" en el header de mesas), o directamente cuando el usuario no tiene `tables.map.view`.
- **Web:** una página de revisión `/inventario/conteos`.

**Tech Stack:** Express + Prisma + MySQL (servidor), React 18 + Capacitor 6 + Dexie (app), React + Vite (web).

**Spec:** `docs/superpowers/specs/2026-11-19-app-android-design.md` §7.3.4 (más §7.1 permisos por módulo, §8 offline, §9.1 lenguaje visual). Convenciones y lecciones: `docs/superpowers/plans/CHECKPOINT-app-android.md`. Leer la sección relevante antes de cada tarea.

## Global Constraints

**Datos y servidor**
- `InventoryCountSheet { id, companyId, branchId Int? (null en bodega CENTRAL), warehouseId, status DRAFT|SUBMITTED|APPROVED|REJECTED, scopeCategoryIds Json? (null = Todo), openWarehouseId Int? @unique, startedById, startedAt, submittedById?, submittedAt?, returnedAt?, returnNote? VarChar(500), approvedById?, approvedAt?, rejectedById?, rejectedAt?, rejectReason? VarChar(500) }`.
  - `openWarehouseId = warehouseId` mientras el estado es DRAFT o SUBMITTED, y NULL en APPROVED/REJECTED. El índice único garantiza **una sola hoja abierta por bodega**, también ante carreras.
- `InventoryCountLine { id, sheetId, productId, categoryId?, unit VarChar(20)?, countedQuantity Decimal(18,6)?, countedBaseQuantity Decimal(18,6)?, expectedAtCount Decimal(18,6)?, clientCountedAt DateTime?, countedById?, countedAt?, notCounted Boolean @default(false), recountRequested Boolean @default(false), previousCountedBase Decimal(18,6)?, movementId Int?, adjustmentValue Decimal(18,2)? }`. `adjustmentValue` = Δ con signo × `unitCost` del motor, guardado al aprobar. Es la fuente del "resultado" de las hojas aprobadas: no se recalcula con el costo del día con `@@unique([sheetId, productId])`.
  - Las líneas se crean al iniciar la hoja (una por producto del alcance), con `countedQuantity` null.
- **Productos de una bodega:** productos `active` de la empresa con fila `Stock` en esa bodega, cuya categoría no tenga `showInInventory = false`. Los productos sin categoría se agrupan como "Sin categoría" (`categoryId` null).
- **Ciego:** ningún endpoint del contador (lista, detalle de hoja, bodegas, categorías, guardar línea, enviar) devuelve `expectedAtCount`, `previousCountedBase`, existencias ni costos. Los DTO se arman por lista blanca.
  - "Resultado" en Recientes solo muestra diferencias y valor en hojas APPROVED. En SUBMITTED muestra "—", y en una devuelta muestra "N a recontar".
- `expectedAtCount` = `Stock.quantity` (base) de la bodega y el producto, leído **cuando el servidor recibe el guardado de esa línea**. Un reconteo lo vuelve a capturar.
- **Ajuste por línea al aprobar** = `countedBaseQuantity − expectedAtCount`, aplicado sobre la existencia actual. No es "fijar la existencia al valor contado": las ventas posteriores al conteo se respetan. Las líneas `notCounted` no se ajustan, y una diferencia de |Δ| ≤ 1e-9 no genera movimiento.
- **Valor de la diferencia (revisión):** Δ × costo unitario efectivo (`resolveEffectiveUnitCost(currentAverageCost, cost, flags)`, con respaldo `lastPurchaseCost`), redondeado a 2 decimales. Es solo informativo: el costo real lo pone el motor al postear.
- Permiso nuevo `inventory.count` para SUPERADMIN, ADMIN, BODEGA y CHEF. La revisión (lista de revisión, detalle con diferencias, reconteo, aprobar, rechazar) usa `requireRole('SUPERADMIN','ADMIN')` más `assertBranchAccess`, sin permiso nuevo.
- `PIN_ROLES` ya incluye BODEGA y CHEF (`server/src/constants/roles.ts:54`). No se cambia: se fija con una prueba de contrato.
- Errores tipados `InventoryCountError(code)`:
  - `INVENTORY_COUNT_NOT_FOUND` 404;
  - `INVENTORY_COUNT_WAREHOUSE_BUSY` 409;
  - `INVENTORY_COUNT_NOT_EDITABLE` 409;
  - `INVENTORY_COUNT_INVALID` 400;
  - `INVENTORY_COUNT_UNIT_INVALID` 400;
  - `INVENTORY_COUNT_EMPTY` 409 (enviar sin ningún producto contado);
  - `INVENTORY_COUNT_RECOUNT_PENDING` 409;
  - `INVENTORY_COUNT_COST_MISSING` 409 (`details.products: string[]`).
- Aprobar exige `requireIdempotencyKey` (importar el que ya exporta `inventory-movement.routes.ts`). Es una sola `prisma.$transaction(fn, { timeout: 120_000, maxWait: 10_000 })`.
- Migración `20261124_inventory_count_sheet` (migration.sql + rollback.sql), escrita a mano como `20261123_customer_survey` (utf8mb4, FKs `ON DELETE RESTRICT`; las líneas usan CASCADE hacia la hoja). Nunca editar una migración existente.

**App**
- **Copy (español, exacto):**
  - Home: "Inventario", "Nuevo conteo", "En curso", "Continuar", "Recientes", filtros "Todos" / "En revisión" / "Aprobados"; estados "En curso", "En revisión" (ámbar), "Aprobado", "Rechazado", "Devuelto" (rojo suave); resultados "Sin diferencias", "N diferencias · C$ X", "N a recontar".
  - Nuevo conteo: "Bodega", "Qué contar", "Todo", "Elegir categorías", "Seleccionar todas", "N categorías · N productos", "Iniciar conteo", "En revisión" (tarjeta deshabilitada), "Conteo ciego".
  - Conteo: etiqueta "Ciego", "Guardado" / "Guardando…" / "Sin conexión · se guardará", "Buscar producto", "Guardar y siguiente", "Terminar conteo", "Recontar".
  - Terminar: "Contados", "Sin contar", "Volver a contarlos", "Enviar a revisión", "Los productos sin contar no se ajustan".
- **Diseño:** horizontal, tokens oscuros. Filas de 40 dp en la lista de conteo.
  - **Pantalla baja (alto < 520 px, p. ej. 360 dp en un celular horizontal):** todo cabe sin scroll. Header 44 + barra de controles 44 + pie 44. Panel derecho: selector de unidad 36, cantidad 44 y teclado de 4 filas × 44 dp, con "Guardar y siguiente" como tecla alta que ocupa 2 filas de la 4.ª columna. En tablets las teclas crecen con el alto libre.
  - Las medidas viven en un `LAYOUT` exportado (patrón `DiscountSheet.tsx:16`) y una prueba fija la suma.
- **Pantallas de carga diferida:** el JS inicial queda ≤ 250 KB gzip (hoy 89.85 KB).
- **Nunca devolver un plugin de Capacitor desde una función `async`** (bug del proxy `.then`, commit 2ff711f). Esta fase no agrega plugins.
- **Guardado de línea:** `PUT /v1/inventory-counts/:id/lines/:productId` por `api.mutate` con `queue: { operationType: 'GENERIC_MUTATION', meta: { label: 'Conteo de inventario' } }`. Lleva `clientCountedAt` (ISO del dispositivo) y la clave de idempotencia `count-<sheetId>-<productId>-<clientCountedAt ms>`.
  - Los ítems de conteo no caducan por las 12 h de la cola (como las encuestas).
  - Se descartan solos ante un rechazo definitivo `INVENTORY_COUNT_*` o un 403.

**Web**
- Reglas de diseño RH: sin tarjetas anidadas, `CatalogTable` independiente, filtros sin caja, KPI solo con información para decidir.

**Comandos y límites**
- Servidor: `cd server && npx jest --config jest.unit.config.cjs` (nunca `npx jest` a secas) y `npx tsc --noEmit`.
- App: `cd mobile && npx vitest run`, `npx tsc --noEmit`, `npm run build` (JS inicial ≤ 250 KB gzip).
- Web: `cd client && npx tsc --noEmit`, y vitest (entorno node, `renderToStaticMarkup`) de los archivos tocados.

## Review Focus

1. **Se vende durante el conteo.** Se cuenta la leche a las 10:00 (sistema 10, contado 8) y a las 10:30 se venden 2. Al aprobar, la existencia pasa de 8 a 6 (Δ = −2), no a 8. Pruebas: Task 3 `approval applies counted minus expected on top of current stock`, Task 2 `expected captured at save time and recaptured on recount`.
2. **La red se cae a mitad del conteo y el mismo producto se corrige dos veces.** El valor final en el servidor es el último tocado, aunque la cola reenvíe un guardado viejo después de uno nuevo. "Enviar a revisión" queda bloqueado mientras haya guardados de esa hoja en la cola. Pruebas: Task 2 `older clientCountedAt is ignored`, Task 4 `submit blocked while sheet lines are queued`, Task 6 `offline save shows Sin conexión and keeps value after reload`.
3. **El contador ve la existencia por algún lado.** Ni el JSON de la hoja, ni la lista de Recientes de una hoja en revisión o devuelta, ni la respuesta del PUT exponen esperado, existencia o costo. Pruebas: Task 2 `counter payloads never contain expected or stock` (conjunto exacto de claves), Task 1 `recent list hides result until approved`.
4. **Doble aprobación** (doble clic, reintento de red, dos admins a la vez). Los ajustes se postean una sola vez. Un producto con Δ positivo y sin costo aborta toda la aprobación y dice cuál es. Pruebas: Task 3 `second approve is rejected without new movements`, `approve rolls back entirely on missing cost`.
5. **La pantalla de conteo en un celular horizontal de 360 dp:** el teclado decimal, la cantidad y "Guardar y siguiente" se ven completos, y no se aceptan dos puntos decimales ni más de 3 decimales. Pruebas: Task 6 `compact layout fits 360`, `decimal keypad rejects second dot and fourth decimal`.

---

### Task 1: Servidor — modelo, migración, permiso, iniciar hoja y catálogos del contador

**Files:**
- Modify: `server/prisma/schema.prisma` (modelos `InventoryCountSheet` e `InventoryCountLine` con back-relations en Company, Branch, Warehouse, Product, Category, User (nombres de relación `"CountStartedBy"`, `"CountSubmittedBy"`, `"CountApprovedBy"`, `"CountRejectedBy"`, `"CountLineCountedBy"`) e InventoryMovement)
- Create: `server/prisma/migrations/20261124_inventory_count_sheet/migration.sql`, `rollback.sql`
- Modify: `server/prisma/seed.ts`, `server/src/services/company-provisioning.service.ts` (`inventory.count` para ADMIN, BODEGA y CHEF; SUPERADMIN recibe todos)
- Create: `server/src/services/inventory-count-errors.ts`, `server/src/services/inventory-count.service.ts`, `server/src/routes/inventory-count.routes.ts` (montado con `v1.use('/inventory-counts', inventoryCountRoutes)` en `routes/v1.router.ts`)
- Test: `server/src/tests/unit/inventory-count-schema.test.ts` (contrato fs, como `survey-schema.test.ts`), `server/src/tests/unit/inventory-count-start.test.ts`

**Interfaces:**
- Produces (todos con `requirePermission('inventory.count','SUPERADMIN','ADMIN','BODEGA','CHEF')`; el alcance de sucursal se resuelve con `assertBranchAccess(user, warehouse.branchId, { allowGlobal: true })`):
  - `GET /api/v1/inventory-counts/warehouses` devuelve `[{ id, name, type, productCount, lastCountAt: string|null, openSheet: { id, status: 'DRAFT'|'SUBMITTED' } | null }]`. Solo bodegas accesibles al usuario.
  - `GET /api/v1/inventory-counts/warehouses/:id/categories` devuelve `[{ categoryId: number|null, name, productCount }]`, ordenado por `sortOrder` y nombre, con "Sin categoría" al final.
  - `POST /api/v1/inventory-counts` con body `{ warehouseId:int, categoryIds: int[] | null }` devuelve 201 `{ id, status:'DRAFT', warehouseId, productCount }`.
    - Crea la hoja y las líneas en una transacción. Si hay hoja abierta (P2002 en `openWarehouseId`), da 409 `INVENTORY_COUNT_WAREHOUSE_BUSY` con `details.sheetId`. Un alcance sin productos da 400 `INVENTORY_COUNT_INVALID`.
  - `GET /api/v1/inventory-counts?status=open|review|approved|all&page&pageSize(≤50)` devuelve `{ items: [{ id, warehouseName, startedAt, startedByName, status, displayStatus: 'EN_CURSO'|'EN_REVISION'|'APROBADO'|'RECHAZADO'|'DEVUELTO', productCount, countedCount, scopeLabel, result: { differences:int, value:number } | { recount:int } | null }], total }`.
    - Hojas de las sucursales accesibles, la más nueva primero. `DEVUELTO` = DRAFT con `returnedAt`.
  - `InventoryCountService.productsInScope(tx|prisma, companyId, warehouseId, categoryIds|null): Promise<Array<{ productId, categoryId|null }>>`, que reutilizan las Tasks 2 y 3.
  - `InventoryCountError(code, message?, details?)` con los códigos y estados de Global Constraints.

- [ ] **Step 1: Escribir las pruebas que fallan.**
  - `inventory-count-schema.test.ts`:
    - la migración crea ambas tablas, el `UNIQUE` en `openWarehouseId` y `(sheetId, productId)`, e inserta `inventory.count` para SUPERADMIN, ADMIN, BODEGA y CHEF;
    - el rollback los quita;
    - seed y provisioning contienen `inventory.count` en ADMIN, BODEGA y CHEF;
    - `PIN_ROLES` contiene BODEGA y CHEF;
    - el archivo de rutas usa `requirePermission('inventory.count'` en las rutas del contador.
  - `inventory-count-start.test.ts` (Prisma espiado):
    - `creates sheet with one line per active stocked product in scope`: excluye inactivos, productos sin `Stock` en la bodega y categorías con `showInInventory:false`;
    - `categoryIds null means whole warehouse; null category grouped as Sin categoría`;
    - `second open sheet for same warehouse returns WAREHOUSE_BUSY with sheetId` (P2002);
    - `warehouse of other branch is forbidden for branch-pinned user`;
    - `warehouses list marks openSheet and lastCountAt`;
    - `recent list hides result until approved`: SUBMITTED → `result:null`; APPROVED → `{differences, value}`; devuelta → `{recount}` y `displayStatus:'DEVUELTO'`.
- [ ] **Step 2: Ejecutar** `cd server && npx jest --config jest.unit.config.cjs inventory-count` y confirmar que FALLA.
- [ ] **Step 3: Implementar.** Escribir la migración SQL a mano y luego `npx prisma generate`. Contar productos con `groupBy` sobre `Stock` por bodega.
- [ ] **Step 4: Ejecutar** la suite completa del servidor y `npx tsc --noEmit`: en verde.
- [ ] **Step 5: Commit** `feat(server): inventory count sheet model, inventory.count permission and start endpoint`.

### Task 2: Servidor — hoja ciega, guardar línea y enviar a revisión

**Files:**
- Modify: `server/src/services/inventory-count.service.ts`, `server/src/routes/inventory-count.routes.ts`
- Test: `server/src/tests/unit/inventory-count-lines.test.ts`

**Interfaces:**
- Consumes: Task 1 (modelos, errores, `productsInScope`); `UnitConversionService.convert(productId, companyId, qty, unit)` y `getAllowedUnits(productId, companyId)`.
- Produces (permiso `inventory.count`):
  - `GET /api/v1/inventory-counts/:id` devuelve `{ id, status, displayStatus, warehouse: { id, name }, startedAt, startedByName, scopeLabel, returnNote: string|null, categories: [{ categoryId|null, name }], lines: [{ productId, name, sku, categoryId|null, baseUnit, units: [{ abbreviation, name, factor }], unit: string|null, countedQuantity: number|null, counted: boolean, recountRequested: boolean }] }`.
    - Las unidades se cargan en lote: una consulta de `Product` con `baseUnit` y `allowedUnits` para todos los productos de la hoja, con la misma regla que `getAllowedUnits` (función privada compartida y extraída, sin N consultas).
  - `PUT /api/v1/inventory-counts/:id/lines/:productId` con body `{ unit: string, countedQuantity: number|null (≥ 0, ≤ 3 decimales), clientCountedAt: ISO string }` devuelve `{ productId, counted, applied: boolean }`.
    - Solo en DRAFT; si no, 409 `NOT_EDITABLE`.
    - Convierte a base, con 400 `UNIT_INVALID` si la unidad no es del producto. Lee `Stock.quantity` y guarda `expectedAtCount`, `countedBaseQuantity`, `countedById`, `countedAt = now()` y `clientCountedAt`, y pone `recountRequested=false`.
    - `countedQuantity:null` limpia la línea.
    - Un `clientCountedAt` ≤ al guardado devuelve 200 `applied:false` sin escribir.
    - Pasa `requireIdempotencyKey`.
  - `POST /api/v1/inventory-counts/:id/submit` con body `{}` devuelve `{ id, status:'SUBMITTED', counted, notCounted }`.
    - Marca `notCounted=true` en las líneas sin cantidad.
    - 409 `EMPTY` si nada está contado; 409 `RECOUNT_PENDING` si queda alguna `recountRequested`.
    - Bloquea la hoja con `SELECT … FOR UPDATE`.

- [ ] **Step 1: Escribir las pruebas que fallan.**
  - `counter payloads never contain expected or stock`: conjunto exacto de claves de hoja, línea y respuesta del PUT;
  - `save converts unit to base and captures expected at save time` (bolsa de 5 kg × 2 → base 10, esperado = stock leído);
  - `expected captured at save time and recaptured on recount`;
  - `older clientCountedAt is ignored` (`applied:false`, sin escritura);
  - `null quantity clears the line`;
  - `unit not allowed for product is UNIT_INVALID`;
  - `more than 3 decimals or negative is INVALID`;
  - `product outside the sheet is NOT_FOUND`;
  - `save on submitted sheet is NOT_EDITABLE`;
  - `submit marks uncounted lines notCounted and rejects empty sheet`;
  - `submit with pending recount is RECOUNT_PENDING`;
  - `units loaded in one query for the whole sheet` (espía: una sola llamada a `product.findMany`).
- [ ] **Step 2: Ejecutar** `npx jest --config jest.unit.config.cjs inventory-count-lines` y confirmar que FALLA.
- [ ] **Step 3: Implementar.** El PUT valida con `validate()` y corre en una transacción corta: lee la línea y luego el stock.
- [ ] **Step 4: Ejecutar** la suite completa y `tsc`: en verde.
- [ ] **Step 5: Commit** `feat(server): blind count sheet, line save with expected capture and submit`.

### Task 3 [CRÍTICA]: Servidor — revisión, reconteo, rechazo y aprobación con ajustes

**Files:**
- Modify: `server/src/services/inventory-movement.service.ts` (extraer el helper; `physicalCount` lo usa sin cambiar su contrato), `server/src/services/inventory-count.service.ts`, `server/src/routes/inventory-count.routes.ts`
- Test: `server/src/tests/unit/inventory-count-review.test.ts`; `inventory-physical-count.test.ts` existente, sin cambios y en verde

**Interfaces:**
- Consumes: Tasks 1–2; `InventoryEngineService.lockInventoryScope(tx, companyId, warehouseIds, productIds)`, `applyMovement`, `CostingService.applyProductionCost`, `AuditLogService.log`.
- Produces:
  - `InventoryMovementService.postCountAdjustmentTx(tx, companyId, input: { warehouseId, productId, userId, productName: string, deltaBase: number, reason: string, reference?: string, originalUnit: string, conversionFactor: number, audit: Record<string, unknown> }): Promise<{ movementId: number|null, direction: 'IN'|'OUT'|null, unitCost: number|null }>`.
    - Es el bloque de `physicalCount` desde "if |delta| > 1e-9" hasta la auditoría: costo de entrada con respaldo, `PRODUCT_COST_MISSING`, `applyMovement` ADJUSTMENT con `origin:'MANUAL'`, `applyProductionCost` en IN y `AuditLog` `entityType:'InventoryCount'`.
    - No toma locks: el llamador ya los tiene.
  - Rutas con `requireRole('SUPERADMIN','ADMIN')` (y `assertBranchAccess`):
    - `GET /api/v1/inventory-counts/review?status=SUBMITTED|APPROVED|REJECTED|DRAFT&branchId?&dateFrom&dateTo&page` devuelve `{ items: [{ id, branchName, warehouseName, startedByName, startedAt, submittedAt, status, displayStatus, productCount, countedCount, differences, netValue }], total }`.
    - `GET /api/v1/inventory-counts/:id/review` devuelve la hoja más `lines: [{ productId, name, categoryName, baseUnit, unit, countedQuantity, countedBaseQuantity, expectedAtCount, diffQuantity, unitCost, diffValue, notCounted, recountRequested, previousCountedBase, countedByName, countedAt, movementId }]` y `totals: { differences, shortageValue, surplusValue, netValue, notCounted }`.
    - `POST /:id/recount` con `{ productIds: int[] (≥ 1), note?: string ≤ 500 }`. Solo SUBMITTED. Para cada línea: `previousCountedBase = countedBaseQuantity`, se limpian cantidad, esperado y `notCounted`, y `recountRequested=true`. La hoja pasa a DRAFT con `returnedAt` y `returnNote`.
    - `POST /:id/reject` con `{ reason: string 3–500 }`. Solo SUBMITTED; la hoja pasa a REJECTED y libera `openWarehouseId`. No hay ajustes.
    - `POST /:id/approve` con `requireIdempotencyKey` devuelve `{ id, status:'APPROVED', adjustments: int, netValue }`.
      - En una transacción:
        - bloquea la hoja (`FOR UPDATE`) y exige SUBMITTED; si no, 409 `NOT_EDITABLE`;
        - llama `lockInventoryScope` con la bodega y todos los productos contados;
        - por cada línea contada con |Δ| > 1e-9 (Δ = contado − esperado) llama `postCountAdjustmentTx` con `reason: 'Conteo físico: hoja #<id>'` y `reference: 'CONTEO-<id>'`, y guarda `movementId` y `adjustmentValue`;
        - marca APPROVED y libera `openWarehouseId`.
      - Si falta costo, junta los productos y lanza `INVENTORY_COUNT_COST_MISSING` con `details.products`; la transacción completa se revierte.

- [ ] **Step 1: Escribir las pruebas que fallan.**
  - `approval applies counted minus expected on top of current stock`: esperado 10, contado 8, stock actual 6 → ADJUSTMENT OUT de 2 (no 0 ni 4);
  - `surplus line posts IN at effective average cost`;
  - `not counted and zero-diff lines produce no movement`;
  - `second approve is rejected without new movements` (estado APPROVED → 409; `applyMovement` no se vuelve a llamar);
  - `approve rolls back entirely on missing cost` (2 líneas, la 2.ª sin costo → ningún movimiento y error con el nombre del producto);
  - `recount resets chosen lines, keeps previous count and returns sheet as DRAFT`;
  - `reject releases the warehouse for a new count`;
  - `review lines expose expected, diff and value; totals split shortage and surplus`;
  - `non-admin cannot reach review routes` (BODEGA → 403);
  - `physicalCount keeps its behaviour` (la suite existente `inventory-physical-count.test.ts` pasa sin cambios).
- [ ] **Step 2: Ejecutar** `npx jest --config jest.unit.config.cjs inventory-count-review inventory-physical-count` y confirmar que la nueva FALLA y la existente PASA.
- [ ] **Step 3: Implementar.** Extraer primero el helper y correr `inventory-physical-count`, en verde. Después, las rutas de revisión. Con `deltaBase` y `conversionFactor`, `originalQuantity = |Δ| / factor`, como hoy.
- [ ] **Step 4: Ejecutar** la suite completa y `tsc`: en verde.
- [ ] **Step 5: Commit** `feat(server): count review, recount, reject and single-transaction approval reusing physical count posting`.

### Task 4: App — capa de datos del inventario, cola y rutas de entrada

**Files:**
- Create: `mobile/src/features/inventory/inventoryApi.ts`, `inventoryTypes.ts`, `InventoryEntry.tsx` (default export, carga diferida), `mobile/src/features/inventory/inventoryApi.test.ts`, `entry.test.tsx`
- Modify: `mobile/src/data/queueLabels.ts` (`INVENTORY_COUNT_URL_RE = /^\/v1\/inventory-counts\/\d+\/lines\/\d+$/`, `isInventoryCountItem(item)`, `isDefinitiveCountRejection(status, code)`), `mobile/src/data/offlineQueue.ts` (`isStale` excluye los ítems de conteo; el rechazo definitivo de conteo elimina la fila, igual que la rama de encuestas), `mobile/src/data/waiterApi.ts` (exportar `cachedRead<T>(url, params, ttlMs): Promise<CacheResult<T>>` sobre el `cached` interno, `swr:false`), `mobile/src/features/waiter/WaiterHome.tsx` (ruta `{ name:'inventory' }`, `InventoryEntry` diferido), `mobile/src/features/waiter/tables/TablesScreen.tsx` (prop `onOpenInventory?`, botón "Inventario" en el header si `can(user,'inventory.count')`), `mobile/src/app/Router.tsx` (`WaiterSession`: sin `tables.map.view` y con `inventory.count` monta `InventoryEntry` en lugar de `WaiterHome`)

**Interfaces:**
- Consumes: endpoints de las Tasks 1–2; `loadWaiterData(services)` → `{ api.mutate, api.cachedRead, queue, db }`.
- Produces:
  - `createInventoryApi(data: Pick<WaiterData,'api'|'queue'|'db'>, http)` devuelve:
    - `warehouses()`, `categories(warehouseId)`, `recent(status)`, `start({ warehouseId, categoryIds })`;
    - `sheet(id): Promise<CountSheet>`: en línea va al servidor y lo cachea; sin red usa la caché (24 h). Siempre se superponen los PUT de esta hoja que siguen en cola;
    - `saveLine(sheetId, productId, { unit, countedQuantity }): Promise<'saved'|'queued'>`: fija `clientCountedAt = new Date().toISOString()` y la clave `count-<sheetId>-<productId>-<ms>`;
    - `pendingLines(sheetId): Promise<number>`: ítems en cola de esa hoja, de cualquier dueño;
    - `submit(sheetId)`: nunca se encola; sin red lanza `OfflineError`.
  - `InventoryEntry({ session, services, onSwitchUser, onBack? })`: carga `loadWaiterData` y administra las rutas internas `home | new | count(sheetId) | finish(sheetId)`. `onBack` existe solo si se entró desde mesas.
  - Tipos `CountSheet`, `CountLine`, `CountUnit`, `RecentSheet` en `inventoryTypes.ts`, que reflejan los DTO de las Tasks 1–2.

- [ ] **Step 1: Escribir las pruebas que fallan.**
  - `inventoryApi.test.ts`:
    - `saveLine queues offline with count label and stable key`;
    - `count items never go stale after 12h`;
    - `definitive INVENTORY_COUNT_ rejection drops the queued line`;
    - `sheet offline uses cache and overlays queued values`;
    - `submit blocked while sheet lines are queued` (`pendingLines` > 0 → la UI recibe el conteo; `submit` sin red lanza `OfflineError`).
  - `entry.test.tsx`:
    - `inventory-only user lands on Inventario without loading tables`: BODEGA sin `tables.map.view` no llama `/tables/plan`;
    - `waiter with inventory.count sees Inventario in tables header`;
    - `waiter without inventory.count does not`;
    - `Inventario back returns to tables`.
- [ ] **Step 2: Ejecutar** `cd mobile && npx vitest run src/features/inventory src/data` y confirmar que FALLA.
- [ ] **Step 3: Implementar.** `InventoryEntry` y sus pantallas son chunks diferidos. `Router.tsx` solo importa con `lazy()`.
- [ ] **Step 4: Ejecutar** `npx vitest run`, `npx tsc --noEmit` y `npm run build` completos: en verde, con el JS inicial ≤ 250 KB gzip.
- [ ] **Step 5: Commit** `feat(mobile): inventory data layer, queued count saves and entry routes`.

### Task 5: App — Inicio de inventario y Nuevo conteo

**Files:**
- Create: `mobile/src/features/inventory/InventoryHome.tsx`, `NewCountScreen.tsx`, `inventory.css`, `home.test.tsx`
- Modify: `InventoryEntry.tsx`

**Interfaces:**
- Consumes: `createInventoryApi` (Task 4).
- Produces:
  - `InventoryHome({ api, user, onNew, onContinue(sheetId), onSwitchUser, onBack? })`;
  - `NewCountScreen({ api, onStarted(sheetId), onBack })`.

- [ ] **Step 1: Escribir las pruebas que fallan.**
  - `home shows En curso card with warehouse, start, scope, progress and Continuar`;
  - `recent table filters Todos / En revisión / Aprobados`;
  - `recent result shows Sin diferencias, N diferencias · value, N a recontar, and — while in review`;
  - `Devuelto sheet appears as En curso with Recontar count`;
  - `warehouse in review is disabled; with a draft it offers Continuar`;
  - `Todo selects whole warehouse; Elegir categorías shows 3-column grid with Seleccionar todas and N categorías · N productos`;
  - `Iniciar conteo disabled with zero categories`;
  - `WAREHOUSE_BUSY on start opens the existing sheet`;
  - `load error shows inline retry, never an empty list`.
- [ ] **Step 2: Ejecutar** `npx vitest run src/features/inventory/home` y confirmar que FALLA.
- [ ] **Step 3: Implementar** con el layout de la spec:
  - Home: header con avatar, "Nuevo conteo" y candado, más "Mesas" si existe `onBack`.
  - Nuevo conteo en dos columnas: a la izquierda bodegas en tarjetas y "Qué contar"; a la derecha el resumen (bodega, categorías, productos, "Conteo ciego") con "Iniciar conteo".
  - La rejilla usa `grid-template-columns: repeat(3, 1fr)`.
- [ ] **Step 4: Ejecutar** vitest, `tsc` y build completos: en verde.
- [ ] **Step 5: Commit** `feat(mobile): inventory home and new count screens`.

### Task 6 [CRÍTICA]: App — pantalla de conteo ciego, teclado decimal y Terminar

**Files:**
- Create: `mobile/src/features/inventory/CountScreen.tsx`, `CategoryPicker.tsx`, `DecimalKeypad.tsx`, `FinishCountScreen.tsx`, `countMath.ts`, `count.test.tsx`, `countMath.test.ts`
- Modify: `InventoryEntry.tsx`, `inventory.css`

**Interfaces:**
- Consumes: `api.sheet`, `api.saveLine`, `api.pendingLines`, `api.submit` (Task 4).
- Produces:
  - `countMath.ts`:
    - `applyKey(text: string, key: '0'..'9'|'.'|'back'|'clear'): string`: un solo punto y como máximo 3 decimales;
    - `parseQty(text): number|null`;
    - `progress(lines, categoryId?): { counted, total }`;
    - `nextLine(lines, currentProductId, categoryId): productId|null`: el siguiente sin contar de la categoría, luego de la siguiente categoría, y si no hay, null.
  - `LAYOUT` exportado en `CountScreen.tsx`: `{ compact: { header:44, controls:44, footer:44, unit:36, display:44, key:44, keyRows:4 }, compactMaxHeight: 520 }`.
  - `CountScreen({ api, sheetId, user, onFinish, onExit })` y `FinishCountScreen({ api, sheetId, onRecount, onSubmitted })`.

- [ ] **Step 1: Escribir las pruebas que fallan.**
  - `countMath.test.ts`:
    - `decimal keypad rejects second dot and fourth decimal`;
    - `leading dot becomes 0.`;
    - `nextLine skips counted and moves to next category`;
    - `progress per category and overall`.
  - `count.test.tsx`:
    - `header shows warehouse, Ciego tag, counter, start and Guardado`;
    - `never renders expected or stock` (con un payload que trae una clave extra `expectedAtCount`, el valor no aparece en el DOM);
    - `category picker shows N/M with check when complete and switches list in place`;
    - `search filters across all scope categories by name or sku`;
    - `unit selector lists base and conversions; default is the line unit or base`;
    - `Guardar y siguiente saves and selects next uncounted`;
    - `offline save shows Sin conexión and keeps value after reload` (cola simulada y remontaje);
    - `recount lines are marked Recontar`;
    - `rows are 40dp and missing quantity shows —`;
    - `compact layout fits 360`: la suma de `LAYOUT.compact` (header + controls + footer en la columna; unit + display + key × keyRows en el panel) ≤ 360, y `key` ≥ 44;
    - `Terminar shows counted / sin contar; Volver a contarlos returns filtered to uncounted`;
    - `Enviar a revisión disabled while lines are queued and offline`;
    - `double tap Enviar submits once`;
    - `submitted goes back to home with En revisión`.
- [ ] **Step 2: Ejecutar** `npx vitest run src/features/inventory/count src/features/inventory/countMath` y confirmar que FALLA.
- [ ] **Step 3: Implementar.**
  - Dos paneles. A la izquierda, la barra única de controles (selector de categoría "Lácteos 9/14 ▾" que abre una lista sobre los productos y atenúa el resto, y el buscador) y la lista de filas de 40 dp. A la derecha, la unidad, la cantidad grande y el teclado.
  - El indicador "Guardado" refleja el último `saveLine`: `saved` → "Guardado", `queued` → "Sin conexión · se guardará", y "Guardando…" mientras está en vuelo.
  - Con alto < 520 px aplica `LAYOUT.compact` por media query (`max-height: 519px`) y `100dvh`. "Guardar y siguiente" es la tecla alta de la 4.ª columna.
- [ ] **Step 4: Ejecutar** vitest, `tsc` y build completos: en verde, con el JS inicial ≤ 250 KB gzip.
- [ ] **Step 5: Commit** `feat(mobile): blind count screen with decimal keypad and submit to review`.

### Task 7: Web — revisión de conteos

**Files:**
- Create: `client/src/pages/inventory-count/InventoryCountReview.tsx` (contenedor), `InventoryCountReviewView.tsx` (presentacional puro), `InventoryCountReview.css`, `InventoryCountReviewView.test.ts`
- Modify: `client/src/services/api.ts` (`inventoryCountsAPI.list/detail/recount/approve/reject`; `approve` envía `X-Idempotency-Key` estable por intento), `client/src/App.tsx` (ruta diferida `/inventario/conteos` con `<RoleGuard roles={ADMIN}>`), `client/src/components/Layout.tsx` (ítem "Conteos de inventario" en 'Gestión', `roles: ADMIN`, junto a "Inventario", en los dos sitios de filtrado); actualizar `navigationPermissions.contract.test.ts` si enumera ítems

**Interfaces:**
- Consumes: rutas de revisión de la Task 3.

- [ ] **Step 1: Escribir las pruebas que fallan** (`renderToStaticMarkup`):
  - `list shows warehouse, counter, dates, status badges and net value; default filter En revisión`;
  - `detail shows system at count, counted, diff quantity and diff value per line`;
  - `Solo diferencias toggle hides zero-diff lines`;
  - `KPIs: diferencias, faltante, sobrante, neto, sin contar`;
  - `recount needs at least one selected product`;
  - `approve confirmation states N ajustes and net value`;
  - `COST_MISSING error lists the products`;
  - `approved sheet shows movement links and no actions`.
- [ ] **Step 2: Ejecutar** `cd client && npx vitest run src/pages/inventory-count` y confirmar que FALLA.
- [ ] **Step 3: Implementar.**
  - Lista con filtros sin caja: estado (por defecto En revisión), sucursal y fechas. Al elegir una fila se abre el detalle en la misma página (PageHeader con "Volver").
  - El detalle usa `CatalogTable` independiente, con casillas para elegir productos a recontar.
  - Acciones: "Pedir reconteo" (con nota opcional), "Rechazar" (con motivo) y "Aprobar y ajustar" (con confirmación).
  - Sin gráficas.
- [ ] **Step 4: Ejecutar** `npx tsc --noEmit` y los vitest tocados: en verde.
- [ ] **Step 5: Commit** `feat(client): inventory count review and approval page`.

## Execution notes
- **Decisiones del planificador** (desviaciones o precisiones de §7.3.4, a confirmar):
  - El ajuste al aprobar es Δ = contado − esperado al contar, sumado a la existencia actual. No se reutiliza `physicalCount` tal cual, porque fija la existencia al valor contado y borraría las ventas posteriores. Se reutiliza su bloque de posteo.
  - El esperado se captura cuando el servidor recibe la línea. Si estaba en cola sin red, las ventas entre el conteo y la sincronización entran en la diferencia.
  - "Devuelto" = DRAFT con `returnedAt`. El enum queda como pide la spec.
  - Una sola hoja abierta (DRAFT o SUBMITTED) por bodega; cualquier contador con `inventory.count` de esa sucursal puede continuarla.
  - Revisar y aprobar es solo para ADMIN/SUPERADMIN, sin permiso nuevo.
  - La bodega CENTRAL deja `branchId` en null.
- **Orden:** T1 → T2 → T3 (servidor), después T4 → T5 → T6 (app, un solo escritor). T7 puede ir en paralelo con T4–T6 solo si sus commits indican rutas explícitas (regla R8 de la Fase 4).
- **Revisiones:** un refutador en T3, T4 y T6 (posteo de stock y cola offline). Finales: Opus en el servidor, y Opus + Fable 5.2 en la app y la web. Una ola de correcciones y una re-revisión acotada.
- **Diferidos al gate de dispositivo:** conteo real en 1280×800, 1024×600 y un celular horizontal de 360 dp; Wi-Fi apagado a mitad del conteo y reanudar tras el bloqueo por PIN; BODEGA solo con inventario entrando por PIN.
- **Paso final antes del despliegue (no es tarea de código):** ensayar `20261124_inventory_count_sheet` en una copia de la BD (`db:rehearse-migrations` contra `miapitza_costeo_restore_test`), comparar el esquema y luego aplicarla a `miapitza_costeo_20261119`. Solo crea tablas e inserta permisos, sin bloquear tablas calientes.

## Decisiones del controlador (2026-11-21)
- Aprobar aplica Δ = contado − existencia capturada al contar (la spec 7.3.4 lo exige: "para que las ventas durante el conteo no distorsionen la diferencia"). No se fija la existencia al valor contado.
- Un ADMIN/SUPERADMIN puede aprobar un conteo en el que participó (restaurante pequeño, a veces un solo admin); se registra quién contó cada línea y quién aprobó.
