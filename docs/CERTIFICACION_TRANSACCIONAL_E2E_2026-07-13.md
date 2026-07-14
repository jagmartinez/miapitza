# Certificación transaccional integral end-to-end

**Proyecto:** Mia Pitza Restaurant System
**Fecha de corte:** 2026-07-14
**Objeto:** revisión de código y evidencia local de la candidata de release en el
workspace, excluyendo Recursos Humanos por instrucción expresa del Owner; no
constituye una validación fiscal, bancaria ni de proveedores externos.
**Prevalencia:** este documento reemplaza los dictámenes anteriores para cualquier
nueva liberación. Los informes previos quedan como antecedentes históricos.

## 1. Dictamen ejecutivo

### Veredicto global: NO-GO para producción irrestricta

El núcleo transaccional local fue revisado y corregido de extremo a extremo, pero
no es responsable declarar que el sistema completo está listo para producción sin
condiciones. La candidata sólo puede pasar a **GO condicionado** cuando se cierren
todos los gates de la sección 12 y se tome una decisión explícita sobre los
bloqueos de la sección 9.

Los motivos que impiden un GO irrestricto son:

1. RH continúa fuera de alcance y mezclado en el árbol candidato. El cliente ya
   compila y construye, pero queda una prueba de contrato exclusivamente RH fallida
   y dos warnings de lint exclusivamente RH; no se corrigieron ni se interpretan
   como evidencia funcional porque el Owner pidió no revisar ese módulo;
2. no existe un modelo fiscal de nota de crédito/anulación para devolver una venta
   después de emitir su factura; el sistema bloquea correctamente el reverso, pero
   el contraflujo fiscal no está implementado;
3. PedidosYa no se validó contra un sandbox/contrato real y no dispone de worker
   automático para reintentar sincronizaciones fallidas; el outbound genérico de
   delivery continúa deliberadamente deshabilitado;
4. esta revisión no desplegó la candidata ni ejecutó una ventana productiva;
5. una restauración representativa migró correctamente, pero su reconciliación
   detectó seis órdenes pagadas sin líneas, dos órdenes con total negativo y
   componentes activos con costo cero;
6. esta revisión no sustituyó el backup/restore obligatorio de la ventana real
   de release;
7. no existe una prueba formal de carga, soak, caos o recuperación bajo la
   concurrencia y el volumen reales de producción.

El resultado no promete ausencia matemática de defectos. Sí establece qué
invariantes fueron revisadas, qué errores se corrigieron, qué pruebas los cubren y
qué condiciones aún impiden certificar determinados escenarios.

## 2. Método, alcance y separación de responsabilidades

Se utilizaron tres cadenas especializadas y una consolidación independiente:

| Cadena | Alcance exclusivo |
|---|---|
| Física | compras, proveedores, unidades, inventario, kardex, FIFO/promedio, merma, recetas y órdenes de producción |
| Comercial | menú, marcas, modificadores, precios, promociones, órdenes, cocina, reservaciones, catering y delivery |
| Financiera/control | POS, split bill, pagos, factura, caja, arqueo, banco, reportes, empresas, sucursales, RBAC, autenticación y secretos |
| Consolidación | efectos cruzados, migraciones, regresión completa, silencios/fallbacks, hardcode, documentación y dictamen |

Recursos Humanos quedó explícitamente fuera del alcance cuando el Owner indicó
que continúa en desarrollo. En ese corte se detuvieron las revisiones RH y no se
intentó cerrar ni revertir el trabajo concurrente restante. Ninguna afirmación de
este documento certifica empleados, horarios, geocerca, contratos, asistencia o
nómina. Su efecto sobre el build global sí se registra como gate de integración.

Cada flujo se examinó con la misma lista:

1. identidad, empresa, sucursal y permisos del actor;
2. precondición y máquina de estados;
3. cantidades, unidades, costo, descuento, impuesto, pago y caja afectados;
4. atomicidad, locks, idempotencia y comportamiento concurrente;
5. cancelación, reverso, devolución y replay;
6. conciliación con inventario, kardex, pagos, caja, factura y reportes;
7. visibilidad del fallo: ningún error crítico debe convertirse silenciosamente en
   cero, `null`, éxito simulado o conversión 1:1.

La revisión cubrió servicios, controladores, rutas, Prisma, migraciones, cliente,
tests, seeds y scripts operativos. No se inspeccionaron internamente los sistemas
de terceros ni se certificó cumplimiento tributario del país.

## 3. Invariantes maestras

### 3.1 Tenant y sucursal

Todo recurso de negocio debe cumplir:

```text
recurso.companyId = actor.companyId
y, cuando el recurso es físico,
recurso.branchId pertenece a las sucursales permitidas del actor
```

Un ID recibido por URL o body nunca sustituye esa comprobación. Almacenes, mesas,
reservas, órdenes, métodos de pago, facturas y usuarios se resuelven dentro del
tenant. Las mutaciones físicas validan además la sucursal del almacén.

### 3.2 Unidades de medida

Para una unidad autorizada del producto:

```text
cantidadBase = cantidadIngresada × factorConversión
costoPorBase = costoPorUnidadIngresada ÷ factorConversión
valor = cantidadIngresada × costoPorUnidadIngresada
      = cantidadBase × costoPorBase
```

Cantidad, costo y factor deben ser finitos; cantidad/factor son mayores que cero y
el costo no puede ser negativo. La unidad debe estar activa, pertenecer a la misma
empresa y ser dimensionalmente compatible. Las unidades de empaque no se infieren
entre productos: caja, saco o paquete sólo se ofrecen cuando existe configuración
específica. No hay fallback 1:1 para una conversión desconocida.

### 3.3 Stock, promedio y FIFO

```text
nuevoPromedio =
  (stockAnterior × costoAnterior + entradaBase × costoEntradaBase)
  ÷ (stockAnterior + entradaBase)

stockFIFO = suma(cantidadRestante de capas activas)
COGS = suma(cantidadConsumidaPorCapa × costoDeLaCapa)
```

Una salida FIFO falla cerrada si capas y stock no reconcilian. Una reversión usa
capas compensatorias/trazables; no borra el movimiento histórico ni inventa costo.

### 3.4 Producción

`yieldQuantity` siempre se interpreta con una unidad explícita y una fuente
visible: unidad de la receta, unidad base del producto o dato legado identificado.
La misma unidad efectiva se usa para mostrar rendimiento y calcular costo por
unidad producida. Sólo una orden `IN_PROGRESS` puede finalizar; esa finalización
consume insumos y genera producto una sola vez. La cancelación restaura ambos lados
y reejecuta el costo histórico aplicable.

### 3.5 Venta, promoción y estados de orden

```text
subtotal = suma(cantidadEntera × precioAutorizadoDeSucursal + modificadores)
descuento = función única de promoción(subtotal)
total = max(0, subtotal - descuento) + impuesto + propina
cobradoActivo = suma(pagos ACTIVE en centavos)
saldo = total - cobradoActivo
```

El backend es autoritativo para precios, modificadores, promoción y saldo. La
orden posee dos ciclos independientes:

```text
Operación: OPEN → SENT_TO_KITCHEN → IN_PREPARATION → READY → DELIVERED
Finanzas:  UNPAID → PARTIAL → PAID
Contraflujo operativo: CANCELLED
```

Pagar no cocina, no mueve inventario, no entrega y no libera la mesa.
`READY → DELIVERED` requiere `financialStatus=PAID` —o total exactamente cero— y
el flujo dedicado exige una bodega `BRANCH` explícita de la sucursal. Ese cierre
consume inventario una sola vez; sólo la entrega o cancelación libera la mesa.
Revertir un pago no reescribe la realidad operativa ni repone producto entregado.

`closedAt` es la fecha de liquidación financiera y `deliveredAt` la fecha de
entrega. Los reportes de venta usan la primera; las métricas de servicio, la
segunda.

### 3.6 Pagos, factura y caja

Un pago es una fila inmutable `ACTIVE/REVERSED`. El reverso conserva monto,
actor, fecha y motivo. Para efectivo:

```text
efectivoEsperado = fondoInicial + movimientosIN - movimientosOUT
diferencia = efectivoContado - efectivoEsperado
```

El cobro en efectivo exige turno abierto del actor en la sucursal de la operación
y bloquea el turno contra un cierre concurrente. Un reembolso crea un movimiento
`OUT` compensatorio en un turno abierto; nunca modifica un turno cerrado.

Una factura sólo puede emitirse si `financialStatus=PAID`, la orden no está
cancelada y la suma de pagos activos cubre el total bajo lock. Una factura emitida
bloquea el reverso ordinario porque el sistema todavía no tiene nota de crédito.

## 4. Matriz end-to-end por módulo

| Módulo | Camino principal | Contraflujo/reconciliación | Resultado |
|---|---|---|---|
| Empresas y sucursales | catálogo tenant, sucursal activa, configuración | IDs de otro tenant/sucursal rechazados | Verificado localmente |
| Usuarios, roles y sesiones | alta, roles múltiples, sucursal permitida, cookie/Bearer | sesión revocada, password obligatorio, error de infraestructura 5xx | Verificado localmente |
| Recursos Humanos | en desarrollo concurrente | no auditado por instrucción del Owner | **Fuera de alcance; 1 prueba de contrato y 2 warnings RH pendientes** |
| Marcas/categorías/menú | marca, categoría, disponibilidad y precio por sucursal | registro ajeno/inactivo rechazado | Verificado localmente |
| Proveedores/compras | borrador, emisión, recepción, costo, stock, contado/crédito | reverso de abono y recepción inmutables; edición sólo en estado válido | Verificado localmente |
| UOM/product units | entrada en unidad permitida a cantidad/costo base | incompatible, inactiva, ajena o no configurada falla | Verificado localmente |
| Inventario/kardex | entrada, salida, transferencia, capas y valorización | stock insuficiente o deriva capas-stock falla cerrada | Verificado localmente |
| Merma/desperdicio | salida convertida y valorizada con motivo | reporte agrupa por unidad; no suma kg con L/unidades | Verificado localmente |
| Recetas de producción | versión, componentes, rendimiento/unidad, costo estimado | dependencia/ciclo/UOM inválida bloquea activación/cálculo | Verificado localmente |
| Órdenes de producción | plan, consumo, rendimiento real, alta de producto | cancelación restaura insumos, producto, capas y costo | Verificado localmente |
| Modificadores/precios | actividad, tenant, min/max y precio dinámico | opción inactiva, ajena o exceso rechazado | Verificado localmente |
| Promociones | vigencia, código, límite y cálculo único | límite concurrente y decremento al perder pago completo | Verificado localmente |
| Órdenes/POS | creación, líneas enteras, cocina, prepago/pago y entrega | cancelar/revertir sin mezclar estado financiero/operativo | Verificado localmente |
| Cocina/KDS | enviar, iniciar y terminar por ítem; todo listo | no acepta vacío, línea no enviada ni salto de estado | Verificado localmente |
| Split bill | partes, pagadores, asignación y saldo en centavos | retry conserva body/key y no cobra dos veces | Verificado localmente |
| Facturación POS | secuencia, pago activo, tenant y PDF | bloquea reverso posfactura; falta nota de crédito | **Bloqueado para devoluciones fiscales** |
| Caja/arqueo | apertura, IN/OUT, conteo, tolerancia y cierre | lock contra pago concurrente; diferencia requiere nota/override | Verificado con límite multimoneda |
| Conciliación bancaria | turnos cerrados, depósito, periodo y reverso | vínculo inmutable y exclusión de depósito revertido | Verificado con límites operativos |
| Reservaciones/mesas | disponibilidad, confirmación y check-in | check-in atómico crea una orden y ocupa mesa una vez | Verificado localmente |
| Catering | cotización, reserva, pago, ejecución e inventario | reverso inmutable, rollback UOM/inventario y efectivo compensatorio | Verificado localmente, incluido efectivo y replay |
| PedidosYa | webhook tenant/HMAC, mapeo exacto y estado durable | error queda `FAILED`; no se simula sincronización de menú | Condicionado a sandbox/worker |
| Delivery genérico | validación de firma y tenant de entrada | outbound sin contrato devuelve 501 | No habilitar |
| Reportes | venta conciliada por `financialStatus/closedAt`, servicio por `deliveredAt` | fechas/rangos inválidos 400; UOM inválida falla el reporte | Verificado localmente |
| Offline/idempotencia | replay opt-in con key/fingerprint durable | payload distinto 409; error no consume la key | Parcial: no certifica cadenas offline arbitrarias |
| Backup/migraciones | scripts de backup, restore, baseline y deploy | nombres de DB de prueba protegidos | Requiere ensayo sobre copia del release |

## 5. Hallazgos materiales y correcciones

| ID | Severidad | Hallazgo | Corrección/estado |
|---|---|---|---|
| TX-01 | P0 | `Order.status=PAID` mezclaba cocina con cobro; un prepago podía sacar la orden del KDS y liberar mesa | `OrderFinancialStatus`, `deliveredAt`, backfill, estados separados, reportes/cliente/tests migrados |
| TX-02 | P0 | recepción de compra sin reverso físico completo | reverso transaccional sólo si no hay abonos activos y las capas originales pueden consumirse exactamente |
| TX-03 | P1 | abonos de compra no tenían ledger de reverso | `ACTIVE/REVERSED`, actor, fecha, motivo y recálculo de saldo |
| TX-04 | P0 | conversiones podían anunciar empaque no configurado o degradar a 1:1 | empaque estrictamente por producto y fallos UOM visibles |
| TX-05 | P1 | rendimiento/unidad de receta productiva no era explícito y podía divergir del costo | unidad efectiva y fuente compartidas entre tabla, detalle y cálculo |
| TX-06 | P1 | merma sumaba cantidades físicamente incompatibles | totales por unidad y por razón+unidad |
| TX-07 | P0 | pago dividido/retry podía recalcular cuerpos e identidades después de una respuesta perdida | body, payer y key congelados; saldo autoritativo del servidor |
| TX-08 | P0 | revertir un pago podía reescribir estado operativo o caja cerrada | ledger de pago + OUT compensatorio; operación intacta |
| TX-09 | P1 | reportes confundían entrega, creación y fecha de cobro | `closedAt` financiero, `deliveredAt` operativo y filtros por dominio |
| TX-10 | P1 | conciliación trataba reversos por fecha de creación, no por fecha del reverso | bruto por `createdAt`, devolución por `reversedAt`, centavos y tolerancia |
| TX-11 | P1 | check-in de reserva y creación de orden podían separarse/repetirse | vínculo único `Order.reservationId` y transacción con locks |
| TX-12 | P1 | autenticación devolvía 401 ante fallos de DB/sesión/configuración | JWT inválido 401; fallo interno pasa al error handler como 5xx |
| TX-13 | P0 | seeds/scripts podían usar credenciales conocidas y rondas bcrypt divergentes | política única, bcrypt 12, límite 72 bytes y guardas demo |
| TX-14 | P1 | lógica de caja/banco dependía de nombres libres del medio de pago | `PaymentMethod.type` semántico y migración conservadora; Efectivo/Tarjeta/Transferencia quedaron clasificados en el restore |
| TX-15 | P0 | efectivo de catering no se registraba/revertía en el turno | IN/OUT ligado a pago, actor, sucursal y turno; auditor histórico del restore limpio |
| TX-16 | P1 | varios catches/fallbacks ocultaban costo, fechas o sincronización | los cálculos críticos fallan con error contextual; fallbacks UI no transaccionales permanecen identificados |
| TX-17 | P0 abierto | no existe nota de crédito/anulación fiscal | bloqueo seguro implementado; requiere requisitos/modelo fiscal antes de habilitar devoluciones posfactura |
| TX-18 | Fuera de alcance | módulo RH incorporado concurrentemente durante la certificación | no se emite dictamen funcional; su WIP debe aislarse o cerrar sus gates antes de liberar |
| TX-19 | P0 datos | componentes activos y stock heredado carecen de costo efectivo | gate de restore los identifica por producto y contexto; requiere valoración y recálculo antes del go-live |
| TX-20 | P0 datos | seis ventas pagadas no tienen líneas y dos canceladas conservan total negativo | sin saneamiento automático; requiere resolución contable trazable |
| TX-21 | P0 | cobrar o revertir un pago también movía inventario y mezclaba el hecho financiero con la entrega física | `PaymentService` quedó estrictamente financiero; sólo el cierre operativo consume, y el reembolso de una entrega no repone comida ya entregada |
| TX-22 | P0 | entrega/cancelación podían inferir bodega o atravesar el estado genérico `DELIVERED` | cierre dedicado exige bodega `BRANCH` de la sucursal y actor válido; la cancelación preparada registra `WASTE`; una entrega nunca se repone por cancelar/reembolsar |
| TX-23 | P1 | el significado del medio y el actor podían cambiar después del pago; retries dependían sólo del middleware | snapshot `methodType`, FKs de actor, llave idempotente de dominio e índices únicos para pagos POS/catering |
| TX-24 | P1 | una promoción del 100% dejaba una orden de total cero sin posibilidad de cierre | el cierre atómico marca saldo cero como pagado, registra uso una sola vez y entrega sin crear un pago ficticio |
| TX-25 | P1 | tests de integración todavía legitimaban pago=stock, `PATCH DELIVERED` y producción finalizada desde borrador | contratos reemplazados por preparación→pago→bodega→entrega, contraflujo explícito y `IN_PROGRESS` obligatorio |

## 6. Migraciones y compatibilidad

El alcance certificado incorpora estas migraciones posteriores al corte anterior:

1. `20260713_add_atomic_reservation_checkin`;
2. `20260713_add_purchase_payment_reversals`;
3. `20260713_separate_order_financial_status`;
4. `20260713_add_payment_method_types`;
5. `20260714_harden_financial_payment_audit`.

El árbol contiene además `20260713_add_hr_foundation`,
`20260713_add_hr_weekly_scheduling` y
`20260713_hr_03_attendance_biometrics`. Las tres pertenecen al desarrollo RH
excluido y no forman parte del dictamen.

La migración financiera:

- calcula `financialStatus` sólo con pagos `ACTIVE`;
- normaliza `closedAt`: sólo las órdenes pagadas conservan/reciben fecha;
- convierte el valor operativo legado `PAID` a `DELIVERED`;
- asigna `deliveredAt` histórico usando `updatedAt` como aproximación explícita;
- elimina `PAID` del enum operativo después de convertir filas.

La migración de medios de pago sólo clasifica nombres históricos exactos y
conocidos. Los nombres personalizados quedan `OTHER` para evitar inferir que un
método mueve efectivo. Deben clasificarse conscientemente antes del go-live.

El baseline `server/prisma/baseline/20260713_schema.sql` fue generado y verificado
contra un conjunto histórico de 23 directorios. Ese conjunto mezclaba la primera
migración RH y todavía no incluía el endurecimiento financiero del 2026-07-14. El
árbol actual tiene 26 directorios: 23 core y 3 RH. Por ello el baseline queda
**obsoleto y no liberable** hasta congelar el alcance definitivo, regenerarlo y
repetir la verificación desde una base vacía. Nunca debe aplicarse sobre una
instalación existente ni sustituir un backup con datos y `_prisma_migrations`.

**Conteo observado actual:** 26 directorios, de los cuales se excluyeron por nombre
exacto los 3 de RH. El ensayo validado restauró el backup en 18 y aplicó con éxito
las 5 faltantes del alcance core hasta 23, incluidas las restricciones financieras
del 2026-07-14; 0 migraciones fallidas.

## 7. Evidencia automatizada del corte

| Gate | Resultado final |
|---|---:|
| Server ESLint | Aprobado, 0 errores; 2 warnings sólo en `hr-workforce.service.ts`, fuera de alcance; focal core 0 warnings |
| Server TypeScript | Aprobado |
| Server unitarias | 73/73 suites, 364/364 pruebas aprobadas; las RH ejecutadas incidentalmente no se certifican |
| Server integración MySQL | 9/9 suites, 38/38 pruebas aprobadas |
| Prisma validate/generate | Schema actual válido; generación y server build aprobados |
| Restore/migraciones core | Backup 65 tablas/2,549 filas; 18→23 migraciones core, 0 fallidas; baseline histórico sigue obsoleto |
| Server build | Aprobado |
| Client ESLint | Aprobado, 0 errores |
| Client TypeScript | Aprobado |
| Client Vitest | 22/23 archivos y 74/75 pruebas; único fallo: contrato `internalOnly` de RH fuera de alcance |
| Client Playwright | 14/14 aprobadas; 10 del alcance y 4 RH incidentales no certificadas |
| Client build | Aprobado; warning no funcional por chunk `react-pdf` de 1.575 MB |
| npm audit runtime server/client | 0 vulnerabilidades en ambos |
| `git diff --check` | Aprobado |

Escenarios de regresión obligatorios incluidos:

- compra → recepción → UOM base → costo/capa/stock → reverso exacto;
- crédito → abonos concurrentes → reverso → saldo/estado;
- transferencia/merma con cantidad y costo reconciliables;
- producción → consumo → rendimiento/producto → cancelación;
- promoción concurrente → pago → pérdida del pago → contador restaurado;
- prepago en `OPEN` → continúa en KDS → `READY` → entrega pagada;
- parcial → completo → reverso parcial/total sin cambiar estado operativo;
- split con retry después de respuesta perdida sin doble cobro;
- factura rechaza pago insuficiente/revertido y tenant ajeno;
- caja registra pago/reembolso en turno correcto y no reabre turno cerrado;
- reservación confirmada → check-in repetido devuelve la misma orden;
- catering con UOM inválida hace rollback de estado, stock, capas y movimientos;
- pago/reverso efectivo de catering concilia con turno y banco;
- reportes cuentan ventas por cierre financiero y duración por entrega.

La cobertura de líneas del conjunto unitario medida durante la revisión fue
aproximadamente 37 %. Es una señal de límite, no un gate aprobado: la evidencia
fuerte está concentrada en servicios críticos e integraciones, pero gran parte de
controladores, UI y ramas excepcionales carece de cobertura directa.

### 7.1 Ensayo sobre copia productiva

Se restauró `production-pre-deploy-20260712-1840.ndjson.gz` en una base aislada:

- 65 tablas y 2,549 filas coincidieron con el footer del backup;
- `_prisma_migrations` pasó de 18 a 23, excluyendo por nombre exacto las 3
  migraciones RH, sin migraciones fallidas;
- se comprobaron 142 claves foráneas del esquema core y 19 invariantes;
- los métodos Efectivo, Tarjeta y Transferencia quedaron respectivamente como
  `CASH`, `CARD` y `BANK_TRANSFER`;
- el auditor de efectivo de catering quedó limpio;
- el gate de integridad falló, correctamente, por datos heredados.

Muestras exactas del fallo de datos:

| Contexto | IDs/productos | Evidencia |
|---|---|---|
| Ventas pagadas sin líneas | órdenes 3, 6, 10, 15, 19 y 23 | `financialStatus=PAID`, 0 ítems y pagos activos entre C$80 y C$200 |
| Totales negativos | órdenes canceladas 8 y 21 | total -C$50 y -C$100 por descuento sobre orden vacía |
| Stock sin costo utilizable | productos 58 y 176 | cantidades 1 y 500; ambos productos hoy inactivos, pero el stock histórico debe valorarse o depurarse con trazabilidad |
| Receta de menú sin costo | PIÑA GOLDEN, MIEL, Carne Della Nonna y Masa precocida | afectan Maui Pitza, Della Nonna y múltiples pizzas activas; costo/margen quedan subestimados |
| Receta productiva sin costo | Agua de proceso | componente de Masa integral y Té preparado; validar si costo cero es política real y documentada |

La base aislada se eliminó al terminar. No se modificó producción ni se aplicó un
saneamiento automático.

## 8. Silencios, hardcode y redundancia

La revisión estática distinguió entre fallbacks de presentación y fallos que
alteran dinero/cantidades:

- UOM, inventario, pago y factura no publican éxito si el cálculo autoritativo
  falla; los reportes todavía usan costo 0 cuando promedio y referencia no están
  configurados, por lo que el verificador de restore lo convierte en bloqueo
  visible en vez de permitir un GO con márgenes subestimados;
- la lista de recetas puede devolver `cost=null` acompañado por `costError`; no lo
  presenta como costo cero;
- una credencial cifrada de PedidosYa que no puede descifrarse devuelve `null` con
  log y la operación posterior falla; nunca simula sincronización;
- algunas vistas toleran fallos de widgets secundarios devolviendo `null` para que
  el perfil cargue. Es degradación visual, no confirmación transaccional;
- auditorías de varias entidades de catálogo siguen siendo best-effort
  post-commit. Los ledgers de pago, caja, compra y cancelación crítica sí viven en
  la transacción; el `AuditLog` genérico no debe venderse como bitácora de
  cumplimiento completa;
- se eliminó el mapeo duplicado y sin consumidores de estados de orden;
- se eliminó el script JavaScript duplicado de reset de contraseña;
- URLs `localhost`, símbolo `C$` y tasa 36.5 permanecen únicamente como defaults
  de desarrollo/operación documentados. Para otra moneda deben configurarse; el
  arqueo físico continúa modelando explícitamente moneda local + USD.
- el fallback de unidad visible en Recetas de Producción ahora usa, en orden, la
  unidad efectiva del API, la unidad explícita de rendimiento, la unidad base del
  producto y el dato legado; Playwright cubre rendimiento explícito y base.

## 9. Riesgos, bloqueos y límites residuales

| Prioridad | Riesgo/límite | Decisión requerida |
|---|---|---|
| P0 | RH está fuera de alcance pero permanece mezclado en la candidata; conserva 1 prueba de contrato y 2 warnings propios | aislar RH de la candidata o terminar su desarrollo y ejecutar una certificación RH separada antes de volver a mezclarlo |
| P0 | Nota de crédito/anulación fiscal ausente | definir numeración, impuestos, motivo, autorización, ledger, caja e impresión; implementar y probar antes de devoluciones posfactura |
| P0 | Órdenes 3, 6, 10, 15, 19 y 23 pagadas sin líneas | resolver con Contabilidad mediante asiento/remediación trazable; no borrarlas ni inventar líneas |
| P0 | Órdenes canceladas 8 y 21 con total negativo | reconstruir la causa, corregir histórico de forma auditada y confirmar que reportes no lo incorporan |
| P0 | Cuatro componentes de menú activos y uno productivo con costo cero | Compras/Contabilidad debe fijar costo o aprobar explícitamente cero; recalcular recetas, COGS y márgenes |
| P1 | Stock positivo sin costo de productos inactivos 58 y 176 | valorar, transferir o depurar mediante movimientos trazables; no editar saldo/costo directo |
| P1 | PedidosYa no validado externamente | mantener desactivado hasta sandbox, firma real, catálogo, comisiones y reconciliación |
| P1 | Sin worker automático de retry PedidosYa | operar cola/manual o implementar backoff, alerta y dead-letter |
| P1 | Delivery genérico outbound 501 | no habilitar Uber/Rappi/otro sin contrato, secretos y adapter real |
| P1 | Depósito bancario exige suma completa de turnos | confirmar si la operación necesita fondo retenido, depósitos parciales o varios depósitos por turno; modelar antes de usar esos casos |
| P1 | Reversos genéricos de merma/transferencia no conservan siempre la asignación FIFO original por capa | persistir el linaje de capas cuando se habilite un reverso exacto; hoy evitar reversos genéricos y usar movimientos compensatorios trazables |
| P1 | Límites de autenticación viven en memoria del proceso | mover rate limit/lockout a almacenamiento compartido antes de escalar a múltiples réplicas |
| P1 | Recepción y salida productiva no congelan todos los timestamps/UOM históricos como snapshots inmutables | definir snapshots si auditoría histórica debe sobrevivir cambios posteriores de catálogo/unidad |
| P1 | Arqueo sólo moneda local + USD | parametrizar denominaciones/tasas si se operan otras monedas; no tratarlo como motor multimoneda genérico |
| P1 | AuditLog de catálogo best-effort | si existe exigencia legal, mover eventos requeridos a outbox/ledger transaccional |
| P1 | Offline no certifica grafos arbitrarios de dependencias | limitar a operaciones con contrato explícito e idempotencia; probar cada cadena que se habilite |
| P1 | Sin load/soak/chaos | medir concurrencia de caja, pagos, recepción, producción, KDS/WebSocket y pool DB |
| P2 | `minStock` sigue siendo global al producto aunque el stock sea por bodega | decidir si el umbral operativo debe modelarse por bodega/sucursal antes de automatizar reposición |
| P2 | bundle `react-pdf` genera un chunk de 1.575 MB | aplicar lazy loading/code splitting; no altera cálculos, pero sí tiempo de carga |
| P2 | Cobertura unitaria global baja | elevar por riesgo, no por porcentaje cosmético; priorizar rutas de error y permisos |
| P2 | Fecha histórica `deliveredAt` aproximada | aceptar sólo para análisis histórico o reconstruir desde auditoría si se necesita precisión SLA |
| P2 | Conciliación bancaria sin importación de extracto | hoy es registro/conciliación manual; no afirmar matching bancario automático |

## 10. Reconciliaciones obligatorias

Ejecutar sobre una restauración o consultas de sólo lectura antes y después de cada
release:

```text
UOM:          valor ingresado = cantidadBase × costoPorBase
Costos:       stock positivo y componentes activos tienen costo efectivo > 0, salvo política cero aprobada
Stock FIFO:   Stock.quantity = suma(capas restantes)
Kardex:       saldo inicial + IN - OUT = Stock.quantity por producto/almacén
Compras:      paidAmount = suma(abonos ACTIVE); total = suma(líneas)
Producción:   consumos netos y producto neto corresponden a órdenes FINISHED no canceladas
Órdenes:      subtotal/discount/tax/tip reconstruyen total en centavos
Finanzas:     financialStatus deriva sólo de suma Payment ACTIVE
Fechas:       PAID implica closedAt; no PAID implica closedAt NULL
Cocina:       DELIVERED implica deliveredAt; activos no tienen deliveredAt
Promoción:    usageCount = usos que alcanzaron pago completo y no perdieron ese estado
Caja:         cierre = fondo + IN - OUT; cada efectivo tiene movimiento y cada reverso su compensación
Factura:      factura → orden no cancelada y totalmente pagada con pagos ACTIVE
Banco:        un turno sólo enlaza un depósito ACTIVE; depósitos revertidos quedan históricos
Reservas:     una reservación tiene como máximo una Order por reservationId
```

El script de verificación de restauración debe fallar si detecta deriva entre pagos
activos, `financialStatus`, `closedAt`, estado operativo o `deliveredAt`.

## 11. Runbook de liberación y rollback

### Antes de desplegar

1. congelar la candidata y no mezclar cambios ajenos después de los gates;
2. aislar RH de esta candidata o esperar a que su desarrollo tenga build y
   certificación propios;
3. confirmar que `git diff --check`, lint, tipos, tests, builds y auditorías están
   verdes en el mismo commit;
4. generar backup lógico consistente y checksum;
5. restaurarlo en una base aislada terminada en `_restore_test`;
6. ejecutar `prisma migrate deploy` sobre la copia y las reconciliaciones de la
   sección 10;
7. regenerar el baseline después del freeze definitivo y verificarlo desde una
   base completamente vacía;
8. revisar secretos sin imprimirlos: `DATABASE_URL`, `JWT_SECRET`, cifrado 2FA,
   orígenes CORS, URLs públicas, storage y empresa operadora de backup;
9. resolver órdenes/costos ambiguos y clasificar métodos de pago personalizados;
10. mantener apagados canales externos sin contrato validado.

### Smoke controlado

- login/logout, cambio obligatorio de contraseña y revocación de sesión;
- aislamiento con dos empresas y dos sucursales;
- compra mínima, recepción, costo/stock y reverso;
- producción mínima, finalización y cancelación;
- orden de mesa, cocina, pago parcial/completo, entrega y factura;
- reverso de pago no facturado y compensación de caja;
- apertura, conteo, cierre y depósito/reverso bancario;
- reserva, check-in idempotente y liberación de mesa;
- catering con pago efectivo, ejecución y reverso permitido;
- reinicio de API y persistencia de uploads/backups;
- cero 5xx inesperados y cero errores de consola durante la ventana.

### Rollback

No usar `git reset`, `prisma db push` ni SQL manual improvisado. Detener tráfico,
conservar logs, revertir la aplicación y restaurar el backup si una migración o
reconciliación falla. Los pagos/reversos realizados después del backup requieren
un plan contable explícito antes de restaurar para no perder ledger real.

## 12. Gates para cambiar el veredicto

- [x] evidencia automatizada y limitaciones registradas sin placeholders;
- [x] núcleo no-RH con cero errores de lint, tipos, build, tests, audit y whitespace;
- [ ] árbol completo sin warnings/fallos: queda 1 prueba y 2 warnings sólo RH, fuera
      del alcance de este dictamen;
- [ ] baseline final regenerado y verificado después de congelar el alcance del release;
- [x] las 23 migraciones core ensayadas sobre restauración representativa, 0 fallidas;
- [ ] las 3 migraciones RH revisadas únicamente cuando comience su certificación separada;
- [x] métodos de pago existentes en el restore clasificados por tipo;
- [ ] seis ventas sin líneas, dos totales negativos y costos cero resueltos;
- [ ] decisión firmada sobre nota de crédito: implementada o devoluciones
      posfactura explícitamente fuera de alcance y bloqueadas operativamente;
- [ ] canales externos no validados desactivados;
- [ ] módulo RH terminado y certificado por separado, o excluido físicamente del release;
- [ ] backup restaurable, storage persistente, secretos y smoke aprobados;
- [ ] monitoreo y responsables de rollback disponibles durante la apertura.

## 13. Comandos repetibles

Servidor:

```powershell
cd C:\restaurant\server
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:unit -- --runInBand
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

Repositorio/baseline:

```powershell
cd C:\restaurant
git -c safe.directory=C:/restaurant diff --check

cd C:\restaurant\server
npm.cmd exec ts-node -- --transpile-only scripts/generate-prisma-baseline.ts --out prisma/baseline/20260713_schema.sql
npm.cmd run db:baseline:verify -- --file prisma/baseline/20260713_schema.sql --target-database codex_audit_restore_test

# Para auditar el core mientras RH continúa expresamente fuera de alcance:
npm.cmd run db:restore -- --file backups/production-pre-deploy-20260712-1840.ndjson.gz --target-database codex_core_restore_test
npm.cmd run db:rehearse-migrations:excluding -- --target-database codex_core_restore_test --exclude 20260713_add_hr_foundation --exclude 20260713_add_hr_weekly_scheduling --exclude 20260713_hr_03_attendance_biometrics
npm.cmd run db:verify-restore -- --target-database codex_core_restore_test
npm.cmd run db:drop-restore -- --target-database codex_core_restore_test
```

## 14. Protocolo para futuras revisiones

Toda nueva revisión debe partir de este documento y registrar:

1. commit exacto, fecha, schema y número de migraciones;
2. cambio de reglas de negocio y de invariantes;
3. flujo principal, contraflujo, concurrencia, tenant y reconciliación afectados;
4. fixtures de producción usados, anonimizados, y anomalías encontradas;
5. pruebas nuevas que habrían fallado antes de la corrección;
6. resultados completos de gates, cobertura y ensayo de restore/migraciones;
7. riesgos aceptados con dueño y fecha, no frases genéricas de “pendiente”;
8. decisión GO/NO-GO separando código local, datos, infraestructura, fiscalidad e
   integraciones externas.

La certificación sólo cambia a **GO** cuando no quedan placeholders, gates
obligatorios ni bloqueos incompatibles con el alcance operativo que realmente se
va a habilitar.

## 15. Artefactos clave para la siguiente auditoría

- Esquema y migraciones: `server/prisma/schema.prisma` y los cinco directorios
  core nuevos de la sección 6. Los tres directorios RH deben revisarse únicamente
  en la certificación separada de ese módulo.
- Ensayo aislado: `server/scripts/rehearse-migrations-with-exclusions.ts` exige una
  base terminada en `_restore_test` y exclusiones por nombre exacto; nunca muta la
  carpeta real de migraciones.
- Verificación de datos: `server/scripts/verify-restored-database.ts`, que ahora
  incluye muestras de órdenes y productos cuando falla integridad.
- Caja catering: `server/src/services/catering-cash-ledger-audit.service.ts` y
  `server/src/scripts/audit-catering-cash-ledger.ts`.
- Flujos comerciales: `order.service.ts`, `payment.service.ts`,
  `reservation.service.ts`, `catering.service.ts` y `pedidosya.service.ts`.
- Cadena física: `purchase-order.service.ts`, `inventory-engine.service.ts`,
  `unit-conversion.service.ts`, `production-order.service.ts` y
  `production-recipe.service.ts`.
- Evidencia focal: pruebas `commercial-chain`, `transactional-redteam`,
  `purchase-order`, `production`, `unit-conversion`, `bank-reconciliation`,
  `catering-cash-ledger-audit` e integraciones POS/recetas/compras/catering.
- Cliente: `PaymentModal.tsx`, `Catering.tsx`, `ProductionRecipes.tsx`,
  `orderStatus.ts`, `paymentAccess.ts` y el contrato de idempotencia compartido.
