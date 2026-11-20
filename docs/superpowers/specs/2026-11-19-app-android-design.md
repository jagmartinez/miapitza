# App Android operativa — Documento de diseño

Fecha: 2026-11-19 · Estado: borrador para aprobación

## 1. Intención y por qué

El restaurante opera hoy con la app web (React + Vite) sobre el backend Express + Prisma + MySQL. En el piso, la operación real ocurre en dispositivos Android:

- **Meseros** atienden con **tablets compartidas**: abren mesa, toman pedido, envían a cocina, reciben aviso de "listo" y, según permisos, cobran/dividen/trasladan.
- **Cocina** tiene una **tablet fija** donde se ven y avanzan los pedidos (KDS).
- **Cada empleado**, desde **su propio celular**, marca asistencia (biometría facial + geocerca), consulta su información, horario y recibos de nómina, y solicita permisos/vacaciones, horas extra, correcciones de marcaje y préstamos.

La app debe ser **intuitiva, rápida y de pocos toques**, y funcionar fluida en tablets **de gama baja**.

## 2. Objetivos

1. Una sola app Android (un APK) que muestra módulos según **rol y permisos existentes**.
2. **Modo Mesero (tablet compartida):** plano de mesas → pedido → envío a cocina → cobro, en el mínimo de toques.
3. **Modo Cocina (tablet fija, kiosco):** KDS a pantalla completa, tiempo real, botón grande por tarjeta.
4. **Mi centro de cuenta (celular personal):** Marcar, Mi información, Mi horario, Mi nómina, Solicitudes (permisos/vacaciones, horas extra, correcciones), Préstamos.
5. **Login rápido por PIN** en tablets compartidas, con bloqueo automático por inactividad y trazabilidad del mesero que hizo cada acción.
6. Rendimiento fluido en el **mínimo conservador: Android 9 (API 28), 2 GB RAM**, ajustable tras probar en el hardware real.

## 3. No objetivos

- Administración (inventario, compras, recetas, reportes, configuración, administración de RH, nómina de terceros, editor de plano de mesas). Siguen en la web.
- iOS (Capacitor lo permitiría después, pero no se diseña ni prueba ahora).
- Publicación en Google Play en la primera entrega (distribución por APK firmado / MDM; Play es decisión posterior).
- Reescribir reglas de negocio en el cliente: el backend sigue siendo la fuente de verdad (pagos, facturación, permisos, nómina).

## 4. Anti-objetivos (sería un fracaso aunque "funcione")

- Que tomar un pedido requiera más toques que en la web o ventanas modales encadenadas.
- Que se sienta lenta en la tablet real (pantallas > ~300 ms en abrir, scroll con tirones).
- Que una tablet compartida deje acciones a nombre del mesero equivocado.
- Que la app permita algo que el backend negaría (o esconda algo que el usuario sí puede hacer): los permisos de la UI deben derivarse de los del servidor.
- Que el KDS muestre "sin pedidos" cuando en realidad hay un error de red/permiso (ya corregido en web; no repetir).

## 5. Restricciones y realidad del sistema actual

- **Auth:** el backend acepta `Authorization: Bearer <jwt>` además de cookie; con Bearer no aplica CSRF (`middlewares/csrf.ts`). Sesiones revocables (`SessionService`, `UserSession`). Hay 2FA para web.
- **Permisos nominales** ya existentes y aplicados en rutas: `tables.*` (map.view, status.manage, transfer, consolidate, group.manage…), `orders.*` (create, edit, view, cancel, deliver, items.void), `payments.process/reverse`, `invoices.issue/view/cancel/credit`, `bills.split`, `kds.view/manage`, `hr.*.self` (attendance, biometric, schedule, payroll, benefits, workforce). Roles: SUPERADMIN, ADMIN, CAJERO, MESERO, HOST, COCINA, CHEF, BODEGA. El token de sesión trae `permissions[]`.
- **Tiempo real:** WebSocket (`ws`) en `services/websocket.service.ts`; hoy autentica por cookie `auth_token` en el handshake.
- **CORS** con lista blanca de orígenes (`app.ts`).
- **Flujos ya resueltos en web** (no reinventar): factura obligatoria antes de cobro, idempotencia de pagos/órdenes, división por unidades, traslado/consolidación de mesas, KDS con iniciar/listo/liberar, notificaciones al mesero (`kitchen-notification.routes.ts`), cola offline Dexie con política (`services/offlinePolicy.ts`, `offlineManager.ts`).
- **RH autoservicio** ya expuesto: `/me/attendance/today`, `/attendance/punches` (con foto facial), `/biometrics/challenges|enroll|me`, `/me/workforce`, `/me/attendance/summary`, `/leave/*`, `/overtime/requests`, `/attendance/corrections`, nómina self (`hr.payroll.self`), préstamos (`HrLoan`, cuotas, ledger; permisos `hr.benefits.self`). Reglas: RH aprueba el primer enrolamiento biométrico.
- **No existe login por PIN** → requiere cambio en backend.

## 6. Enfoques considerados

| Enfoque | A favor | En contra | Decisión |
|---|---|---|---|
| **A. Capacitor + React/TS (app móvil nueva)** | Reusa `api`, tipos, cola offline, WS, lógica de cobro/división; mismo equipo y lenguaje; plugins nativos para cámara, GPS, push, kiosco | Render en WebView: riesgo en gama baja si no se cuida el peso | **Elegido por el usuario** |
| B. Kotlin + Jetpack Compose | Máximo rendimiento e integración nativa | Reescribe toda la lógica de cliente; riesgo de divergir de la web auditada | Descartado |
| C. React Native / Expo | UI nativa, comparte tipos | No reusa componentes; casi el costo de B | Descartado |
| PWA / TWA | Cero instalación | Débil en kiosco, geocerca y notificaciones confiables | Descartado |

**Mitigación del riesgo de rendimiento (requisito, no opcional):**
- App **separada** del bundle web (`mobile/` propio), sin recharts, sin módulos de administración; división de código por módulo (Mesero / Cocina / Mi cuenta).
- Estética **plana**: sin `backdrop-filter`, sombras pesadas ni animaciones largas; listas virtualizadas; imágenes de producto opcionales y pequeñas.
- Menú, modificadores y plano de mesas **cacheados localmente** al iniciar turno; actualizados por WS/versión.
- **Fase 0 (prototipo desechable)** en la tablet real antes de construir el resto: si no cumple los presupuestos de §9, se revisa el enfoque.

## 7. Diseño decidido

### 7.1 Una app, tres modos según dispositivo y permisos

Al configurar un dispositivo (una vez, por un ADMIN) se define su **tipo**:

- **Tablet de servicio (compartida)** → pantalla de PIN → Modo Mesero.
- **Tablet de cocina (kiosco)** → Modo Cocina, siempre visible.
- **Personal** (default al instalar en un celular) → login usuario/contraseña normal → Mi centro de cuenta.

Dentro de cada modo, lo visible se deriva de `permissions[]` del servidor. Un CAJERO en tablet de servicio ve además Cobrar; un MESERO sin `payments.process` no ve el botón. Todo usuario con empleado vinculado ve "Mi cuenta" en su celular.

### 7.2 Login rápido por PIN (tablets compartidas)

- Cada usuario operativo tiene un **PIN de 4–6 dígitos** (hash en servidor), definido por él mismo desde "Mi cuenta" o asignado por ADMIN.
- La tablet compartida está **registrada** (token de dispositivo atado a sucursal). El PIN solo es válido en dispositivos registrados de su sucursal → `POST /auth/pin-login` con `{deviceToken, pin}` devuelve una sesión normal (JWT + `UserSession`) del usuario.
- **Cambio de mesero en un toque**: botón "Cambiar usuario" siempre visible; **bloqueo automático** tras inactividad (default 2 min, configurable por sucursal); la sesión anterior se cierra/suspende al cambiar.
- Protecciones: límite de intentos por dispositivo y por usuario (reusar `LoginAttempt`), PIN no reutiliza contraseña, revocación del dispositivo desde la web.
- Toda acción queda a nombre del usuario del PIN (ya ocurre, porque cada request lleva su JWT).
- **PIN solo para roles operativos** (MESERO, CAJERO, HOST). ADMIN/SUPERADMIN no usan PIN en tablets compartidas; entran con contraseña (+2FA si lo tienen). *[decisión del diseñador: el PIN no debe saltarse 2FA de cuentas administrativas]*
- **Al bloquear o "Cambiar usuario"**: la sesión del mesero anterior se **revoca** (no se mantiene en segundo plano); un pedido **no enviado** se guarda como borrador en el dispositivo asociado a ese mesero y se le ofrece al volver a entrar con su PIN; no pasa al siguiente usuario. *[decisión del diseñador]*
- **Mesas compartidas** *(decidido por el usuario)*: cualquier mesero de la sucursal puede agregar, cobrar o atender cualquier mesa (según sus permisos). Cada acción queda a nombre de quien la hizo. "Mis mesas" es solo un filtro por mesas con órdenes creadas por ese usuario (`Order.userId`); no se crea dueño de mesa.

### 7.3 Modo Mesero (tablet)

Flujo objetivo (toques):
1. PIN → **Vista de mesas** de su sucursal:
   - Usa el **plano persistente** de la web (`GET /api/tables/plan/:branchId`: áreas, posiciones, formas, mesas unidas); en la app es **solo lectura** (editar sigue en web).
   - **Header en una sola fila** *(opción A, elegida por el usuario)*: avatar con iniciales + nombre y "sucursal · N mesas activas"; separador; **pestañas de área con subrayado** y conteo de mesas (Salón 9 / Terraza 6 / Barra 4); chip **"Mis mesas"** (activa/desactiva el filtro); botón de **candado** para cambiar usuario.
   - Cada mesa muestra en **máximo tres líneas cortas**: número, "personas · tiempo" (o el estado) y mesero; el texto se recorta con "…" y nunca desborda la figura. El **estado se marca por el borde** (gris libre, blanco ocupada, ámbar pedido listo, rojo suave por cobrar). Mesas unidas se ven como un solo bloque.
   - **Banner** de "Pedido listo" arriba del plano (además de la vibración), con un punto ámbar y sin borde lateral de color, con acceso directo.
   - **Sin panel de leyenda/resumen ni chip "Por cobrar"**: el plano ocupa todo el ancho; el estado se lee en cada mesa. El único filtro del header es "Mis mesas". *(Revisado con el usuario.)*
   - **Toque en mesa libre** → hoja inferior "Mesa N · área · capacidad": cuadrícula de personas 1–7 + "Más" (números por encima de la capacidad atenuados, con sugerencia de unir mesas), botón principal **"Abrir y tomar pedido"**. **Toque en mesa ocupada** → su pedido.
   - **Mantener presionada** → hoja inferior de acciones: encabezado con mesa, área, mesero y **total sin cobrar**; chips de contexto (personas, tiempo, nº de productos, en cocina); dos botones grandes **Ver pedido** (secundario) y **Cobrar** (principal); fila de acciones secundarias en mosaico **Trasladar / Unir / Factura**. Todo según permisos. Trasladar/unir se completan tocando la mesa destino en el plano.
   - Actualización en vivo por WebSocket cuando otro mesero cambia una mesa.
2. Toca mesa → se abre la **pantalla de pedido a pantalla completa** (v2, revisada con el usuario; el plano no comparte pantalla con el pedido). Mesa libre pide nº de personas en un toque.
3. **Pantalla de pedido (POS v2)**:
   - Barra superior: volver, mesa, personas, tiempo transcurrido, **búsqueda** de producto, usuario activo.
   - **Riel vertical de categorías** a la izquierda, con color por categoría; la primera es **"Top"** (más vendidos de la sucursal).
   - Cuadrícula central de **productos grandes** con nombre, precio y color de su categoría; el producto muestra su cantidad en el ticket (×N). **Toque = +1; mantener presionado = nota/modificador**; si el producto exige modificador, se abre una hoja inferior (no modal encadenado).
   - **Ticket a la derecha** separado en "Nuevo · sin enviar" (con − N + y chips de notas) y "En cocina" (solo lectura, con estado).
   - Pie del ticket: total, botón principal **"Enviar a cocina · N"**, y secundarios **Cobrar**, **Dividir** y **⋯** (trasladar, unir, factura), visibles según permisos.
   - **Ticket con muchos productos** (debe seguir siendo cómodo con 30+ líneas):
     - **Pie fijo**: total, "Enviar a cocina · N", Cobrar/Dividir/⋯ siempre visibles; solo la lista hace scroll (lista virtualizada).
     - **"Nuevo" siempre arriba**; al agregar, la línea se resalta brevemente y la lista se desplaza hasta ella.
     - **Encabezado del ticket**: "Ticket" + "mesa · personas · N productos" y botón de expandir.
     - **Filas uniformes**: insignia de cantidad (cuadro 26 dp), nombre con nota/modificador en una segunda línea atenuada, y precio **alineado a la derecha con cifras tabulares** ("C$ 640"). Productos iguales con los mismos modificadores se agrupan.
     - **Fila seleccionada** se expande en una tarjeta: nombre y precio, **stepper − N +** grande y acciones Nota / Quitar. Solo una fila expandida a la vez.
     - **Lo enviado** va en una sola tarjeta "Enviado · N" con tres líneas por estado (Listo para entregar · ámbar, En preparación, Entregado · atenuado), cada una con conteo y flecha para ver el detalle.
     - Pie: total destacado, "Enviar a cocina · N" y Cobrar / Dividir / ⋯.
     - **Ver ticket completo (horizontal)**: pantalla completa en **dos paneles**: a la izquierda los **filtros en lista vertical** (Todo, Nuevo, Listos, En preparación, Entregados, con conteo) y abajo Dividir / Cobrar; a la derecha la lista con columnas fijas cantidad · producto · estado · precio · acción, donde los listos tienen un **botón "Entregar" de 40 dp** (nunca enlace de texto); pie con "Entregar listos · N" y "Enviar a cocina · N". (Versión anterior, reemplazada: encabezado con mesa, personas, mesero, tiempo, total y nº de productos; **filtros en chips** (Todo, Nuevo, Listos, En preparación, Entregados); productos **agrupados por envío** con hora y subtotal; columnas fijas cantidad · producto · estado · precio; "Entregar" directo en los listos; pie con Dividir, Cobrar y "Enviar a cocina · N".)
     - **Listo para entregar en el ticket lateral**: cada grupo listo es una tarjeta ámbar compacta con "N × producto · Listo hace X min" y botón **Entregar** de 40 dp a la derecha; lo enviado se resume en una fila "Enviado · N · Ver" que abre el ticket completo.
   - **Entregar listos**: cuando hay productos listos, aparece **arriba del ticket** una tarjeta con borde ámbar "Listo para entregar · N · hace X min", cada producto con un **botón de check de 44 dp** y un botón principal ancho **"Entregar todo · N"**. En la vista de ticket completo, los listos usan el mismo botón de 44 dp en una columna fija (nunca un enlace de texto).
4. **"Enviar a cocina"** (botón principal del ticket, con contador).
5. Aviso de **"Pedido listo"** (WS + vibración + banner) → toca → "Entregado".
6. Acciones de mesa (según permisos): agregar más, trasladar, unir, dividir cuenta, pedir factura, **Cobrar** (reutiliza la lógica web de factura→pago e idempotencia).

### 7.3.0 Promociones y descuentos en el POS

Reutiliza lo que ya existe en backend: promociones automáticas (`Promotion` con `scope` ORDER/ITEMS, happy hour por `weekdays`/`dailyStartTime`/`dailyEndTime`, `BUY_X_GET_Y`, `COMBO`, por sucursal), cupón por código (`POST /promotions/validate`, `Order.discountCode`) y descuento manual con tope de empresa `${companyId}_maxManualDiscountPercent`.

- **Visibilidad automática**: los productos con promoción vigente llevan una etiqueta discreta (2x1, Combo, −20 %); categoría "Promos" en el riel; chip en el header "Happy hour hasta HH:MM" cuando aplica. En el ticket, la línea promocionada muestra debajo "2x1 happy hour · −C$ X".
- **Pie del ticket**: Subtotal, **Promociones** (suma), **Descuento** con chip del motivo, Total; botón secundario **Descuento** junto a Cobrar y Dividir.
- **Hoja "Promociones y descuentos"** (horizontal, dos paneles): izquierda — aplicadas automáticamente (con monto), disponibles (con lo que falta para calificar) y campo de **código de cupón**; derecha — **descuento manual** en % o monto, chips rápidos (5/10/15/20 %), **motivo obligatorio** en chips (Cortesía, Cliente frecuente, Error de cocina, Demora, Otro) y teclado; muestra "Tu límite: X %" y el nuevo total.
- **Distribución de la hoja (revisada)**: panel izquierdo de promociones (~250 dp); panel derecho con selector %/Monto, **fila de valores rápidos** (5/10/15/20 % + "Otro") y **motivos en rejilla 3×2 de botones iguales**; **sin teclado permanente**: "Otro" abre el teclado en la misma hoja (valor grande, aviso si supera el límite, Cancelar/Listo). Pie: nuevo total, "Quitar descuento" y "Aplicar descuento". Nada se desborda a 1280×800 ni a 1024×600.
- **Pantalla de autorización (revisada)**: izquierda — descuento solicitado en grande, **barra límite vs. solicitado** (exceso en ámbar), motivo, subtotal y nuevo total; derecha — **avatares de supervisores**, puntos de PIN y teclado; pie Cancelar / "Autorizar N %".
- **Autorización**: si el descuento supera el límite del usuario o no tiene permiso, aparece "Se necesita autorización" y un **supervisor autoriza con su PIN en la misma tablet**, sin abrir sesión ni cambiar de usuario; queda auditado (quién pidió, quién autorizó, monto, motivo). *[decisión del diseñador: el PIN de autorización es distinto del login por PIN; lo pueden usar usuarios con el permiso nuevo `orders.discount.authorize`, incluido ADMIN, porque no abre sesión]*
- **Backend nuevo**: permisos `orders.discount.apply` y `orders.discount.authorize`; límite por rol (`maxManualDiscountPercent` por rol, con el de empresa como techo); `discountReason` y `discountAuthorizedById` en `Order`; endpoint de autorización por PIN de supervisor.
- La propina (`tipAmount`) se mantiene como hoy en el cobro.

### 7.3.1 Cobro (pantalla completa, horizontal)

Reutiliza las reglas de la web (`PaymentModal`): modos **Un pago / Varios métodos / Dividir cuenta**; división **Iguales / Por productos / Por monto**; factura obligatoria antes del pago; métodos por `type` (CASH, CARD, BANK_TRANSFER, OTHER) con referencia para tarjeta/transferencia; idempotencia; cobros divididos secuenciales.

- **Header en una sola fila de 48 dp** (sin textos que se partan en dos líneas): volver, "Cobrar · Mesa N" y selector de modo **Un pago / Varios métodos / Dividir**. La forma de dividir (**Iguales / Productos / Monto**) va **dentro del contenido**, en el panel izquierdo, no en el header.
- **Tres columnas en horizontal**: resumen (~31 %) · método y montos rápidos (centro) · recibido, cambio y teclado (~30 %). Métodos en mosaicos de **icono + nombre en línea, 2×2, 44 dp**; montos rápidos en **2×2 de 40 dp** con el símbolo de moneda, nunca recortados.
- **Layout (detalle)**: **Panel izquierdo (~36 %)**: resumen (productos, IVA, descuentos), **total grande**, "Factura a nombre de" (Consumidor final por defecto; "Cambiar" abre búsqueda/alta de cliente fiscal), aviso "se emite la factura al confirmar". **Panel derecho**: mosaicos de método (64 dp) y, para efectivo, **montos rápidos** (Exacto + billetes redondeados sugeridos) y **teclado numérico** grande, con **Recibido** y **Cambio** (ámbar) en grande. Tarjeta/transferencia muestran campo de referencia en lugar del teclado de recibido.
- **Pie**: botón principal ancho **"Cobrar C$ X"**.
- **Varios métodos**: lista de tramos (método + monto) con barra "asignado / falta", mismo teclado.
- **Dividir · por productos**: izquierda "Sin asignar" (toque producto → toque persona; cantidades > 1 se reparten por unidades); derecha **tarjetas por persona** (productos, subtotal, botón **Cobrar** propio; "Pagado" al completar; "+ Persona"). Pie con pagado / pendiente. **Iguales**: elegir nº de partes; **Por monto**: teclado por persona.
- **Confirmación**: check, "Mesa N cobrada", nº de factura y método, **cambio a entregar** en grande, Imprimir / Enviar, y principal **"Liberar mesa y volver"**.
- Solo visible con `payments.process`; reversión (`payments.reverse`) queda en web o en ⋯ según permisos.

### 7.3.2 Orientación y tamaños

- La tablet de servicio y la de cocina operan **siempre en horizontal** (orientación bloqueada en la app para esos modos); el celular de "Mi cuenta" en **vertical**.
- Objetivos táctiles **mínimo 48 dp** (44 dp solo en controles secundarios dentro de listas); botón principal ≥ 52 dp de alto.
- Layouts horizontales de 2–3 paneles con anchos mínimos: ticket ≥ 280 dp, panel de resumen de cobro ≥ 300 dp; en tablets de 7" la cuadrícula de productos baja a 2–3 columnas en lugar de comprimir el ticket.

### 7.3.2b Caja: apertura, movimientos, arqueo y cierre (tablet de servicio, CAJERO con PIN)

Reutiliza el backend existente: `POST /cash-shifts/open` (caja + `startAmount`), `GET /cash-shifts/active-status`, `GET /cash-shifts/:id/summary`, `POST /cash-shifts/:id/movements` (`IN`/`OUT` con tipo de documento FACTURA / RECIBO_GASTO / RECIBO_CAJA), arqueo `POST /cash-arqueo/:shiftId/count` (billetes, monedas, billetes USD + tipo de cambio), `preview-close`, `close` (`endAmount`, conteo, `notes`, `forceClose`) y `report`. Solo visible para quien tenga los roles/permisos de caja actuales (CAJERO, ADMIN, SUPERADMIN).

- **Abrir turno**: si el usuario no tiene turno abierto, la caja empieza aquí: elegir **caja** (las ocupadas se ven atenuadas con quién la tiene), **fondo inicial** grande con chips rápidos (sugerido = fondo del último cierre) o "Contar billetes", teclado, botón "Abrir turno con C$ X".
- **Turno activo**: header con caja, estado, quién y desde cuándo, y acciones **Entrada / Salida / Arqueo parcial**; tarjetas de **Ventas, Efectivo, Tarjeta, Transferencia**; lista de **movimientos de efectivo**; panel derecho **"Efectivo en caja"** (fondo + ventas en efectivo + entradas − salidas = **Debe haber**) y botón principal **Cerrar turno**. Se accede desde el header de la vista de mesas (icono de caja) para usuarios con caja.
- **Entrada / salida**: hoja única con selector Entrada/Salida, monto grande + teclado, **motivo** en chips (Compra menor, Retiro a gerencia, Pago a proveedor, Otro), **tipo de documento** y descripción.
- **Resumen del turno activo**: cuatro tarjetas de igual ancho (Ventas con nº de cobros; Efectivo, Tarjeta, Transferencia con % del total); montos en **una sola línea** (sin cortes) con cifras tabulares.
- **Arqueo y cierre (NIO + USD a la vez)**: header con caja, cajero y **tipo de cambio del día** (C$ por US$, del ajuste de moneda existente; se guarda como `closingExchangeRate`). Dos columnas simultáneas: **Córdobas** (billetes 1,000 · 500 · 200 · 100 · 50 · 20 · 10 y monedas) y **Dólares** (billetes 100 · 50 · 20 · 10 · 5 · 1, con total US$ y su equivalente en C$). Cada denominación: cantidad (al tocarla se edita con teclado) y subtotal. Panel derecho: córdobas contados, dólares en C$, **total contado**, **debe haber**, **diferencia** (sobrante / faltante en rojo suave), **nota obligatoria si hay diferencia**, "Guardar arqueo" (parcial) y "Cerrar turno". Fórmula: debe haber = fondo + ventas en efectivo (incluye cobros en US$ convertidos) + entradas − salidas; total contado = C$ + US$ × TC.
- **Reporte de cierre (v2)** (al cerrar y desde **Caja › Historial de turnos**, usa `GET /cash-arqueo/:shiftId/report`): header con caja, nº de turno, cajero, horario y **etiqueta de resultado** (Cuadrado / Sobrante / Faltante C$ X). **Cuatro cifras clave** arriba: Ventas, Debe haber, Contado, Diferencia. **Tres tarjetas**: Ventas por método (+ descuentos y propinas), Efectivo (fondo, ventas efectivo, entradas, salidas → debe haber), Arqueo (córdobas, US$ y su equivalente con TC → contado, diferencia, nota). Pie: "Denominaciones", PDF, Enviar y principal **"Imprimir ticket"**.
- **Ticket de cierre impreso** (impresora térmica **80 mm, 48 caracteres**, fuente monoespaciada): encabezado (empresa, sucursal, RUC), **CIERRE DE CAJA** con caja, turno, cajero, apertura y cierre; **VENTAS** por método, total, descuentos, propinas; **EFECTIVO C$** hasta DEBE HABER; **ARQUEO** con TC, desglose por denominación en C$ y en US$ con su equivalente, CONTADO y **DIFERENCIA** con la palabra SOBRANTE/FALTANTE; nota; **líneas de firma** (cajero y supervisor) y pie "Impreso fecha hora · usuario". Separadores con guiones. La conexión con la impresora (Bluetooth/red ESC/POS) queda al constructor; si no hay impresora, se ofrece PDF.

### 7.3.3 Encuesta NPS del cliente (tablet del mesero) *(decidido por el usuario)*

- **Momento**: en la confirmación de cobro, botón secundario **"Pedir opinión"**. La tablet entra en **modo encuesta bloqueado** (sin navegación, sin volver atrás); al terminar o tras 60 s sin uso vuelve sola a la pantalla de PIN (la sesión del mesero se revoca, como en el bloqueo normal).
- **Pantallas** (horizontal, letra grande, < 30 s):
  1. NPS 0–10: "¿Qué tan probable es que nos recomiendes a un amigo?".
  2. Estrellas 1–5: **Atención de {nombre del mesero}**, **Servicio en general**, **Comida**; comentario opcional; **contacto opcional** (teléfono) — *anónima por defecto*.
  3. "¡Gracias por tu opinión!" → vuelve al PIN en 5 s.
- **Datos**: `SurveyResponse { companyId, branchId, orderId (único), waiterUserId, operationalDeviceId, nps 0–10, waiterRating 1–5, serviceRating 1–5, foodRating 1–5, comment?, contactPhone?, createdAt }`. Una respuesta por orden (idempotente). El teléfono solo se guarda si el cliente lo escribe.
- **Reportes (web)**: NPS = % promotores (9–10) − % detractores (0–6) por sucursal, mesero y período; promedios de las tres calificaciones; comentarios; alerta de detractores con contacto. Permiso nuevo `surveys.view` (ADMIN/SUPERADMIN).
- **Mi cuenta del mesero**: ve su propio promedio de "Atención" y su NPS del mes, sin comentarios individuales. *[decisión del diseñador]*
- El mesero no puede ver ni modificar la respuesta en la tablet después de enviarla.

### 7.3.4 Levantamiento de inventario (tablet de servicio) *(decidido por el usuario)*

- **Quién**: BODEGA y CHEF entran con **su PIN en la tablet de servicio** (se agregan a `PIN_ROLES`) y ven el módulo **Inventario** según el permiso nuevo `inventory.count`. No hay tablet dedicada.
- **Conteo ciego + aprobación**: quien cuenta **no ve la existencia del sistema**. Al terminar, el conteo pasa a **revisión**; un ADMIN (web) ve diferencias en cantidad y costo, puede pedir reconteo de productos y **aprueba** → se generan los ajustes de stock en una transacción reutilizando la lógica de conteo físico existente (`POST /inventory-movements/count`, movimientos `ADJUSTMENT`, kardex/FIFO).
- **Hoja de conteo** `InventoryCountSheet { companyId, branchId, warehouseId, status DRAFT|SUBMITTED|APPROVED|REJECTED, startedById, submittedAt, approvedById, approvedAt }` y líneas `InventoryCountLine { sheetId, productId, unit, countedQuantity, expectedAtCount (oculto al contador), countedById, countedAt }`. La existencia esperada se toma **en el momento de contar cada producto**, para que las ventas durante el conteo no distorsionen la diferencia.
- **Pantalla** (horizontal, **dos paneles**, revisada v3 — sin columna de categorías): sobre la lista, **una sola barra de controles** (v4): **selector de categoría** "Lácteos 9/14 ▾" que despliega la lista de categorías con barra de avance y check al completarse y **buscador** que ocupa el resto (sin filtro "Sin contar", retirado por el usuario) y filas de 40 dp con check de contado, nombre, unidad y cantidad ("—" si falta); derecha (sin repetir el nombre del producto: la fila seleccionada en la lista ya lo indica) **selector de unidad de conteo** (unidad base y conversiones existentes, p. ej. kg / g / bolsa), cantidad grande, **teclado con decimal** que usa el alto liberado (teclas más altas) y **"Guardar y siguiente"**. Header con bodega, una **etiqueta discreta "Ciego"** junto al título, quién cuenta, inicio e indicador "Guardado"; pie solo con **barra de avance general** y "Terminar conteo". **Guardado continuo** (se puede pausar y retomar; tolera cortes de red con la cola offline).
- **Flujo**: (1) BODEGA/CHEF entra con PIN y, si no tiene permisos de mesas, llega directo a **Inventario**: header con avatar, "Nuevo conteo" y candado; tarjeta **En curso** destacada (bodega, inicio, alcance, barra de avance, "Continuar") y **Recientes como tabla** con filtro Todos / En revisión / Aprobados y columnas bodega, fecha · quién, productos, **resultado** (nº de diferencias y valor, "Sin diferencias", "N a recontar") y estado (En revisión ámbar, Aprobado, **Devuelto** rojo suave cuando el admin pide reconteo). (2) **Nuevo conteo**: **bodegas en tarjetas** (icono, nº de productos, último conteo; deshabilitada si tiene un conteo en revisión), **qué contar** Todo / Elegir categorías (**rejilla de 3 columnas iguales con casilla**, nombre y nº de productos, opción "Seleccionar todas" y total "N categorías · N productos") y **resumen** a la derecha (bodega, categorías, productos, tipo ciego) con "Iniciar conteo". (3) Pantalla de conteo; el selector de categoría abre una **lista desplegable sobre los productos** (el resto se atenúa); elegir una categoría **cierra la lista y cambia los productos en la misma pantalla**. Un usuario con permisos de mesas e inventario ve "Inventario" como opción en el header de la vista de mesas.
- **Terminar**: resumen contados / sin contar; los no contados se envían como "no contados" (no se ajustan) o se vuelve a contarlos; **"Enviar a revisión"**.

### 7.4 Modo Cocina (tablet kiosco)

- **Identidad** *(decidido por el usuario)*: **cuenta fija de cocina por sucursal** (usuario rol COCINA, p. ej. "Cocina Bamboo"). La tablet inicia sesión una vez al registrarse y la sesión no expira por inactividad; se revoca desde la web revocando el dispositivo. Los campos `kitchenStartedById/ReleasedById` registran esa cuenta, no al cocinero individual.
- Pantalla completa, sin navegación, en **modo kiosco Android**: *lock task* real si el dispositivo se aprovisiona como propietario (device owner) o vía MDM; si no, **fijado de pantalla** (screen pinning) como alternativa. Pantalla siempre encendida.
- Tarjetas por pedido: mesa, mesero, tiempo transcurrido (color por demora), productos y notas visibles directamente.
- **Un botón grande por tarjeta** que avanza el estado: Iniciar → Listo. **Al tocar Listo la tarjeta desaparece de inmediato** y las demás se reacomodan *(decidido por el usuario)*; aparece un aviso "M6 lista · aviso a José · Deshacer (5 s)". Al vencer los 5 s se envía `ready` y luego `release` (la orden sale del tablero). Botón **"Listas recientes"** muestra las últimas ~10 para recuperar un error.
- Pedidos nuevos entran por WS con sonido; reconexión automática con indicador visible; si falla carga/permisos se muestra el error, nunca una cola vacía.
- Usa los mismos endpoints y permisos `kds.view/manage` que `/kds` web.

### 7.5 Mi centro de cuenta (celular)

**Orientado a acciones, no solo consulta** *(decidido por el usuario)*. El inicio tiene tres bloques:
1. **Marcar** (acción principal; entrada/salida según `/me/attendance/today`).
2. **Solicitar**: Permiso/vacaciones, Préstamo (`POST /me/loan-requests`, con límites de política y cálculo de cuota en vivo), Horas extra, Cambio de turno (`/swaps`), Corregir marcaje. Cada una es **un formulario de una sola pantalla**.
3. **Pendiente para ti**: confirmar horario publicado, recibos nuevos, respuestas a cambios de turno; y **Mis solicitudes** con estado y opción de cancelar mientras estén pendientes.
4. *(Solo si tiene permisos `*.approve`)* **Por aprobar**: aprobar/rechazar permisos, horas extra y cambios de turno de su equipo desde el celular. *[decisión del diseñador, a confirmar en el plan]*

Detalle de cada sección:
- **Marcar** *(solo celular personal, decidido por el usuario; las tablets compartidas no marcan asistencia)*: cámara frontal + ubicación → `/attendance/punches`. Si no está enrolado: flujo de enrolamiento (pendiente de aprobación de RH). Mensajes claros si está fuera de geocerca.
- **Mi información**: datos de empleado y contacto; cambiar contraseña y **definir/cambiar PIN**.
- **Mi horario**: semana actual y siguiente; confirmar horario.
- **Mi nómina**: recibos por período, descarga PDF.
- **Solicitudes**: permisos/vacaciones (con saldo), horas extra, correcciones de marcaje; estado de cada una.
- **Préstamos**: préstamos activos, cuotas y saldo; solicitar préstamo si la política lo permite.
- **Notificaciones push**: aprobación/rechazo de solicitudes, horario publicado.

### 7.6 Arquitectura técnica

- Nuevo paquete `mobile/` en el monorepo: React 18 + TypeScript + Vite + Capacitor (Android). Comparte con `client/` un paquete de código común (`shared/` o import directo) para: cliente API, tipos, política offline, lógica de cobro/división, cliente WS. Los componentes de UI son **propios de mobile** (táctiles, ligeros).
- **Backend** (cambios acotados):
  1. `POST /auth/pin-login`, gestión de PIN (`/me/pin`), registro/revocación de dispositivos operativos. Nuevo modelo **`OperationalDevice`** (sucursal, tipo `SERVICE_TABLET | KITCHEN_TABLET`, token hash, estado, revocación), separado de `AttendanceDevice` porque las tablets no marcan asistencia. *[decisión del diseñador]*
  2. WS: aceptar autenticación por token (mensaje inicial o query firmada de corta vida), no solo cookie.
  3. CORS: permitir el origen de Capacitor (`https://localhost` / `capacitor://localhost`).
  4. Push: registro de token FCM por usuario/dispositivo y envío en eventos ya existentes (pedido listo, decisiones de RH). **Si la tablet no tiene Google Play Services**, el aviso de "pedido listo" llega por WebSocket + notificación local (la app está en primer plano en turno); FCM queda para celulares personales. *[decisión del diseñador]*
  5. Login por contraseña en celular: soporta el paso de 2FA existente (`auth.service.ts`) para usuarios que lo tengan activo.
- **Token**: guardado en almacenamiento seguro nativo (Keystore vía plugin), nunca en `localStorage`.
- **Offline**: menú/plano en caché. La web ya encola offline `CREATE_ORDER`, `ADD_ORDER_ITEM`, `SEND_TO_KITCHEN` (POS.tsx) y `CREATE_PAYMENT` (PaymentModal) con `offlineMeta` e idempotencia; la app **reutiliza exactamente ese contrato y política** (código compartido), sin ampliarlo. Indicador visible de "sin conexión / N pendientes".
- **KDS deshacer (5 s)**: no hay endpoint de deshacer; se implementa como confirmación diferida en el dispositivo (la acción se envía al vencer los 5 s). *[decisión del diseñador]*
- **Distribución**: APK firmado, actualizaciones por instalación manual/MDM al inicio; evaluar actualización de contenido web en vivo después.

## 8. Fases

0. **Prototipo de rendimiento (desechable)**: plano de mesas + pedido + KDS con datos reales, en la tablet real. Gate: cumplir §9.
1. **Base**: proyecto `mobile/`, código compartido, auth Bearer con almacenamiento seguro, PIN + dispositivos en backend, WS por token, CORS.
2. **Modo Mesero**.
3. **Modo Cocina** + kiosco.
4. **Mi centro de cuenta** (Marcar primero, luego consultas y solicitudes, préstamos).
5. **Push, pulido, pruebas en piso** y despliegue a todas las tablets.

## 9. Presupuestos de rendimiento (mínimo Android 9 / 2 GB, a ajustar)

- Arranque en frío ≤ 3 s hasta pantalla de PIN.
- Abrir mesa / pantalla de pedido ≤ 300 ms con menú cacheado.
- Toque de producto → reflejado ≤ 100 ms.
- KDS: pedido nuevo visible ≤ 2 s tras enviarlo.
- JS inicial por modo ≤ ~250 KB gzip.

## 9.1 Lenguaje visual *(decidido por el usuario)*

- **Modo oscuro por defecto**, minimalista y sobrio: fondo casi negro, superficies grises escalonadas, bordes finos, sin sombras, degradados ni desenfoques (además ayuda al rendimiento).
- **Monocromo**: el texto y el botón principal en blanco roto; las categorías del POS **no usan color**, solo texto.
- **El color solo comunica estado**, con tonos apagados: gris = libre, blanco = ocupada, ámbar = pedido listo / notas de cocina, rojo suave = por cobrar / demora.
- Un solo botón principal por pantalla; los secundarios con contorno.
- **KDS**: tarjetas de una fila con **igual altura**; el botón Iniciar/Listo va **fijo al pie** de cada tarjeta para que todos queden alineados sin importar cuántos productos tenga.
- **Mi cuenta**: las opciones de "Solicitar" son **tarjetas** (icono, nombre y un dato útil: días disponibles, monto máximo…), en rejilla de dos columnas; "Mis solicitudes" también son tarjetas con estado, detalle y "Cancelar" mientras estén pendientes.
- Modo claro opcional más adelante; no es parte de la primera entrega.

## 10. Ejecución con agentes y presupuesto de uso

- Ejecución por agentes: implementador por tarea, revisor especialista, asesor transversal.
- **Agentes refutadores solo en tareas críticas** *(decidido por el usuario)*: login por PIN y dispositivos, cobro/factura/división, cola offline, autenticación WebSocket, KDS (listo/liberar). El resto lleva solo revisión normal.
- Optimización de tokens: implementadores con modelo intermedio para pantallas de consulta; modelo superior para asesor, tareas críticas y refutadores; tareas pequeñas y con contexto acotado.
- Se ejecuta **por fases**, midiendo el consumo real de la fase 0–1 para ajustar el resto al límite semanal del plan.

## 11. Dejado al constructor

- Librería de estado/caché, estructura de carpetas, plugins concretos de Capacitor (secure storage, kiosco, cámara, geolocalización, push).
- Diseño visual detallado dentro de los principios de §6/§7 (tokens planos, botones ≥ 48 dp, uso con una mano).
- Estrategia de pruebas (unitarias del código compartido, contrato de nuevos endpoints, e2e en emulador + prueba en tablet real).
