# App Android — Plan de implementación: Fase 2 (Modo Mesero)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un mesero, en la tablet de servicio, vea el plano de mesas, abra una mesa, tome y envíe el pedido, entregue lo listo, aplique cupones o descuentos (con PIN de supervisor si excede su límite), y que el cajero cobre con su PIN, de punta a punta y con cortes de red.

**Architecture:** El backend gana lo mínimo que falta para el flujo (personas por pedido, editar línea sin enviar, entregar líneas listas, más vendidos por sucursal, eventos WS de líneas, descuento con motivo y autorización por PIN de supervisor, idempotencia por usuario). La app reutiliza las reglas puras de `client/src` vía `@web/*` (`offlinePolicy`, `idempotency`, `payment`, `paymentAccess`, `promotionRules`, `stockAvailability`, `categoryVisibility`, `currency`) y tiene su propia capa de datos (API tipada + caché + cola offline en IndexedDB) y su propia UI táctil.

**Tech Stack:** Express 5, Prisma (MySQL), Jest (server); React 18, TypeScript, Vite, Vitest + Testing Library, Capacitor 6, Dexie (IndexedDB en el WebView) y una lista virtualizada liviana (elección del implementador, ≤ 8 KB gzip).

**Spec:** `docs/superpowers/specs/2026-11-19-app-android-design.md` (§7.3, §7.3.0, §7.3.1, §7.3.2, §7.6, §9, §9.1)
**Inventario de API existente (leer antes de cada tarea):** `.superpowers/sdd/2026-11-20-app-android-fase-2-mesero/api-inventory.md`

## Decisiones del usuario (2026-11-20)

- **Cobro:** lo hace el **cajero con su PIN** en la tablet (su turno de caja). El botón Cobrar solo aparece con `payments.process` **y** `invoices.issue`; el mesero no cobra.
- **Promociones:** Fase 2 = **cupón por código + descuento manual con límite y PIN de supervisor + etiquetas** de productos con promoción vigente. Las **promociones automáticas** (aplicarse solas) son una fase propia posterior.

## Global Constraints

- Todo lo de la Fase 1 sigue vigente (horizontal en servicio, ≥ 48 dp, oscuro monocromo, tokens fuera de `localStorage`, JS inicial ≤ 250 KB gzip por modo).
- **Toda acción de UI se protege con `can()`/`canAny()`** (`mobile/src/core/permissions.ts`); un botón sin permiso no se muestra.
- Rutas bajo `/api` (no `/api/v1`) salvo dispositivos. Respuesta `{success, data}`.
- Mutaciones con `X-Idempotency-Key` (llave por acción, reutilizada solo ante fallo ambiguo, como `@web/utils/idempotency`).
- Solo se encolan offline: `CREATE_ORDER`, `ADD_ORDER_ITEM`, `SEND_TO_KITCHEN`, `CREATE_PAYMENT` (contrato web, sin ampliarlo). Descuento, prefactura, traslado, unir y entregar requieren conexión y lo dicen en pantalla.
- **Borradores por mesero:** las líneas "Nuevo · sin enviar" se guardan localmente por `userId + tableId`; al cambiar de usuario no se pierden ni se mezclan.
- "Mis mesas" = pedidos activos cuyo `order.user.id` es el usuario actual (`GET /api/orders/active`).
- Cualquier mesero puede atender cualquier mesa.
- Estado de mesa por borde: gris libre, blanco ocupada, ámbar listo, rojo suave por cobrar.
- Montos: `formatCurrency` de `@web/utils/currency`, cifras tabulares, `C$`.
- Errores de servidor se muestran con el mensaje del servidor (`@web/utils/apiError`), nunca con trazas.
- Eventos WS reales: `ORDER_UPDATE` (status ad hoc), `ORDER_READY`, `KITCHEN_NOTIFICATION` (solo al mesero creador), `TABLE_STATUS_CHANGED`. **No** usar `ORDER_CREATED`/`ORDER_COMPLETED` (el servidor no los emite).

## Review Focus

1. **Doble envío por reintento o reconexión** (toque doble en "Enviar a cocina", replay offline tras cambiar de PIN): un solo lote en cocina y una sola línea por acción. Tests en Task 5 y Task 6.
2. **Descuento por encima del límite sin autorización** (llamada directa a la API, PIN de supervisor equivocado repetido, supervisor sin permiso, supervisor con límite menor que lo pedido): se rechaza siempre y queda auditado. Tests en Task 4.
3. **Cobro dividido interrumpido** (se cae la red entre el tramo 2 y el 3): al reintentar no se repite un tramo cobrado y el pendiente es correcto. Test en Task 12.
4. **Dos meseros sobre la misma mesa** (uno agrega mientras otro envía): la tablet del otro se actualiza por WS y "Nuevo" de cada uno sigue siendo suyo. Tests en Task 2 y Task 9.
5. **Ticket de 40+ líneas en tablet de 2 GB**: el pie siempre visible y el scroll fluido (lista virtualizada). Test en Task 10.

---

## BACKEND

### Task 1: Esquema — personas, entrega por línea, descuentos con motivo y autorización

**Files:**
- Modify: `server/prisma/schema.prisma`, `server/prisma/seed.ts`, `server/src/services/company-provisioning.service.ts`
- Create: `server/prisma/migrations/20261121_waiter_mode/migration.sql` (+ `rollback.sql` si el repo lo usa, como en `20261120_operational_devices_pin`)
- Test: `server/src/tests/unit/waiter-mode-schema.test.ts`

**Interfaces:**
- Produces:
  - `Order.guests Int?`, `Order.discountReason String? @db.VarChar(120)`, `Order.discountAuthorizedById Int?` (relación a `User`, `onDelete: SetNull`).
  - `OrderItem.deliveredAt DateTime?`, `OrderItem.deliveredById Int?` (relación a `User`, `SetNull`).
  - `Role.maxDiscountPercent Int?` (0–100; `null` = regla actual, ver Task 4).
  - Permisos `orders.discount.apply` (MESERO, CAJERO, ADMIN) y `orders.discount.authorize` (ADMIN), sembrados igual que `devices.manage` en Fase 1 (migración `INSERT IGNORE` + `_PermissionToRole`, `seed.ts`, aprovisionamiento).
- [ ] **Step 1: Test que falla:** `UserScalarFieldEnum`/`OrderScalarFieldEnum`/`OrderItemScalarFieldEnum`/`RoleScalarFieldEnum` contienen los campos nuevos; `seed` declara ambos permisos con esos roles.
- [ ] **Step 2:** `cd server && npx jest --config jest.unit.config.cjs src/tests/unit/waiter-mode-schema.test.ts` → FAIL.
- [ ] **Step 3:** Esquema + migración + seed + aprovisionamiento; `npx prisma validate && npx prisma generate`.
- [ ] **Step 4:** → PASS; `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(waiter-api): schema for guests, line delivery and authorized discounts`.

### Task 2: Pedidos — personas, editar línea sin enviar, entregar listos y eventos WS **[CRÍTICA]**

**Files:**
- Modify: `server/src/services/order.service.ts`, `server/src/controllers/order.controller.ts`, `server/src/routes/order.routes.ts`, `server/src/utils/validate-schemas.ts`
- Test: `server/src/tests/unit/order-waiter-flow.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/orders` acepta `guests?: int 1..99`; `PATCH /api/orders/:id/guests` `{guests}` (`orders.edit`).
  - `PATCH /api/orders/items/:itemId` `{quantity?: int ≥1, notes?: string ≤200}` (`orders.edit`): solo si `sentAt === null`, mismas reglas de bloqueo que `addItem` (prefactura, pagos, cancelado); re-precia como `addItem`.
  - `POST /api/orders/:id/items/deliver` `{itemIds: number[] 1..100}` (`orders.deliver`): marca `deliveredAt/deliveredById` solo en líneas `status === 'DONE'` no anuladas y no entregadas; las demás se ignoran y se reportan en `skipped`. Responde `{delivered: number[], skipped: number[]}`. Idempotente (repetir no cambia nada).
  - WS `ORDER_UPDATE` (alcance sucursal) con `status`: `ITEMS_CHANGED` (add/update/remove), `SENT_TO_KITCHEN` (además del evento a cocina existente), `ITEMS_DELIVERED`, `GUESTS_CHANGED`. Payload `{orderId, status, order, timestamp}` como el resto.
  - `GET /api/orders/active` y `GET /api/orders/:id` incluyen `guests`, `discountReason`, `items[].deliveredAt` e `items[].modifiers`.
- [ ] **Step 1: Tests que fallan:** `create stores guests`; `update unsent item quantity reprices the order`; `update rejects a sent item with a clear message`; `deliver marks only DONE lines and is idempotent`; `deliver of a voided line is skipped`; `addItem, updateItem, removeItem emit ORDER_UPDATE ITEMS_CHANGED`; `send-to-kitchen emits ORDER_UPDATE SENT_TO_KITCHEN once even when replayed with nothing unsent`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** → PASS + `npm run test:unit` + `tsc`.
- [ ] **Step 5:** Commit `feat(waiter-api): guests, unsent line edits, line delivery and line events`.

### Task 3: Más vendidos por sucursal

**Files:**
- Modify: `server/src/routes/menu-item.routes.ts`, `server/src/controllers/menu-item.controller.ts`, `server/src/services/menu-item.service.ts`
- Test: `server/src/tests/unit/menu-top-sellers.test.ts`

**Interfaces:**
- Produces: `GET /api/menu-items/top?branchId&days=30&limit=12` — cualquier usuario autenticado con alcance de sucursal (`resolveBranchScope`); `days` 1..90, `limit` 1..30; suma `quantity − voidedQuantity` de líneas de pedidos no cancelados en la ventana; solo ítems activos; responde `[{menuItemId, quantity}]` ordenado desc. Ruta declarada **antes** de `/:id`.
- [ ] **Step 1: Tests que fallan:** `orders by sold quantity within the window`; `excludes cancelled orders and voided quantity`; `a branch-pinned user cannot read another branch`.
- [ ] Steps 2–4 como arriba. **Step 5:** Commit `feat(waiter-api): top sellers per branch`.

### Task 4: Descuento manual con motivo, límite por rol y autorización por PIN de supervisor **[CRÍTICA]**

**Files:**
- Create: `server/src/services/discount-authorization.service.ts`
- Modify: `server/src/services/order.service.ts` (`updatePricing`, `isManualDiscountCappedRole`, `getMaxManualDiscountPercent`), `server/src/services/pin.service.ts`, `server/src/controllers/order.controller.ts`, `server/src/routes/order.routes.ts`
- Test: `server/src/tests/unit/discount-authorization.test.ts`

**Interfaces:**
- Consumes: `PinService`, `loginAttemptService`, `OperationalDeviceService.resolveActive` (Fase 1).
- Produces:
  - `getManualDiscountLimit(user): Promise<number>` — SUPERADMIN/ADMIN 100; si alguno de sus roles tiene `maxDiscountPercent` usar el mayor; si no, **la regla de hoy**: MESERO → tope de empresa `${companyId}_maxManualDiscountPercent` (100 si no existe), demás → 100. El tope de empresa es techo cuando el rol tiene valor propio. *(Así la web no cambia de comportamiento.)*
  - `PATCH /api/orders/:id/pricing` acepta `discountReason?: string 3..120`. Si hay descuento manual > 0: exige `orders.discount.apply` (o el permiso no está definido → regla actual); si el % sobre el subtotal excede el límite → **403** `{code:'DISCOUNT_AUTH_REQUIRED', limitPercent, requestedPercent}` sin aplicar nada. Al aplicar guarda `discountReason` y limpia `discountAuthorizedById`.
  - `POST /api/orders/:id/discount/authorize` (auth + header `X-Device-Token` de una tablet ACTIVE de la misma sucursal), body `{supervisorUserId, pin, discount, discountReason}`: el supervisor debe estar ACTIVE, misma compañía/sucursal, tener `orders.discount.authorize`, PIN válido, y su propio límite ≥ % pedido. Aplica el descuento **en la misma transacción** con `discountReason` y `discountAuthorizedById = supervisor`, audita `DISCOUNT_AUTHORIZED` (quién pidió, quién autorizó, monto, %, motivo). Fallos → 401 genérico `'Autorización inválida'`; bloqueo con `loginAttemptService` `ipKey = discount-auth:device:<id>` (5 fallos por supervisor). **No** crea sesión.
  - `GET /api/orders/discount/supervisors` (header `X-Device-Token`): `[{id, name, initials, color}]` de usuarios con `orders.discount.authorize` y PIN en la sucursal del dispositivo.
  - `GET /api/auth/me/discount-limit` → `{limitPercent}` para mostrar "Tu límite: X %".
  - `PinService.setPin` permite también a usuarios con `orders.discount.authorize` (su PIN **no** sirve para `pin-login`, que sigue exigiendo roles ⊆ `PIN_ROLES`).
- [ ] **Step 1: Tests que fallan:** `MESERO over the company cap gets DISCOUNT_AUTH_REQUIRED and nothing changes`; `CAJERO keeps today's uncapped behaviour when its role has no maxDiscountPercent`; `role maxDiscountPercent is capped by the company cap`; `authorize applies discount, reason and authorizer atomically and audits`; `authorize rejects wrong PIN, supervisor without permission, supervisor from another branch, supervisor whose own limit is lower — all with the same generic message`; `5 wrong supervisor PINs lock that supervisor on that device`; `an ADMIN with a PIN still cannot pin-login`; `web pricing call without discountReason still works`.
- [ ] Steps 2–4. **Step 5:** Commit `feat(waiter-api): manual discount limits and supervisor PIN authorization`.

### Task 5: Idempotencia por usuario, no por token **[CRÍTICA]**

**Files:**
- Modify: `server/src/middlewares/idempotency.ts`
- Test: `server/src/tests/unit/idempotency-namespace.test.ts`

**Interfaces:**
- Produces: el namespace pasa de `sha256(token + authz)` a `sha256(companyId + ':' + userId + authz)`. Con la misma llave y el mismo cuerpo, un replay tras re-login/cambio de PIN devuelve la respuesta guardada; con otro usuario no colisiona. Requests sin usuario: comportamiento actual.
- [ ] **Step 1: Tests que fallan:** `same user, new token, same key and body → replayed response`; `different user, same key → independent`; `same key, different body → 409 IDEMPOTENCY_MISMATCH` (sin cambios).
- [ ] Steps 2–4 (+ `npm run test:unit` completo: la web depende de este middleware). **Step 5:** Commit `fix(api): scope idempotency keys to the user, not the token`.

---

## APP (`mobile/`)

### Task 6: Capa de datos — API del mesero, caché y cola offline **[CRÍTICA]**

**Files:**
- Create: `mobile/src/data/waiterApi.ts`, `mobile/src/data/cache.ts`, `mobile/src/data/offlineQueue.ts`, `mobile/src/data/drafts.ts`, `mobile/src/data/useOnline.ts`, `mobile/src/data/types.ts`
- Test: `mobile/src/data/*.test.ts`

**Interfaces:**
- Consumes: `createHttp`, `appEvents`, `createSessionStore` (Fase 1); `@web/services/offlinePolicy`, `@web/utils/idempotency`.
- Produces:
  - `waiterApi` tipado con las rutas del inventario y de Tasks 2–4: `floorPlan(branchId)`, `activeOrders(branchId)`, `menu(branchId)`, `menuItem(id)` (modificadores), `categories()`, `topSellers(branchId)`, `promotions(branchId)`, `validateCoupon(...)`, `createOrder`, `addItem`, `updateItem`, `removeItem`, `sendToKitchen`, `deliverItems`, `setGuests`, `transfer`, `groupTables`, `pricing`, `authorizeDiscount`, `supervisors`, `discountLimit`, `preinvoice`, `paymentMethods`, `cashShiftStatus`, `createPayment`, `splitEvenly|ByItems|ByAmount`, `kitchenNotifications`, `markNotificationSeen`.
  - `cache`: Dexie `MobileDB` con tablas `caches` y `syncQueue`, clave `ownerKey|url?params`; TTL menú 5 min, categorías 10 min, plano 10 min, pedidos 60 s; menú y plano se sirven desde caché al instante y se refrescan en segundo plano.
  - `offlineQueue`: misma forma `SyncItem` que la web (`import type` o redefinido), `ownerKey = companyId:userId`; replay solo con la sesión de ese dueño, en orden, `dependencyKey`, backoff `min(1000·2^n, 30000)`, 5 reintentos, fallas permanentes según la regla web; `pendingCount()` observable.
  - `drafts`: `get/set/clear(userId, tableId)` en IndexedDB; nunca incluye tokens.
  - `useOnline()` y el indicador "Sin conexión · N pendientes".
- [ ] **Step 1: Tests que fallan:** `create-order offline queues with entityTempId and resolves _offline`; `send-to-kitchen waits for its dependency`; `replay stops when the session owner changes and resumes for that owner`; `ambiguous failure reuses the same idempotency key, a new action gets a new key`; `drafts are isolated per user and table`; `menu served from cache then refreshed`.
- [ ] Steps 2–4 (`cd mobile && npx vitest run src/data`). **Step 5:** Commit `feat(mobile): waiter data layer with cache and offline queue`.

### Task 7: Vista de mesas

**Files:**
- Create: `mobile/src/features/waiter/tables/TablesScreen.tsx`, `FloorPlan.tsx`, `TableTile.tsx`, `ReadyBanner.tsx`, `tableState.ts`
- Modify: `mobile/src/features/waiter/WaiterHome.tsx` (reemplaza el placeholder)
- Test: `mobile/src/features/waiter/tables/*.test.tsx`, `tableState.test.ts`

**Interfaces:**
- Produces:
  - `tableState(table, order|undefined): 'free'|'occupied'|'ready'|'due'` desde `operationalState` del plano (READY/PARTIALLY_READY → ready; INVOICED/PARTIAL_PAYMENT → due; OPEN_ORDER/WAITING_KITCHEN/PREPARING → occupied; AVAILABLE → free).
  - Header de una fila (opción A): avatar + nombre + "sucursal · N mesas activas"; pestañas de área con conteo; chip "Mis mesas"; candado (cambiar usuario).
  - Plano de solo lectura escalado al ancho (posiciones/formas del plano web); mesas unidas como un bloque; cada mesa máx. 3 líneas con "…": número, "N pers · 25 min" o estado, mesero.
  - `ReadyBanner`: "Pedido listo · Mesa N" con punto ámbar, sin borde lateral; vibración; toque abre el pedido.
  - Refresco en vivo: `ORDER_UPDATE`, `TABLE_STATUS_CHANGED`, `ORDER_READY`, `KITCHEN_NOTIFICATION` → refetch con antirrebote 300 ms.
- [ ] **Step 1: Tests que fallan:** `maps operationalState to the four border states`; `Mis mesas filters by order.user.id`; `area tabs show counts`; `tile text never exceeds three lines`; `ready banner appears on KITCHEN_NOTIFICATION and opens the order`; `ORDER_UPDATE triggers one debounced refetch`.
- [ ] Steps 2–4. **Step 5:** Commit `feat(mobile): waiter tables view`.

### Task 8: Abrir mesa y acciones de mesa

**Files:**
- Create: `mobile/src/features/waiter/tables/OpenTableSheet.tsx`, `TableActionsSheet.tsx`, `useTablePicking.ts`
- Test: `*.test.tsx`

**Interfaces:**
- Produces:
  - Toque en mesa libre → hoja "Mesa N · área · capacidad": personas 1–7 + "Más" (números > capacidad atenuados con sugerencia de unir), botón **"Abrir y tomar pedido"** → `createOrder({tableId, guests})` → POS.
  - Toque en ocupada → POS. Mantener presionado (500 ms) → hoja de acciones: mesa, área, mesero, total sin cobrar; chips (personas, tiempo, nº productos, en cocina); **Ver pedido** / **Cobrar** (solo con `payments.process`+`invoices.issue`); mosaico **Trasladar** (`tables.transfer`) / **Unir** (`tables.group.manage`) / **Factura** (`invoices.issue`).
  - Trasladar/Unir: modo "elige la mesa destino" sobre el plano; requiere conexión.
- [ ] **Step 1: Tests que fallan:** `opening sends guests and navigates to the order`; `actions sheet hides buttons without permission`; `transfer completes by tapping a destination table`; `offline shows "requiere conexión" for transfer`.
- [ ] Steps 2–4. **Step 5:** Commit `feat(mobile): open table and table actions`.

### Task 9: Pantalla de pedido (POS) y enviar a cocina

**Files:**
- Create: `mobile/src/features/waiter/order/OrderScreen.tsx`, `CategoryRail.tsx`, `ProductGrid.tsx`, `ModifierSheet.tsx`, `TicketPanel.tsx`, `useOrderDraft.ts`
- Test: `*.test.tsx`, `useOrderDraft.test.ts`

**Interfaces:**
- Produces:
  - Barra superior: volver, mesa, personas, tiempo, búsqueda, usuario.
  - Riel vertical de categorías (texto, sin color): **Top** (Task 3), **Promos** (productos con promoción vigente según `@web/utils/promotionRules`), luego las visibles (`isCategoryVisibleInMenu`).
  - Productos grandes con nombre, precio, ×N en ticket y etiqueta de promo (2x1, Combo, −20 %). Toque = +1; mantener = nota/modificador; si `_count.modifierGroups > 0` con `minSelect ≥ 1`, abre `ModifierSheet` (carga `menuItem(id)` con caché).
  - `useOrderDraft(userId, tableId)`: líneas "Nuevo" locales (agrupa iguales con mismos modificadores y nota), persistidas en `drafts`; `send()` = `addItem` por línea + `sendToKitchen` con llaves idempotentes por acción; si la mesa no tiene pedido en servidor, `createOrder` con todas las líneas (contrato web).
  - Ticket: "Nuevo · sin enviar" arriba (− N + y chips de notas) y "En cocina" de solo lectura; pie fijo con total, **"Enviar a cocina · N"**, **Cobrar** (permiso), **Dividir** (`bills.split`), **Descuento** (`orders.discount.apply`), **⋯**.
- [ ] **Step 1: Tests que fallan:** `tap adds one and highlights the line`; `required modifier opens the sheet before adding`; `identical lines group, different notes don't`; `send posts lines then one send-to-kitchen; double tap sends once`; `draft survives a user switch and is not visible to another user`; `Top rail uses top sellers order`.
- [ ] Steps 2–4. **Step 5:** Commit `feat(mobile): order screen and send to kitchen`.

### Task 10: Ticket largo, entregar listos y ticket completo

**Files:**
- Create: `mobile/src/features/waiter/order/TicketList.tsx` (virtualizada), `TicketRow.tsx`, `ReadyCard.tsx`, `FullTicketScreen.tsx`
- Test: `*.test.tsx`

**Interfaces:**
- Produces:
  - Filas uniformes: insignia de cantidad 26 dp, nombre + 2ª línea atenuada (nota/modificador), precio alineado a la derecha con cifras tabulares; fila seleccionada se expande con stepper − N + grande y Nota/Quitar (solo una a la vez); editar cantidad de una línea **sin enviar** del servidor usa `updateItem`.
  - "Enviado · N" en una tarjeta con tres líneas por estado (Listo · ámbar, En preparación, Entregado · atenuado).
  - `ReadyCard` arriba del ticket: "Listo para entregar · N · hace X min", check de 44 dp por producto y **"Entregar todo · N"** → `deliverItems`.
  - `FullTicketScreen` horizontal de dos paneles: filtros en lista vertical con conteo (Todo, Nuevo, Listos, En preparación, Entregados) + Dividir/Cobrar abajo; lista con columnas fijas cantidad · producto · estado · precio · acción ("Entregar" 40 dp); pie "Entregar listos · N" y "Enviar a cocina · N".
- [ ] **Step 1: Tests que fallan:** `renders 40 lines with the footer visible and only visible rows mounted`; `only one row expanded at a time`; `deliver all sends the ready item ids once`; `full ticket filters show counts`; `ready line action is a button, never a text link`.
- [ ] Steps 2–4. **Step 5:** Commit `feat(mobile): long ticket, deliver ready items and full ticket`.

### Task 11: Promociones y descuentos con autorización de supervisor **[CRÍTICA]**

**Files:**
- Create: `mobile/src/features/waiter/discount/DiscountSheet.tsx`, `SupervisorAuthScreen.tsx`, `discountMath.ts`
- Test: `*.test.tsx`, `discountMath.test.ts`

**Interfaces:**
- Produces:
  - Hoja horizontal de dos paneles: izquierda (~250 dp) promociones vigentes aplicables (informativas) + **campo de cupón** (`validateCoupon` como vista previa, luego `pricing({discountCode})`); derecha selector %/Monto, valores rápidos 5/10/15/20 % + "Otro" (teclado en la misma hoja), **motivo obligatorio** en rejilla 3×2 (Cortesía, Cliente frecuente, Error de cocina, Demora, Otro), "Tu límite: X %" (`discountLimit`), nuevo total; pie "Quitar descuento" / "Aplicar descuento". Nada se desborda a 1280×800 ni 1024×600.
  - Si `pricing` responde `DISCOUNT_AUTH_REQUIRED` → `SupervisorAuthScreen`: izquierda descuento grande, barra límite vs. solicitado (exceso ámbar), motivo, subtotal y nuevo total; derecha avatares de `supervisors()`, puntos de PIN y teclado; pie Cancelar / "Autorizar N %" → `authorizeDiscount`. El PIN se borra de memoria al terminar o cancelar. No cambia la sesión activa.
  - Pie del ticket: Subtotal, Descuento con chip del motivo, Total.
  - Requiere conexión (mensaje claro si no hay).
- [ ] **Step 1: Tests que fallan:** `percent and amount compute the same new total as the server rule`; `reason is required before applying`; `over-limit opens supervisor auth with requested and limit`; `wrong PIN shows the generic error and clears digits`; `successful authorization refreshes the order and keeps the current user`; `layout fits 1024×600 without overflow` (medidas en jsdom con estilos de tamaño fijo).
- [ ] Steps 2–4. **Step 5:** Commit `feat(mobile): coupons and manual discounts with supervisor PIN`.

### Task 12: Cobro (cajero con PIN) **[CRÍTICA]**

**Files:**
- Create: `mobile/src/features/waiter/payment/PaymentScreen.tsx`, `SinglePayment.tsx`, `MixedPayment.tsx`, `SplitPayment.tsx`, `PaymentDone.tsx`, `paymentFlow.ts`
- Test: `*.test.tsx`, `paymentFlow.test.ts`

**Interfaces:**
- Consumes: `@web/utils/payment`, `@web/utils/paymentAccess` (`hasUsableCashShift`).
- Produces:
  - Visible solo con `payments.process` + `invoices.issue`. Si el usuario es mesero, el botón Cobrar no aparece (el cajero entra con su PIN y abre la mesa).
  - `paymentFlow`: (1) propina opcional vía `pricing({tipAmount})`; (2) cliente fiscal: "Consumidor final" por defecto, "Cambiar" = captura manual → `PATCH fiscal-customer`; (3) `preinvoice` (una vez); (4) un `createPayment` por tramo con llave idempotente propia y `payerName` en división; tramos confirmados nunca se repiten.
  - Header 48 dp: volver, "Cobrar · Mesa N", **Un pago / Varios métodos / Dividir**. Tres columnas: resumen (~31–36 %: productos, IVA, descuentos, total grande, "Factura a nombre de", aviso de emisión) · métodos 2×2 de 44–64 dp (icono + nombre) y montos rápidos 2×2 (Exacto + billetes sugeridos) · Recibido/Cambio (ámbar) y teclado; tarjeta/transferencia piden referencia.
  - Efectivo exige turno de caja activo del usuario (`cashShiftStatus`); si no hay, mensaje "Abre tu turno de caja" (la caja es Fase 2b).
  - Varios métodos: tramos con barra asignado/falta. Dividir: Iguales (nº partes), **Por productos** (toque producto → toque persona; cantidades > 1 por unidades; tarjetas por persona con su Cobrar; "+ Persona"), Por monto.
  - `PaymentDone`: check, "Mesa N cobrada", nº de factura (o aviso si `fiscalInvoiceError`), método, **cambio** grande, Imprimir/Enviar (solo si ya existe en web; si no, ocultos), **"Liberar mesa y volver"**.
- [ ] **Step 1: Tests que fallan:** `cash change is computed from received`; `preinvoice is called once even on retry`; `split by items assigns units and charges each person with its own key`; `network drop after leg 2 retries only the pending leg`; `cash without an active shift is blocked with the message`; `button hidden for a waiter without payments.process`.
- [ ] Steps 2–4. **Step 5:** Commit `feat(mobile): payment with single, mixed and split modes`.

### Gate de Fase 2

- [ ] `cd server && npx tsc --noEmit && npm run test:unit` verde.
- [ ] `cd mobile && npx vitest run && npx tsc --noEmit && npm run build` verde; JS inicial ≤ 250 KB gzip (pantallas del mesero en chunks diferidos si hace falta).
- [ ] Ensayo de migraciones en MySQL (`20261120_operational_devices_pin` y `20261121_waiter_mode`).
- [ ] En tablet real (cuando haya Android Studio): pedido completo de punta a punta — abrir mesa, pedir con modificador, enviar, cocina marca listo (web KDS), entregar, descuento con autorización, cajero cobra dividido; repetir con Wi-Fi apagado durante el pedido.
- [ ] Medir % de uso semanal consumido por la Fase 2.

## Lo que queda fuera (fases posteriores)

- Promociones automáticas (happy hour, 2x1, combos sin código).
- Búsqueda de cliente fiscal; anular líneas enviadas desde la tablet (sigue en web con `orders.items.void`).
- Caja (Fase 2b), cocina en tablet (Fase 3), Mi cuenta (Fase 4), NPS e inventario (Fase 5).
