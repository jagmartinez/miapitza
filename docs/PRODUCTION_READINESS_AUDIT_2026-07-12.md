# Auditoría integral de preparación para producción

Fecha: 2026-07-12  
Repositorio: `C:\restaurant`  
Alcance: frontend React/Vite, API Express, Prisma/MySQL, despliegue, seguridad y procesos operativos.

## Decisión ejecutiva

**Estado final: GO productivo mediante despliegue controlado; API y web desplegadas con smoke productivo aprobado.**

Los bloqueadores encontrados en la primera auditoría fueron corregidos: las dependencias de runtime pasaron de 32 vulnerabilidades en el servidor y 11 en el cliente a **cero**, lint quedó sin errores ni advertencias, los builds pasan y se añadieron integraciones MySQL para los ciclos operativos y matemáticos críticos.

El respaldo, restore drill, baseline, reconciliación legacy, despliegue y smoke productivo fueron completados en ese orden. Ninguna revisión puede demostrar ausencia absoluta de defectos, pero los riesgos críticos identificados durante estas pasadas quedaron corregidos o delimitados explícitamente.

“Despliegue controlado” no significa que exista un bloqueador conocido ni que el sistema esté a medias. Es la disciplina normal de un GO profesional: respaldo restaurable, migraciones verificadas, observación de métricas y logs, pruebas de humo y capacidad de reversión. Se mantiene porque pruebas finitas no pueden garantizar matemáticamente la inexistencia de defectos desconocidos, especialmente bajo concurrencia, integraciones externas y comportamiento real de operadores.

## Cierre productivo ejecutado

- Backup consistente: `C:\tmp\miapitza-prod-20260712-v2.ndjson.gz`.
- Contenido: 61 tablas y 2,509 filas, capturadas con snapshot `REPEATABLE READ`.
- Restore drill: 61 tablas y 2,509 filas restauradas en `miapitza_restore_test`.
- Diff restaurado contra Prisma: cero diferencias.
- Baseline ensayado: 13 migraciones registradas en la restauración y estado `up to date`.
- Baseline productivo: 13 migraciones registradas; `migrate status` productivo quedó `up to date`.
- Reconciliación legacy:
  - 17 duplicados sin referencias fueron desactivados inicialmente y después eliminados físicamente mediante una transacción protegida;
  - antes de borrar se verificó individualmente que cada registro tuviera cero referencias en stock, movimientos, lotes, compras, recetas, historial de costos, unidades permitidas, modificadores y producción;
  - el procedimiento se ensayó primero sobre la restauración verificada y luego se aplicó en producción; la poscondición confirmó `remaining: 0`;
  - no se necesitó redirigir recetas ni ejecutar cascadas destructivas porque ninguno de los 17 productos tenía referencias;
  - aceite legacy id 379 preservado como `LEGACY-000379` en unidad, sin inventar conversión a litros;
  - sus 2 unidades, compra, movimiento e historial de costo permanecen intactos;
  - cero productos activos sin SKU o unidad base después de la operación.
- Secret requerido: `TWO_FA_ENCRYPTION_KEY` aleatorio de 256 bits configurado directamente en Railway sin exposición local.
- Deployment API `5bb68052-a53e-4c6f-b042-11e718ca4111`: `SUCCESS`.
- Deployment web `d5c8d679-4347-4e81-984f-c4728c461060`: `SUCCESS`.
- Smoke: `/health` 200, `/api/health` 200, login web renderizado, sin errores propios de consola y respuesta controlada ante credenciales inválidas.

## Actualización de cierre profundo

### Cuarta pasada: reconciliación física, financiera y operativa

La cuarta pasada verificó conservación futura, no sólo saldos instantáneos. Se trazaron origen, movimientos, saldo, reversión y reporte para compras, inventario, producción, ventas, caja, catering y operación offline.

#### Compras, inventario, kardex, UOM y producción

- Se corrigió la carrera de pagos de compras: importe finito y positivo, reclamación optimista transaccional del saldo y rollback de la fila de pago ante conflicto.
- Las transferencias FIFO dejaron de usar el costo promedio del producto. La salida devuelve las porciones exactas consumidas y la entrada recrea cada capa con cantidad, costo unitario, orden y referencia de procedencia.
- Caso probado: origen `2500 @ 0.75` y `1000 @ 2`; traslado `3000`; destino `2500 @ 0.75` y `500 @ 2`; valor y COGS posterior `2875`, sin crear ni destruir cantidad o valor.
- La pareja de movimientos/kardex permanece única y la segunda pierna comparte la misma transacción; cualquier fallo revierte salida, entrada, capas y stocks.
- Se retiró la ruta de recálculo de costos que siempre respondía `501`; no se activó el algoritmo histórico existente porque no reconstruye de forma segura transferencias y producción.
- Catering ya no captura errores UOM para asumir `1:1`. Sólo se admite `1:1` cuando la unidad solicitada coincide realmente con la base; incompatibilidades fallan cerradas.
- Integración catering válida: `0.25 kg × 4 × 1000 = 1000 g`; desde `2000 g @ 0.5` quedan `1000 g`, un OUT de `1000 g` y COGS `500`.
- Integración incompatible volumen/masa: se rechaza y conserva estado, balance, pagos, stock, capas y movimientos.
- Las cantidades de platos de catering, almacenadas como `Int`, ahora exigen enteros positivos y ya no truncan silenciosamente fracciones.

#### Venta, promociones, pagos, caja, factura y reportes

- Conciliación bancaria usa `Payment.createdAt`, incluye pagos parciales y órdenes entregadas, y excluye órdenes canceladas; el periodo ya no cambia cuando cambia el estado/fecha de la orden.
- Una factura puede reimprimirse después de `DELIVERED` si el ledger activo cubre el total; una orden ajena o cancelada sigue fallando cerrada.
- Se eliminó del Dashboard la propina ficticia fija del 15%; las opciones 10/15/18/20 permanecen claramente como sugerencias y el valor persistido continúa siendo autoritativo.
- Arqueo y conciliación usan una sola configuración tenant-scoped `cash_reconciliation_tolerance`, default compatible `1.00`, validación finita `>=0` y campo en Settings. Aislamiento probado con empresas configuradas en `0.25` y `2.50`.
- Los reembolsos/reversos ya no borran historia. `Payment` conserva importe/método/fecha y pasa de `ACTIVE` a `REVERSED`, registrando `reversedAt`, `reversedById` y motivo obligatorio.
- El ingreso `PAY-*` permanece inmutable y se crea un egreso compensatorio `REV-PAY-*`; orden, promoción, caja y reportes se recalculan usando sólo pagos activos.
- Conciliación expone `grossCollected`, `refunded` y `netCollected`; `totalSales` permanece como alias compatible del neto.
- La reversión completa de un pago requiere ADMIN/SUPERADMIN y motivo no vacío. No existe contrato/UI de devolución parcial; no se declaró una capacidad inexistente.
- Diccionario KPI: `gross_item_sales = Σ OrderItem.subtotal`; `discount = Order.discount` una vez; `net_merchandise = gross-discount`; `order_total = net+tax+tip`; `collected = Σ Payment ACTIVE`; `refunded = Σ Payment REVERSED`; efectivo esperado `= apertura + IN - OUT`.

#### Empresas, sucursales, catering, reservaciones y offline

- Reservaciones cerraron IDOR entre sucursales: lectura, edición, cambio de estado y eliminación verifican empresa y alcance de branch; acceso cruzado devuelve 403.
- La máquina catering se alineó con Prisma/UI: `QUOTED → RESERVED | CANCELLED`; pago parcial mantiene `RESERVED`; saldo cubierto cambia atómicamente a `PAID`; `PAID → FINISHED`; terminales `FINISHED/CANCELLED`.
- No se permite marcar `PAID` manualmente, finalizar sin pago completo ni cancelar con pagos registrados. La UI sólo muestra transiciones válidas y el inventario se descuenta una vez.
- IVA de catering y contrato PDF usa `tax_rate/taxRate` de la empresa, con fallback documentado 15%, y etiqueta la tasa efectiva.
- Offline Dexie v4 particiona caché y cola por `companyId:userId`; registros legacy sin propietario fallan cerrados y no se leen ni sincronizan.
- Cambio de usuario/tenant conserva operaciones del dueño anterior pero las mantiene inaccesibles; existe purga explícita por propietario.
- Dependencias, IDs temporales, errores, reintentos y claves idempotentes se procesan sólo dentro del owner actual.
- `processSyncQueue` es single-flight: online, service worker y acción manual simultáneos comparten un runner. `401/409` son terminales; `408/429/5xx` tienen reintento limitado conservando la misma clave.
- Pruebas IndexedDB reales cubren aislamiento A/B, relogin, legacy, purga, dependencia/temp ID, doble trigger, 401/409 y 429.

#### Evidencia consolidada de la cuarta pasada

- Servidor: lint y typecheck sin errores; 28 suites unitarias, `133/133`.
- MySQL real: 8 suites de integración, `29/29`.
- Cliente: lint y typecheck sin errores; 8 archivos de prueba, `31/31`.
- Builds productivos de servidor y cliente completados; el warning de tamaño del bundle PDF es de rendimiento, no de corrección funcional.
- Nueva migración aditiva: `20260712_add_immutable_payment_reversals`; filas existentes quedan `ACTIVE` y no se elimina información histórica.
- Deployment API cuarta pasada `f3034c34-bcf4-495c-b97a-5d6d4d83ec48`: `SUCCESS`.
- Deployment web cuarta pasada `cf4889b0-0c61-4734-a897-0ed44a71387f`: `SUCCESS`.
- Producción: 15 migraciones encontradas y `Database schema is up to date`.
- Auditoría productiva posterior: cero catálogo faltante/candidato legacy, referencias legacy, UOM inválidas, stocks negativos, lotes inválidos, recetas inválidas, recetas productivas inválidas o duplicadas.
- Smoke final: `/health` 200, `/api/health` 200 y web `/` 200 con raíz React presente.

### Corrección posterior: costos estimados de recetas productivas

Una revisión visual de Brownie reveló dos resultados contradictorios: `250 ml` de aceite mostraban `C$ 86,297.50` en la fila, mientras el resumen y el listado mostraban cero. La causa fue demostrada en cuatro capas:

- backend: `currentAverageCost` es `Decimal`; un `Decimal(0)` es truthy y ocultaba el costo de referencia positivo;
- frontend: multiplicaba cantidad capturada por costo base antes de convertir UOM;
- validación: al guardar componentes, `unitId` era ignorado y se validaba la unidad legacy del producto;
- lectura: cualquier fallo de conversión se convertía silenciosamente en `cost: null`, ocultando la receta afectada.

Correcciones aplicadas localmente:

- `effectiveUnitCost` selecciona promedio positivo y, si es cero, referencia positiva;
- nuevo `POST /production-recipes/preview-cost` calcula autoritativamente conversión, costo de lote y costo unitario;
- formulario usa preview backend con debounce, bloquea guardado mientras exista error UOM y ya no multiplica localmente sin conversión;
- `unitId` se resuelve por empresa y se valida con `UnitConversionService` al crear/actualizar;
- listado muestra `Revisar UOM` y el mensaje real en lugar de cero/guion silencioso;
- script `prisma/audit-production-recipe-costs.ts` permite auditar todas las recetas, costos cero y errores.

Regresión MySQL: promedio `0`, referencia positiva, `250 ml`, rendimiento `12`; se verifica costo base efectivo, costo de lote, costo unitario, aparición en listado y rechazo de una unidad incompatible. Consolidación posterior: servidor `133/133` unitarias; MySQL `31/31` en 9 suites; cliente `31/31`; lint, tipos y builds correctos.

Auditoría productiva final:

- 10 recetas productivas; cero errores de conversión y cero recetas con costo total cero.
- Brownie antes de reconciliar mezcla: aceite `250 ml = 0.066 gal`, costo `22.78254`; huevos `24`; mezcla sin costo.
- La fuente revisada documentaba `MEZCLA BROWNIES = 874/6 = 145.6667` por unidad. Una corrección transaccional guardada por identidad, ausencia de stock/compras/historial y valores operativos cero fijó sólo el costo de referencia en `145.67`.
- Brownie final: aceite `22.78254` + mezcla `437.01` + huevos `24` = lote `483.79254`; rendimiento `12`; unitario `40.316045`.
- Componentes cero restantes: `Agua de proceso` en dos recetas activas, mantenida como insumo no valorizado; `CHILE` sólo en receta borrador, sin compra/costo verificable y por tanto sin valor inventado.
- El mismo antipatrón `Decimal(0) || referencia` fue eliminado de kardex, motor de inventario, órdenes/reportes de producción y reportes generales/extendidos usando `effectiveUnitCost` común.

Validación posterior: servidor `133/133`; MySQL `31/31` en 9 suites; cliente `31/31`; lint, tipos y builds correctos. Deployment API `a2b3ad84-486e-46cc-874a-d93980b0602c` y web `d588cc7e-18c3-405e-8ebd-07b64cca4752`, ambos `SUCCESS`; smoke API/web `200`.

#### Certificación operativa adicional solicitada

- La tabla `Recetas de Producción` incorpora columna `Rendimiento`, mostrando `yieldQuantity` y la abreviatura de `yieldUnit`, con fallback a la unidad base del producto.
- Cocina certificada: crear orden/ítem, enviar a cocina, iniciar ítem, terminar ítem, orden `READY`, cancelar y liberar mesa.
- Merma certificada: `0.5 kg → 500 g`, salida FIFO `500 @ 2 = 1000`, stock final cero, kardex y reporte de desperdicio reconciliados por razón.
- El conjunto existente vuelve a cubrir compra y recepción concurrente, transferencia FIFO y consumo futuro, producción/merma/rendimiento/reversión, venta con promoción, split `33.34+33.34+33.35`, pagos parciales/múltiples, reversos inmutables, reservación/cancelación, catering UOM/rollback, arqueo/cierre, factura e idempotencia.
- Regresiones focales nuevas: cocina/POS y merma/inventario `11/11`; cliente `31/31`, lint, tipos y build correctos.
- Deployment web con rendimiento/UOM `ad219ba6-6596-4b20-ae57-530f1d68b7a7`: `SUCCESS`.

### Tercera pasada adversarial

Esta pasada cambió el método: se atacaron invariantes cruzados, concurrencia, replay, estados imposibles, confianza cliente/servidor y aislamiento entre empresas. Hallazgos corregidos:

- Pagos de compras: se rechazaron importes no finitos, cero y negativos. Dos pagos concurrentes ya no pueden sobrepasar el saldo, perder una actualización ni desconciliar `PurchaseOrder.paidAmount` de las filas de pago; un conflicto revierte toda la transacción. La prueba MySQL con total `1875` y dos pagos simultáneos de `1000` confirma exactamente un commit, una fila y estado `PARTIAL` por `1000`.
- Transiciones contado/crédito: `CASH` sincroniza total pagado y estado `PAID`; volver a `CREDIT` restablece saldo y estado coherentes.
- Promociones: el backend ignora el descuento monetario propuesto por el cliente cuando existe código y recalcula autoritativamente vigencia, mínimo, tipo, máximo y centavos. El código se normaliza y el límite concurrente sigue reclamándose atómicamente.
- Idempotencia: se eliminó la caché local como fuente de verdad. El ledger MySQL `IdempotencyRecord` vincula empresa, método/ruta normalizada, clave y SHA-256 de un cuerpo canónico; soporta múltiples procesos, replay durable, expiración y recuperación de claims abandonados. Sólo persiste respuestas 2xx y no almacena el cuerpo solicitado en claro. Payload incompatible devuelve `409`; 4xx/5xx quedan reintentables.
- Usuarios/RBAC: listar usuarios, roles y permisos requiere administrador. El detalle permite únicamente el propio usuario o un administrador del mismo tenant, cerrando enumeración e IDOR horizontal.
- Logout: el cliente usa `POST /auth/logout`, espera la revocación en single-flight y siempre limpia estado local en `finally`; el servidor revoca la sesión y elimina la cookie.
- 2FA: se eliminó `tempToken` y su mapa en memoria porque no formaban parte del contrato consumido. El flujo real continúa validando credenciales y TOTP sin acumular desafíos muertos.
- Webhooks: Uber Eats y Rappi fallan cerrado mientras no exista secreto por tenant; ya no se acepta un secreto global junto a un `companyId` controlado por el solicitante. PedidosYa conserva HMAC sobre `rawBody`, secreto cifrado por empresa, comparación segura y unicidad durable `(companyId, externalId)` para nuevas órdenes.

Validación consolidada después de integrar todos los cambios:

- servidor: lint y typecheck sin errores; 26 suites unitarias, 120/120 pruebas;
- MySQL real: 7 suites de integración, 26/26 pruebas;
- cliente: lint y typecheck sin errores; 6 archivos, 21/21 pruebas;
- builds productivos de servidor y cliente completados.

Despliegue de la tercera pasada:

- API `e8b0c539-7e40-4587-b253-70b2313b7235`: `SUCCESS`; incluye la migración `20260712_add_durable_idempotency` mediante el entrypoint productivo.
- El primer intento web `1a22fd67-9876-489e-b853-aa6f121757cd` se lanzó desde la raíz y Railway seleccionó el Dockerfile de API; falló cerrado por ausencia de `DATABASE_URL` en el servicio web. La versión web anterior permaneció activa y no hubo caída.
- El reintento correcto desde `C:\restaurant\client`, deployment `876af636-b6c1-40cf-a941-0f2ad8d6161b`, terminó en `SUCCESS`. El cliente publicado corresponde al código que pasó lint, tipos, 21/21 pruebas, build productivo y healthcheck `/`.

Riesgo externo delimitado: los contratos disponibles de webhook no especifican un `timestamp` y `event-id` firmado común para cancelaciones y cambios de estado. No se inventó un header incompatible. La protección universal contra replay de esos eventos requiere especificación del proveedor y unicidad durable por empresa; hasta entonces los proveedores sin secreto tenant permanecen deshabilitados y PedidosYa aplica firma tenant-scoped, estados idempotentes y log de webhook.

- Se corrigió la aceptación accidental de `NaN`, `Infinity`, `-Infinity`, cero y negativos en UOM, inventario, compras y cantidad producida, según corresponda.
- Se añadieron invariantes con factores `0.001`, `0.125`, `1000` y `1,000,000`.
- FIFO fraccionario verificado: `0.5×1.25 + 0.75×2.5 + 0.25×10 = 5.00`, con saldo `0.75` en la tercera capa.
- Se corrigió el contrato `TAKEAWAY`/`TAKEOUT` y un defecto por el cual `OrderService.create` ignoraba `orderType` y guardaba `DINE_IN`.
- POS ahora prueba total `100.03`, impuesto `0.01`, propina `0.02`, split `33.34 + 33.34 + 33.35`, pagos parciales `40 + 60.03`, reversión, reembolso, cancelación protegida y cierre de caja con diferencia cero.
- Scripts de reset ya no tienen `admin123`, exigen empresa y clave de 12 caracteres, y fuerzan cambio al siguiente login.
- La base `_test` fue comparada sin diferencias, se baselinaron las 13 migraciones y `migrate status` quedó al día. Esto demuestra el procedimiento, no autoriza repetirlo en producción sin respaldo.
- Producción fue consultada read-only: esquema sin diferencias, 13 migraciones pendientes de registro.
- Auditoría productiva: cero stocks negativos, UOM inválidas, lotes negativos, recetas con cantidades inválidas, recetas activas vacías o recetas productivas activas duplicadas.
- Se detectaron 18 productos legacy activos sin SKU/unidad base. La reconciliación final eliminó 17 duplicados después de demostrar cero referencias y preservó el aceite id 379 como unidad independiente; no se fusionó con el maestro por falta de evidencia sobre volumen por envase.
- Auditoría posterior a la purga: `missingCatalog`, `catalogCandidates`, todas las referencias legacy, `invalidUnits`, `negativeStocks`, `invalidBatches`, `invalidRecipes`, `invalidProductionRecipes` y `duplicateActiveProductionRecipes` quedaron en cero.

### Hallazgos de la segunda pasada y correcciones

- Inventario: el mutador central podía alcanzar un `Stock` ajeno si un caller omitía validación. Ahora warehouse y product se validan por `companyId` antes de leer o crear stock.
- Promociones: dos pagos concurrentes podían exceder `usageLimit`; ahora el uso se reclama con actualización condicional atómica. La integración permite exactamente un pago y revierte el contador correctamente.
- Promociones: los códigos editados se normalizan a mayúsculas igual que en creación/búsqueda.
- Reportes: se separaron y reconciliaron `netItemSales`, descuento por orden, impuesto, propina, `grossOrderTotal` y `collected`.
- Reportes con categoría/marca: órdenes sin líneas coincidentes ya no sesgan cantidad ni ticket promedio.
- Exportaciones: el descuento de orden aparece una sola vez y es sumable; el resumen expone puente financiero completo.
- Errores de alcance de sucursal conservan HTTP 403 en vez de convertirse en 500.
- API keys se marcan experimentales y dejan de anunciarse como recurso funcional; `/scopes` requiere administrador.
- Scripts administrativos ya no contienen contraseña `admin123`, exigen empresa/clave fuerte y fuerzan cambio posterior.

## Arquitectura y fronteras revisadas

- UI: rutas, guardas de roles, páginas POS, compras, producción, inventario, caja, reservas, empresas y configuración.
- API: autenticación, autorización, CSRF, CORS, idempotencia, validación, controladores y manejo de errores.
- Dominio: compras, UOM, FIFO/promedio, recetas, producción, órdenes, promociones, pagos, facturas, caja, reservas e integraciones.
- Persistencia: aislamiento por empresa/sucursal, transacciones, bloqueos, índices operativos y migraciones Prisma.
- Operación: Docker, Compose, Railway, CI, secrets, backup y política de migración.

## Correcciones aplicadas

### Compras, unidades, inventario y costos

- La recepción de una orden de compra bloquea la fila con `FOR UPDATE` y relee estado e ítems dentro de la transacción.
- Sólo una recepción concurrente puede pasar de `ISSUED` a recibida. Se evita duplicar stock, lotes FIFO, movimientos e historial de costo.
- Se añadió una integración MySQL real con dos llamadas simultáneas.
- Caso matemático verificado:
  - Compra: `2.5 kg` a `C$750/kg`.
  - Factor: `1000 g/kg`.
  - Cantidad base: `2.5 × 1000 = 2500 g`.
  - Costo base: `750 ÷ 1000 = C$0.75/g`.
  - Valor recibido: `2500 × 0.75 = C$1875`.
  - Resultado concurrente: una operación aceptada, una rechazada, un movimiento, un lote, un historial, stock `2500` y promedio `0.75`.
- Las pruebas existentes verifican conversión 1:1 válida, fallo cerrado cuando falta conversión, alias de unidades, FIFO oldest-first, promedio ponderado y reversión exacta.
- Ecuación de promedio ponderado validada: `(Q0 × C0 + Qin × Cin) ÷ (Q0 + Qin)`.

### Producción y recetas

- Se verificaron versiones activas, ciclos de recetas, rendimiento, escalado, consumo de componentes, entrada de terminado y costo producido.
- La integración prueba que dos finalizaciones concurrentes permiten exactamente una consumación.
- La cancelación revierte stock y costo usando capas e historial, incluso con salidas intermedias.

### POS, órdenes, promociones, pagos, caja y factura

- Se corrigieron closures obsoletos en POS y caja que podían usar notificaciones, selección de mesa o estados anteriores.
- Nueva integración HTTP→servicios→Prisma→MySQL, sin mocks:
  - apertura de caja;
  - orden `DINE_IN` y ocupación de mesa;
  - agregado de ítem;
  - promoción 10%, descuento persistido y total autoritativo `90`;
  - pago efectivo y movimiento de caja;
  - incremento único del uso de promoción;
  - orden `PAID`, liberación de mesa y factura `FAC-*`;
  - cancelación de una segunda orden sin mesa huérfana;
  - creación y cancelación de reserva futura.
- Las pruebas anteriores mantienen cobertura de split bill, reversión de pago, cancelación pagada, promoción e inventario.

### Empresas, sucursales, usuarios y configuración

- `GET /users/profile` usa `userId` y `companyId` autenticados; ya no intenta consultar un `req.params.id` inexistente.
- La edición de perfil elimina `password`, roles, estado, empresa y sucursales. Las contraseñas sólo cambian por el flujo que verifica la actual y revoca sesiones.
- Se añadieron pruebas de regresión para identidad y filtrado de campos privilegiados.
- Autenticación y reportes leen `password_expiry_days` y `session_timeout_minutes` con la misma clave prefijada usada al guardar por empresa.
- Promociones leen el símbolo de moneda correspondiente a su empresa.
- Timeout de sesión limitado a 1–1440 minutos y expiración de contraseña a 0–3650 días.

### Frontend y configuración de URLs

- Se corrigieron dependencias React en POS, caja, catering y desperdicio.
- Los enlaces de facturas de compra usan la misma resolución de URL base que el cliente API; se eliminó el fallback hardcodeado a `localhost:3001`.
- Compose pasa `VITE_API_URL` y `VITE_WS_URL` como argumentos de build. Las variables Vite se hornean al construir y no se simulan como variables runtime de archivos estáticos.
- Las excepciones Fast Refresh quedaron acotadas a módulos singleton que intencionalmente colocalizan provider y hook. `eslint --max-warnings=0` pasa.

### Seguridad y dependencias

- Actualizaciones controladas, sin `--force`:
  - servidor: Express 4.22.2, express-rate-limit 8.5.2, jsonwebtoken 9.0.3, Multer 2.2.0, ws 8.21.0, Helmet 8.3.0, CORS 2.8.6, jsPDF 4.2.1 y autotable 5.0.8;
  - cliente: Axios 1.16.0 y React Router DOM 6.30.4;
  - override acotado de `uuid@11.1.1` bajo ExcelJS, compatible con su uso `uuid.v4()`.
- `npm audit --omit=dev` devuelve cero vulnerabilidades en ambos paquetes.
- CI ejecuta audit de dependencias runtime antes de lint y tests.
- En producción se exige JWT de al menos 32 bytes, `TWO_FA_ENCRYPTION_KEY` hexadecimal de 64 caracteres y orígenes `CLIENT_URL` válidos.

### Migraciones, Docker y respaldos

- Se eliminó el fallback productivo `prisma db push --accept-data-loss`. Si `prisma migrate deploy` falla, el contenedor se detiene sin reescribir el esquema.
- Los bind mounts fueron retirados del Compose base y trasladados a `docker-compose.dev.yml`; producción usa los artefactos construidos.
- El cliente MySQL se instala en las imágenes del servidor para que `mysqldump` exista.
- Backup obtiene host, puerto, usuario, contraseña y base desde `DATABASE_URL`, usa `execFile`, `MYSQL_PWD`, `--single-transaction`, rutinas y triggers.
- Los servicios reciben explícitamente la clave de cifrado y credenciales opcionales de documentación.

## Matriz funcional consolidada

| Dominio | Evidencia actual | Estado |
|---|---|---|
| Compras | recepción transaccional + concurrencia MySQL | Aprobado |
| UOM | cantidad×factor, costo÷factor, aliases y fallo cerrado | Aprobado |
| Inventario/FIFO | IN/OUT, no negativo, capas, costo y reversión | Aprobado |
| Producción | consumo, terminado, concurrencia y cancelación | Aprobado |
| Menú/recetas | resolución, importación, ciclos y versionado | Aprobado por unitarias/integración |
| Promociones | cálculo servidor, límites, uso y reversión | Aprobado |
| POS/órdenes/mesas | ciclo HTTP real, pago, cancelación y liberación | Aprobado |
| Facturación | cálculo, aislamiento tenant y emisión desde venta | Aprobado |
| Caja | apertura, pago/movimiento y conciliación unitaria | Aprobado; arqueo manual previo al go-live |
| Reservaciones | creación/cancelación real y scope de sucursal | Aprobado |
| Empresas/sucursales | scope transversal y configuración prefijada | Aprobado |
| Usuarios/roles | perfil autenticado, campos privilegiados y sesiones | Aprobado |
| PedidosYa/delivery | cifrado/scope revisado | Requiere prueba contractual con sandbox externo |
| Offline/websocket | aislamiento empresa/sucursal y roles de cocina | Aprobado por unitarias; reconexión debe probarse operacionalmente |
| Reportes | compilan y lint limpio | Requieren reconciliación contable con datos reales |

## Validación final reproducible

| Validación | Resultado final |
|---|---|
| Server lint | Exit 0, cero warnings |
| Server typecheck | OK |
| Server unit | 24 suites, 116/116 tests |
| Server integration MySQL | 6 suites, 22/22 tests |
| Server build | Prisma generate + TypeScript OK |
| Client lint estricto | Exit 0 con `--max-warnings=0` |
| Client typecheck | OK |
| Client unit | 6 archivos, 21/21 tests |
| Client build | Vite OK, 2557 módulos transformados |
| Runtime audit server | 0 vulnerabilidades |
| Runtime audit client | 0 vulnerabilidades |
| Navegador productivo | Login/guardas previas 5/5; smoke final público aprobado mediante navegador integrado |
| `git diff --check` | OK |

El chunk `react-pdf.browser` queda en aproximadamente 1.575 MB minificado/528 KB gzip, cargado como chunk separado. Es una mejora de rendimiento futura, no un error lógico ni un bloqueo funcional.

## Riesgos y límites explícitos

- Se ejecutaron consultas read-only de esquema y calidad; no se modificaron datos productivos.
- El baseline y la reconciliación legacy fueron completados después de backup/restore verificado.
- Las FKs individuales no garantizan por sí solas que `companyId`, warehouse, product y unit pertenezcan al mismo tenant. Los servicios lo validan; añadir constraints compuestos requiere auditar datos reales y una migración diseñada, no un `db push` improvisado.
- No hay `CHECK` de base para todos los factores/costos/cantidades positivos. La aplicación falla cerrada y las pruebas lo cubren; una migración DB futura debe primero demostrar que no existen filas legacy incompatibles.
- PedidosYa y otros proveedores externos necesitan credenciales/sandbox reales.
- Los E2E de navegador existentes cubren login y guardas; la cobertura operativa profunda nueva es HTTP/MySQL, no automatización visual del navegador.

## Lista obligatoria antes de abrir tráfico

- [ ] Configurar `JWT_SECRET`, `TWO_FA_ENCRYPTION_KEY`, `CLIENT_URL`, `DATABASE_URL`, URLs Vite y credenciales externas reales.
- [x] Ejecutar diff/migraciones sobre una copia reciente y comprobar drift cero.
- [x] Crear respaldo y restaurarlo en una base aislada con conteos idénticos.
- [x] Registrar baseline de 13 migraciones en producción y verificar `migrate status`.
- [x] Reconciliar catálogo legacy sin convertir unidades sin evidencia.
- [ ] Repetir Playwright en CI o en un runner con permiso de Chromium.
- [ ] Ejecutar smoke manual: compra→recepción, producción, POS→factura, apertura→arqueo→cierre y reserva.
- [ ] Reconciliar existencias, kardex, costo promedio/FIFO, ventas, impuestos y caja con valores firmados por operación/contabilidad.
- [ ] Probar webhooks/reintentos de PedidosYa en sandbox.
- [ ] Definir monitoreo, alertas, responsable de despliegue y rollback.

## Runbook de recuperación

1. Detener escrituras de aplicación si se requiere restauración real.
2. Conservar `C:\tmp\miapitza-prod-20260712-v2.ndjson.gz` fuera del repositorio y copiarlo a almacenamiento cifrado durable.
3. Restaurar primero en una base cuyo nombre termine en `_restore_test` con `mysql-logical-restore.ts`.
4. Comparar conteos del footer, ejecutar `prisma migrate diff` y pruebas de lectura.
5. Para producción, crear una base nueva y cambiar `DATABASE_URL`; no sobrescribir la base dañada como primera acción.
6. Verificar health, login, conteos críticos, órdenes, pagos, stock y reportes antes de reabrir tráfico.

## Runbook de migraciones

1. Backup consistente y restore drill obligatorio.
2. `prisma migrate diff --from-url ... --to-schema-datamodel prisma/schema.prisma --exit-code`.
3. En bases históricas equivalentes, `prisma migrate resolve --applied <migration>` una por una.
4. `prisma migrate status` debe indicar `up to date`.
5. El entrypoint sólo ejecuta `migrate deploy`; nunca usa `db push --accept-data-loss`.

## Protocolo para futuras revisiones

1. Registrar commit, esquema Prisma, versión Node y locks auditados.
2. Ejecutar audit runtime, lint estricto, typecheck y builds desde `npm ci`.
3. Trazar cada módulo UI→API→servicio→transacción→DB→efectos→reversión.
4. Verificar tenant, sucursal, autorización, estados, idempotencia, locks, redondeo y unidad base.
5. Para UOM registrar siempre cantidad fuente, factor, cantidad base, precio fuente, costo base y valor total.
6. Añadir una regresión por defecto corregido.
7. Ejecutar unitarias, integración MySQL y navegador.
8. Ensayar migración, respaldo y restauración.
9. Actualizar este documento con evidencia, responsable y fecha.

## Archivos principales modificados

- Seguridad/dependencias: `server/package*.json`, `client/package*.json`, reportes, validación y ESLint.
- Compras/costos: `purchase-order.service.ts` y prueba de concurrencia MySQL.
- Operación: prueba integral POS/caja/factura/reserva.
- Plataforma: perfil, auth, settings, promociones y pruebas de usuario.
- Frontend: POS, caja, catering, desperdicio y enlaces de factura de compra.
- Despliegue: Dockerfiles, entrypoint, Compose, CI y ejemplos de entorno.
- Backup: `backup.controller.ts`.

Los archivos no rastreados que existían previamente (PDF, Excel, temporales, outputs y script exploratorio) fueron preservados y no forman parte de las correcciones.
