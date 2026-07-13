# Certificación transaccional end-to-end

> **Actualización posterior:** la pasada adversarial transversal, sus nuevos hallazgos, 311 casos automatizados y condiciones del próximo despliegue están en `AUDITORIA_ADVERSARIAL_TRANSVERSAL_E2E_2026-07-12.md`. Ese documento prevalece para la siguiente liberación.

**Proyecto:** Mia Pitza Restaurant System
**Fecha de corte:** 2026-07-12
**Alcance:** frontend, API, servicios, persistencia, seguridad multiempresa, concurrencia, contraflujos, infraestructura y evidencia de pruebas.

## 1. Dictamen ejecutivo

### Veredicto actual: GO técnico del núcleo desplegado; seguimiento contable y canales externos bajo control

El núcleo de compras, inventario, producción, menú, promociones, órdenes, cocina, POS, pagos, facturación, caja, reservaciones, catering y aislamiento multiempresa quedó corregido y con todas las pruebas automatizadas en verde. No se detectaron errores de lint, tipos, compilación, vulnerabilidades de runtime ni discrepancias en las 33 integraciones transaccionales ejecutadas.

El release controlado fue ejecutado después de cerrar backup/restore, ensayo de migraciones y baseline:

1. volumen `miapitza-volume` adjunto en `/app/storage`;
2. API y web desplegados con healthcheck `SUCCESS`;
3. las tres migraciones nuevas aplicadas; producción registra 18/18;
4. 18 órdenes históricas saneadas y 20 pagos revertidos inmutablemente;
5. PEDIDOSYA desactivado porque no existe configuración;
6. seis órdenes vacías con pagos positivos permanecen bloqueadas para revisión manual.

Este dictamen no promete ausencia matemática de defectos. Sí significa que los invariantes críticos revisados tienen implementación, contraflujo y evidencia automatizada coherentes, y que los riesgos que permanecen están enumerados, no ocultos.

## 2. Método de revisión

La revisión se dividió en tres frentes especializados y una consolidación final:

| Frente | Responsabilidad exclusiva |
|---|---|
| Abastecimiento | compras, proveedores, unidades, inventario, FIFO/promedio, transferencias, merma y producción |
| Operación | menú, recetas, modificadores, promociones, órdenes, cocina, reservaciones, catering y delivery |
| Finanzas y tenant | POS, pagos, factura, caja, arqueo, conciliación, empresas, sucursales, usuarios, seguridad y despliegue |
| Consolidación | revisión de cambios cruzados, corrección de conflictos, pruebas completas, navegador, migraciones y dictamen |

Cada flujo se evaluó con estas preguntas:

1. ¿Quién puede iniciarlo y dentro de qué empresa/sucursal?
2. ¿Qué estado inicial admite la operación?
3. ¿Qué cantidades, costos, impuestos, descuentos y saldos cambia?
4. ¿La operación es atómica y segura bajo concurrencia?
5. ¿Qué ocurre al cancelar, revertir, devolver o repetir la solicitud?
6. ¿Caja, factura, inventario, costo y reportes se pueden reconciliar?
7. ¿Un error falla de forma visible o se disfraza con un fallback?

## 3. Resultado por dominio

| Dominio | Flujo confirmado | Contraflujo confirmado | Resultado |
|---|---|---|---|
| Compras | borrador, recepción, costo, stock, pago contado/crédito | rechazo de pago prematuro; DRAFT como único estado editable/eliminable | Aprobado |
| Unidades de medida | unidad ingresada → factor → cantidad/costo base | unidad inactiva, ajena o incompatible rechazada | Aprobado |
| Inventario | entradas, salidas, kardex, transferencia, merma | reversión exacta y rechazo de stock/lotes inconsistentes | Aprobado |
| Costeo | promedio ponderado y consumo FIFO por capas | replay de costo y cancelación de capa propia | Aprobado |
| Producción | receta versionada, consumo, rendimiento y alta del producto | cancelación restaura insumos, producto y costo original | Aprobado |
| Menú | producto, receta, marcas, modificadores y costo calculado | incompatibilidad UOM falla; no devuelve costo cero silencioso | Aprobado |
| Promociones | código, vigencia, límites, porcentaje/fijo | límite concurrente, reversión de uso y rango inválido | Aprobado |
| Órdenes/POS | crear, enviar a cocina, cobrar, facturar | cancelar/revertir sin dobles descuentos ni pagos huérfanos | Aprobado |
| Cocina | pendiente → preparación → listo | transiciones atómicas; cancelación segura | Aprobado |
| Pagos | parcial, múltiple, división en centavos, cierre | reversión inmutable y recálculo del estado financiero | Aprobado |
| Facturación | factura desde orden cobrada | pago revertido no cuenta; tenant ajeno devuelve 404 | Aprobado |
| Caja | apertura, movimientos, venta, arqueo y cierre | compensación en vez de borrar ledger; diferencia auditada | Aprobado |
| Conciliación bancaria | depósito de turnos cerrados y consulta histórica | reversión inmutable y nueva conciliación posterior | Aprobado con migración pendiente |
| Reservaciones | disponibilidad, mesa física, creación y cancelación por sucursal | doble asignación concurrente y acceso de otra sucursal rechazados | Aprobado |
| Catering | cotización, reserva, pago, ejecución e inventario | rollback completo ante UOM inválida; cancelación financiera protegida | Aprobado |
| Delivery/PedidosYa | webhook autenticado, tenant, orden completa | firma/tenant inválido rechazado; no hay éxito simulado | Aprobado para entrada; salida genérica deshabilitada |
| Empresas/sucursales/marcas | alcance company/branch, logos y catálogos | acceso cruzado rechazado | Aprobado |
| Offline/idempotencia | replay sólo de comandos con contrato explícito | payload distinto o fallo no queda falsamente confirmado | Aprobado |

## 4. Invariantes numéricos y contables

### 4.1 Unidades

Para una unidad permitida del producto:

```text
cantidadBase = cantidadIngresada × factorConversión
costoUnitarioBase = costoUnitarioIngresado ÷ factorConversión
valorTotal = cantidadIngresada × costoUnitarioIngresado
           = cantidadBase × costoUnitarioBase
```

Reglas verificadas:

- cantidad y factor deben ser finitos y mayores que cero;
- el costo no puede ser negativo ni `NaN/Infinity`;
- la unidad debe pertenecer a la misma empresa, estar activa y ser compatible con el producto;
- no se permite más de una unidad por defecto activa por producto;
- no existe fallback silencioso 1:1 cuando la unidad solicitada difiere de la unidad conocida.

### 4.2 Promedio ponderado

```text
nuevoPromedio =
  (stockAnterior × costoAnterior + entradaBase × costoEntradaBase)
  ÷ (stockAnterior + entradaBase)
```

La recepción bloquea el producto antes de actualizar costo y stock. La cancelación de producción reejecuta el historial desde la línea base; no reinicia el costo a cero.

### 4.3 FIFO

```text
stockActual = Σ cantidadRestanteDeCapas
COGS(salida) = Σ cantidadTomadaDeCadaCapa × costoDeLaCapa
```

Si stock y capas no reconcilian, la salida falla cerrada. Al activar FIFO sobre inventario legado se crea una capa de apertura explícita únicamente cuando el stock es positivo y tiene costo válido. Stock negativo, exceso de capas o costo cero no se inventan ni se corrigen silenciosamente.

### 4.4 Venta, pagos e invoice

```text
subtotalItems = Σ cantidad × precioAutorizado
total = subtotalItems - descuento + impuesto + propina
cobradoActivo = Σ pagos activos redondeados a centavos
saldo = total - cobradoActivo
```

El backend es autoritativo para precio, promoción y total. Una factura requiere cobro activo suficiente; los pagos revertidos permanecen auditables pero no cuentan como recaudación.

### 4.5 Caja

```text
efectivoEsperado = apertura + ventasEfectivo + ingresos - egresos - devolucionesEfectivo
diferencia = efectivoContado - efectivoEsperado
```

El cierre recalcula bajo lock. Una diferencia fuera de tolerancia necesita privilegio administrativo y nota. Los movimientos de caja no se eliminan: se compensan.

## 5. Correcciones materiales incorporadas

### Compras, inventario y producción

- Los totales y pagos de compra se normalizan a precisión monetaria.
- Una compra sin tipo de factura se interpreta consistentemente como contado liquidado.
- No se admiten pagos de crédito antes de recibir la orden.
- La descarga de la factura de compra utiliza endpoint autenticado y con tenant, no concatenación de URL.
- Recepción, transferencias y producción bloquean registros en orden determinista para reducir deadlocks y dobles consumos.
- El motor FIFO usa `InventoryBatch` como fuente autoritativa y exige reconciliación con `Stock`.
- La merma registra cantidad convertida y salida valorizada.
- La receta de producción muestra rendimiento y unidad en la tabla; usa `yieldUnit`, luego unidad base y sólo al final el dato legado.
- Recetas ACTIVE/INACTIVE no se editan in-place: se versionan. Sólo DRAFT es editable.
- Activación valida componentes, unidades, producto y dependencias circulares.
- Finalización concurrente de una orden de producción sólo puede confirmar una vez.
- La cancelación de producción restaura insumos y revierte exactamente el producto/costo generado.

### Menú, promociones, órdenes, cocina y reservaciones

- Esquemas de promociones alineados con los campos reales; código normalizado, porcentaje máximo 100, fechas y límites válidos.
- El uso máximo de una promoción se protege bajo concurrencia y se revierte con el contraflujo financiero.
- La orden valida sucursal, menú de la sucursal, cantidad y reglas min/max/actividad de modificadores.
- El frontend envía a cocina por el endpoint específico en vez de forzar un estado genérico.
- Inicio y finalización de ítems de cocina son transiciones atómicas.
- La reserva bloquea el recurso lógico durante disponibilidad/transición y aplica aislamiento de sucursal.
- Catering inicia en `QUOTED`, usa máquina de estados real, referencias de pago idempotentes y mutaciones transaccionales.
- Omitir una sección al actualizar catering ya no borra líneas ajenas accidentalmente.
- Costeo de menú y escalado de receta ya no convierten errores UOM en costo cero.

### POS, factura, caja y conciliación

- Pago, división de cuenta y saldos usan centavos consistentes.
- El turno de caja activo debe coincidir con la sucursal de la orden y queda vinculado a la orden.
- Revertir un pago conserva el registro y su motivo; la factura filtra únicamente pagos activos.
- Apertura y movimientos de caja usan locks; no puede existir más de un turno abierto por usuario.
- Cierre y arqueo usan un único cálculo autoritativo.
- Conciliación bancaria dejó de ser placeholder: crea depósitos, relaciona turnos, lista historial y revierte sin borrar.
- Un turno puede conciliarse otra vez después de revertir el depósito anterior, manteniendo ambos eventos auditables.

### Seguridad, multiempresa e infraestructura

- El navegador autentica por cookie `HttpOnly`; el token en respuesta se mantiene sólo para clientes API Bearer compatibles.
- WebSocket del navegador usa cookie y ya no transporta JWT por query string.
- WebSocket filtra por empresa, sucursal y rol de cocina.
- Backup físico requiere `SUPERADMIN` y la empresa operadora configurada en `BACKUP_ADMIN_COMPANY_ID`.
- Logos se crean/eliminan con alcance de empresa; las rutas de assets resuelven correctamente el origen de API.
- La cola offline sólo acepta mutaciones con contrato de replay e idempotencia explícito.
- Puertos de desarrollo quedaron normalizados: API 3000, web 5173.
- Docker conserva uploads/backups mediante volúmenes declarados; MySQL local sólo escucha en loopback.
- Prisma está disponible en runtime porque el entrypoint ejecuta `prisma migrate deploy` después del prune.
- `serve` quedó fijado a versión exacta en el cliente; no se instala globalmente en build.

## 6. Concurrencia, atomicidad e idempotencia

Se comprobaron explícitamente estos escenarios:

- dos recepciones simultáneas: sólo una confirma;
- dos finalizaciones de producción: sólo una consume/produce;
- dos pagos concurrentes de una compra crédito: no pierden ni exceden saldo;
- límite de promoción concurrente: nunca supera `usageLimit`;
- apertura/cierre/movimientos de caja bajo locks;
- reservas concurrentes evaluadas dentro de transacción;
- idempotency key compartida por instancias: una sola ejecución y replay durable;
- misma key con payload diferente: rechazo;
- errores 4xx/5xx: la key no queda falsamente consumida y se puede reintentar.

## 7. Multiempresa y sucursales

Regla general certificada:

```text
recurso.companyId = usuario.companyId
y, cuando aplica,
recurso.branchId ∈ sucursales permitidas al usuario
```

`SUPERADMIN` no equivale automáticamente a acceso físico global para backups: además debe pertenecer a la empresa operadora configurada. Para arqueo, un `ADMIN` normal continúa limitado a su sucursal; únicamente `SUPERADMIN` puede operar con alcance de empresa cuando la ruta lo permite.

Los casos negativos de factura, reserva, almacén, producto, delivery, usuario y logo se probaron o revisaron para evitar referencias por ID sin condición tenant.

## 8. Evidencia automatizada final

| Verificación | Resultado |
|---|---:|
| ESLint servidor | 0 errores |
| TypeScript servidor | 0 errores |
| Unitarias servidor | 37 suites, 189/189 |
| Integración servidor/MySQL | 9 suites, 35/35 aisladas |
| Prisma validate | válido |
| Build servidor | exitoso |
| ESLint cliente | 0 errores |
| TypeScript cliente | 0 errores |
| Unitarias cliente | 10 archivos, 35/35 |
| Playwright Chromium | 6/6 |
| Build cliente | exitoso |
| `npm audit --omit=dev` servidor | 0 vulnerabilidades |
| `npm audit --omit=dev` cliente | 0 vulnerabilidades |
| `git diff --check` | sin errores de whitespace |
| Ensayo sobre restauración exacta de producción | 18 migraciones, 0 fallidas, 137 FK verificadas |
| Baseline desde base vacía | coincide exactamente con Prisma schema |
| Navegador local | login renderiza; 1 usuario, 1 contraseña, 1 botón; 0 errores de consola |

Pruebas transaccionales destacadas:

- compra → recepción → conversión base → costo → stock;
- transferencia FIFO parcial conservando valor;
- merma convertida, valorizada y reconciliada en reporte;
- venta POS → promoción → pago → factura → caja;
- pago parcial/múltiple → reversión → saldo/estado actualizado;
- cocina por ítem y cancelación sin huérfanos;
- receta de menú consume una vez y se puede revertir/reaplicar;
- producción finaliza con costo/stock concordante y cancela completamente;
- catering incompatible revierte estado, capas, stock, movimientos y balance;
- aislamiento de invoice/reserva entre tenant/sucursal;
- tabla de recetas de producción muestra `12 kg` y fallback `500 g`.

## 9. Búsqueda de silencios, hardcode y redundancia

La búsqueda estática final no encontró bloques `catch` que devuelvan silenciosamente `0`, `null`, `undefined` o `false` en frontend/backend. Los hotspots de costeo de receta y escalado que antes degradaban a cero ahora lanzan error contextual.

Los URLs locales restantes son fallbacks de desarrollo y tienen override por entorno:

- CORS: `CLIENT_URL`;
- Swagger: `API_PUBLIC_URL`;
- WebSocket cliente: `VITE_WS_URL`/origen actual;
- puerto API: `PORT`.

El cálculo duplicado de cierre de caja se consolidó en el servicio de arqueo. El placeholder de recálculo de costo fue eliminado y la conciliación bancaria fue implementada. La única respuesta 501 deliberada corresponde al outbound genérico de delivery descrito abajo.

## 10. Estado real de migraciones y Railway

Consulta de sólo lectura realizada el 2026-07-12:

- producción tiene terminadas y sin rollback las 15 migraciones existentes hasta:
  - `20260712_add_durable_idempotency`;
  - `20260712_add_immutable_payment_reversals`;
- las tablas `BankDeposit` y `BankDepositShift` aún no existen;
- están pendientes `20260712_add_bank_deposit_reconciliation`, `20260712_add_reservation_table_and_catering_reversal` y `20260712_preserve_production_fifo_layers`;
- el entrypoint del API usa `prisma migrate deploy` y falla cerrado si no puede migrar;
- MySQL sí posee volumen persistente;
- el estado consultado no mostró un volumen persistente para el servicio de aplicación.

Las tres migraciones se aplicaron correctamente sobre una restauración exacta del backup productivo: 18 migraciones terminadas, ninguna fallida y 137 relaciones foráneas sin huérfanos.

### Hallazgo de recuperación desde cero

La cadena histórica no crea el esquema inicial completo. La primera migración incluida, `20260513_add_unit_conversion_system`, intenta alterar `Product`, `Recipe`, `InventoryMovement` y otras tablas preexistentes. En una base totalmente vacía falla con P3018 / MySQL 1146 (`Product` no existe).

Esto no bloquea la migración incremental de la base productiva actual, porque esa base ya registra las 15 migraciones anteriores. El faltante de recuperación desde cero quedó cerrado con `server/prisma/baseline/20260712_schema.sql`, generado desde Prisma y validado contra una base vacía sin diferencias. El baseline está fuera de `prisma/migrations` para no hacer que instalaciones existentes intenten recrear tablas.

### Backup, restore y calidad de datos productivos

- backup consistente: 63 tablas y 2,508 filas;
- archivo local ignorado por Git: `server/backups/production-pre-release-20260712-1305.ndjson.gz`;
- SHA-256: `71D5BBB4E10EB3DA094D4C4ED8F24687C00E62428116CF8879C299599A69B11F`;
- restauración comprobada dos veces, con conteos exactos al footer;
- bases temporales eliminadas después de verificar.

La restauración reveló datos históricos inválidos, no un error del restore:

- 24 órdenes PAID/DELIVERED sin ítems;
- 17 pagos ACTIVE de monto cero;
- 3 pagos ACTIVE negativos;
- 2 órdenes con total negativo;
- 18 órdenes son saneables automáticamente y de forma inmutable;
- 6 órdenes (IDs 3, 6, 10, 15, 19 y 23) tienen pagos positivos y quedan bloqueadas para revisión humana.

El script `audit:empty-orders` fue probado primero contra una copia y luego aplicado en producción con actor SUPERADMIN, doble guard, locks y backup. Canceló las 18 elegibles, revirtió 20 pagos y dejó intactas las seis ambiguas. El post-check confirmó `eligible=0`, `activePaymentsToReverse=0` y únicamente las seis bloqueadas.

### Evidencia del despliegue productivo

- API deployment exitoso: `4c1b2c79-e5fe-468d-bc21-a5aa46919b2c`;
- web deployment exitoso: `64f03d73-65e7-44d1-980d-193c75883688`;
- `GET /health`: `ok`;
- endpoint protegido sin sesión: HTTP 401 con HSTS y headers de seguridad;
- consola del login web: cero errores/warnings;
- logs HTTP posteriores: cero respuestas 5xx;
- proceso principal Node: UID/GID 1000, sin capacidades efectivas;
- escritura en volumen probada como UID/GID 1000;
- migraciones: `Database schema is up to date`, 18 directorios.

El primer intento con el volumen falló cerrado porque Railway lo montó como root después del build. No sustituyó el deployment saludable anterior. Se corrigió el entrypoint para inicializar únicamente el mount como root y ejecutar la aplicación mediante `gosu node`; el deployment siguiente pasó healthcheck.

## 11. Riesgos y límites remanentes

| Prioridad | Riesgo/límite | Impacto | Tratamiento |
|---|---|---|---|
| Cerrado | Backup/restore | 63 tablas y 2,508 filas reconciliadas | evidencia y checksum registrados |
| Cerrado | Volumen persistente del API | archivos efímeros | `/app/storage` montado y escribible por UID 1000 |
| Cerrado | Tres migraciones pendientes | funciones nuevas no existían | producción actualizada a 18/18 |
| Cerrado | Historia no levantaba DB vacía | recuperación dependía sólo de dump | baseline generado y validado sin diferencias |
| Cerrado | 18 órdenes/pagos históricos inválidos | distorsión de ledger/reportes | 18 canceladas y 20 pagos revertidos con auditoría |
| Cerrado | PEDIDOSYA activo sin `PedidosYaConfig` | canal visible sin contrato operativo | canal desactivado y auditor de canales en verde |
| P1 | 6 órdenes vacías con pagos positivos | no pueden corregirse automáticamente | investigación manual y decisión contable |
| P1 | Outbound genérico de delivery devuelve 501 | no puede empujar estado a proveedor desconocido | deshabilitar canal o implementar API/secret/contrato real |
| Cerrado | Reserva sin mesa física | doble asignación posible | `tableId`, locks y UI implementados |
| P2 | Chunk `react-pdf.browser` de 1.575 MB | carga inicial/impresión más lenta | lazy load/manual chunk; no afecta integridad |
| P2 | Mensajes de dominio mezclan español/inglés | UX/soporte | catálogo uniforme de errores |
| P2 | Falta prueba formal de carga prolongada | capacidad máxima no cuantificada | ejecutar soak/load con concurrencia real |

## 12. Gates obligatorios antes del GO

### Datos y migración

- [ ] congelar escrituras o programar ventana de mantenimiento;
- [x] generar backup lógico pre-release;
- [x] restaurar ese backup en una base aislada y comparar conteos;
- [x] verificar `_prisma_migrations` sin filas fallidas o revertidas en el ensayo;
- [x] ejecutar `prisma migrate deploy`;
- [x] comprobar en el ensayo que las tablas/columnas nuevas existen con índices/FK;
- [x] conservar el dump/baseline que permite reconstrucción desde cero.

### Infraestructura y secretos

- [x] montar volumen persistente en el API en `/app/storage`;
- [x] preparar `STORAGE_DIR=/app/storage` y `BACKUP_ADMIN_COMPANY_ID=1` sin redeploy;
- [ ] verificar `DATABASE_URL`, `JWT_SECRET`, `CLIENT_URL` y `API_PUBLIC_URL` en la ventana sin imprimir secretos;
- [ ] configurar `VITE_API_URL` y `VITE_WS_URL` al construir el cliente;
- [ ] confirmar cookies `Secure`, proxy HTTPS y CORS del dominio final;
- [ ] confirmar que no hay secretos ni credenciales por defecto en imagen/logs.

### Smoke productivo controlado

- [ ] login/logout y revocación de sesión;
- [ ] crear compra mínima, recibir y conciliar stock/costo;
- [ ] crear producción mínima, finalizar y cancelar;
- [ ] crear orden POS, enviar a cocina, cobrar, facturar y revertir en caso de prueba;
- [ ] abrir/cerrar caja y comparar efectivo esperado;
- [ ] crear/cancelar reserva;
- [ ] crear/revertir depósito bancario de prueba;
- [ ] subir logo, reiniciar contenedor y verificar persistencia;
- [ ] confirmar aislamiento con usuario de otra sucursal/empresa;
- [ ] revisar logs, latencia y errores 5xx durante la ventana.

### Decisión de canales externos

- [x] desactivar PEDIDOSYA mientras no exista `PedidosYaConfig`;
- [ ] mantener delivery genérico outbound apagado si no existe contrato real;
- [ ] para PedidosYa, validar secreto por tenant, firma real y catálogo mapeado;
- [ ] no habilitar un canal que dependa del endpoint outbound 501.

## 13. Reconciliaciones para cada release futuro

Ejecutar sobre una copia restaurada o mediante consultas de sólo lectura:

```text
Inventario:   Stock.quantity = suma de capas FIFO restantes (si método FIFO)
Kardex:       balance final por producto/almacén = Stock.quantity
Compras:      total = suma(items) y paidAmount = suma(pagos válidos)
Producción:   consumos + reversos netos = materiales de órdenes FINISHED no canceladas
Ventas:       total de órdenes válidas = ventas reportadas por el mismo filtro
Pagos:        suma activos = recaudación; revertidos sólo en auditoría
Caja:         cierre esperado = apertura + movimientos + pagos efectivos netos
Promociones:  usageCount = usos cobrados no revertidos
Facturas:     cada factura referencia orden tenant correcta y cobrada activamente
Depósitos:    un turno sólo pertenece a un depósito activo a la vez
```

## 14. Comandos de certificación repetible

Servidor:

```powershell
cd C:\restaurant\server
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test -- --runInBand
npm.cmd run test:integration
npm.cmd exec prisma validate
npm.cmd run build
npm.cmd audit --omit=dev
```

Cliente:

```powershell
cd C:\restaurant\client
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test -- --run
npm.cmd run test:e2e
npm.cmd run build
npm.cmd audit --omit=dev
```

Repositorio:

```powershell
cd C:\restaurant
git -c safe.directory=C:/restaurant diff --check
git -c safe.directory=C:/restaurant status --short
```

No debe sustituirse la validación de migraciones por `prisma db push` en producción. `db push` puede servir para la base desechable de tests, mientras que producción debe avanzar sólo mediante migraciones revisadas y backup restaurable.

## 15. Criterio de cierre

El núcleo queda en **GO técnico** con API/web saludables, migraciones aplicadas y gates P0 cerrados. Delivery genérico outbound permanece deshabilitado/documentado hasta existir contrato real. La asignación física de mesa y el reverso de pagos de catering forman parte del release.

Hasta entonces, la conclusión correcta es:

> El software transaccional central está desplegado, saludable y verificable. Permanecen como seguimiento las seis órdenes históricas ambiguas, la optimización del chunk PDF y cualquier integración externa que todavía no tenga contrato real.
