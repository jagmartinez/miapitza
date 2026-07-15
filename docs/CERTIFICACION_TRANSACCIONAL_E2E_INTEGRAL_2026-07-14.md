# Certificación transaccional end-to-end integral

**Sistema:** Mia Pitza Restaurant System
**Fecha de corte:** 2026-07-14
**Zona de referencia:** America/Managua
**Corte inicial inspeccionado:** `3163cb6` (`main`, coincidente con `origin/main` al iniciar)
**Estado del candidato:** candidato técnico consolidado; la revisión congelada será el commit que contiene este documento (`git rev-parse HEAD`); no desplegado
**Producción observada:** backend `3163cb6`; web `acbd271`; MySQL 9.4; despliegues reportados como exitosos
**Prevalencia:** este documento sustituye los dictámenes anteriores como base para la próxima liberación. Los documentos previos conservan valor histórico, pero no autorizan un despliegue nuevo.

## 1. Dictamen ejecutivo

### Veredicto global: NO-GO para producción

La revisión profunda, corrección y regresión del candidato local terminó. El
código revisado supera todos los gates automáticos ejecutables en este entorno:
unitarias, integración MySQL, contratos del cliente, navegador, TypeScript, lint,
build, Prisma, auditoría de dependencias y ensayo completo de migraciones sobre una
restauración aislada.

No obstante, **no es responsable certificar todavía un GO productivo**. Se cerraron
varios puntos técnicos, pero persisten condiciones externas, legales, operativas y
de datos que el código no puede resolver sin evidencia del negocio:

1. la base productiva aún contiene componentes de menú `172`, `310`, `373`, el
   componente productivo `404` y existencias positivas `58`, `176` con costo
   efectivo cero. El `374` fue resuelto técnicamente: tenía una receta activa cuyo
   costo multinivel no era seguido por el auditor;
2. se implementó el ciclo de anulación fiscal previo a entrega/pago y nota de
   crédito total posterior a entrega/pago, con identidad tributaria completa e
   inmutable del cliente. Falta homologación legal/DGI, configuración fiscal
   firmada y validación con los procesadores de pago reales;
3. RH ganó custodia documental fail-closed, contratos/compensación versionados,
   conciliación paralela de nómina y adaptador biométrico HTTP real. Siguen sin
   existir un motor estatutario nicaragüense firmado, evidencia de nómina paralela,
   homologación de almacenamiento/proveedor y varios submódulos operativos;
4. se generó un backup productivo actual, se verificó su checksum, se restauraron
   exactamente 134 tablas/2,753 filas y se aplicaron las cuatro migraciones del
   candidato en una base aislada. Falta probar cifrado/custodia externa y rollback
   de ventana con RTO/RPO;
5. el candidato queda congelado en el commit que contiene este documento, pero no
   está desplegado porque conserva bloqueos P0. Producción permanece sin cambios;
6. carga corta, soak corto y caos contractual local quedaron verdes. Faltan
   impresoras, caja y dispositivos físicos, proveedores reales, soak de 2–8 horas,
   carga equivalente, observabilidad y rollback cronometrado en staging.

La decisión correcta es: **código candidato técnicamente verde; liberación global
bloqueada hasta cerrar la sección 11**. Este documento no promete ausencia
matemática de defectos. Sí deja trazabilidad de lo revisado, corregido, probado y
pendiente.

## 2. Alcance y método

La certificación incluyó backend, frontend, esquema Prisma, migraciones, rutas,
controladores, servicios, validadores, permisos, contratos UI, pruebas, scripts de
backup/restore y lectura segura de invariantes en producción.

Se ejecutaron tres cadenas especializadas sin solapamiento y una consolidación
independiente:

| Cadena | Responsabilidad exclusiva |
|---|---|
| Física | proveedores, compras, unidades, inventario, almacenes, FIFO, costo, kardex, transferencias, merma, recetas y producción |
| Comercial | menú, marcas, categorías, promociones, POS, órdenes, cocina, mesas, reservas, catering, delivery e integraciones |
| Recursos Humanos | empleados, estructura, horarios, asistencia, biometría, fuerza laboral, beneficios, nómina, permisos y baja |
| Consolidación raíz | facturación, caja/banco, empresas/sucursales, autenticación/RBAC, efectos cruzados, producción real, migraciones, restauración y regresión global |

Cada cadena trabajó en loop:

1. mapear vista, API, servicio, modelo, estado y reporte;
2. revisar camino principal y contraflujo;
3. corregir el defecto en la capa autoritativa;
4. añadir o actualizar una regresión;
5. ejecutar pruebas focales;
6. releer la implementación corregida buscando bypasses, duplicidad, fallback o
   condición de carrera;
7. repetir hasta no conservar defectos conocidos corregibles dentro de su alcance;
8. entregar riesgos residuales al consolidador.

Para cada transacción se evaluaron:

- actor, permiso, empresa, sucursal y fecha local efectiva;
- precondición, transición y estado terminal;
- unidad, cantidad, costo, descuento, impuesto, propina y total;
- stock, capas FIFO, kardex, pagos, caja, factura y reportes;
- locks, CAS, idempotencia, atomicidad y reintento;
- cancelación, reverso, devolución, expiración y purga;
- fallos silenciosos: `catch` que retorna cero/`null`, conversión 1:1, dato maestro
  mutable, éxito simulado y cálculo duplicado.

## 3. Evidencia de gates

| Gate | Resultado | Evidencia observada |
|---|---:|---|
| Unitarias servidor | PASS | 103 suites, 542 pruebas, 0 fallos |
| Integración servidor/MySQL | PASS | 10 suites, 40 pruebas, 0 fallos, incluido contraflujo fiscal real |
| Cliente Vitest | PASS | 41 archivos, 156 pruebas, 0 fallos |
| Navegador Playwright | PASS | 18/18 en Chromium, modo CI, servidor limpio, un worker |
| TypeScript servidor | PASS | `tsc --noEmit`, 0 errores |
| TypeScript cliente | PASS | incluido en build, 0 errores |
| ESLint servidor/cliente | PASS | 0 errores y 0 warnings con `--max-warnings=0` |
| Lint focal del auditor Prisma | PASS | archivo no ignorado, 0 hallazgos |
| Build servidor | PASS | Prisma generate + TypeScript |
| Build cliente | PASS | 2,641 módulos; advertencia no bloqueante por chunk PDF de 1,575.33 KB/528.32 KB gzip |
| Prisma validate | PASS | esquema válido |
| Auditoría npm producción | PASS | servidor 0; cliente 0 vulnerabilidades en dependencias de runtime |
| `git diff --check` | PASS | sin errores de whitespace; sólo avisos de normalización LF/CRLF |
| Restore lógico aislado actual | PASS | 134 tablas, 2,753 filas restauradas exactamente desde producción |
| Ensayo de migraciones | PASS | 39 directorios detectados; 4 migraciones candidatas pendientes y aplicadas; 0 sin resolver |
| Verificación estructural restore | PASS | 413 relaciones FK; 19 invariantes; 41 registros de migración, 0 sin resolver y 2 rollbacks históricos |
| Harness carga local | PASS | 300/300, 0 fallos, p95 31.01 ms, 865.79 req/s |
| Harness soak local 5 s | PASS | 7,109/7,109, 0 fallos, p95 8.04 ms, 1,421.11 req/s |
| Caos contractual local | PASS | webhooks sin firma 401, JSON excesivo 413, WS no autenticado 4001 y recuperación readiness 200 |
| Docker Compose estructural | PASS condicionado | configuración válida; la clave real `TWO_FA_ENCRYPTION_KEY` aún debe inyectarse en producción |

### Incidente del gate de navegador

El primer intento dentro del sandbox falló al crear Chromium (`spawn EPERM`), una
restricción del runner y no de la aplicación. Una repetición fuera del sandbox
detectó además un Vite huérfano ocupando el puerto; se detuvo ese proceso y se
repitió desde cero con `CI=1`, servidor efímero y un worker. El resultado limpio
fue 18/18 en 16.5 segundos. El gate futuro debe conservar esas condiciones y no
reutilizar un servidor previo.

## 4. Evidencia de la base productiva

Se añadió y ejecutó un auditor explícitamente protegido por
`ALLOW_PRODUCTION_READONLY_AUDIT=true`. Abre `START TRANSACTION READ ONLY`, no
extrae PII, no escribe datos y hace rollback antes de cerrar.

Resultado productivo del corte:

| Invariante | Resultado |
|---|---:|
| Filas de historial de migración | 37 |
| Migraciones exitosas | 35 |
| Migraciones marcadas rollback | 2 |
| Migraciones sin resolver | 0 |
| Stock negativo | 0 |
| Órdenes con total negativo | 0 |
| Órdenes pagadas activas sin líneas | 0 |
| Pagos activos no positivos | 0 |
| Deriva de `financialStatus` contra pagos activos | 0 |
| Productos de menú activos sin costo sin receta productiva activa valorizable | `172`, `310`, `373` |
| Componentes de producción activos sin costo | `404` |
| Productos con stock positivo y sin costo/capa valorada | `58`, `176` |
| Empleados RH | 0 |
| Corridas de nómina RH | 0 |
| Perfiles biométricos RH | 0 |

La lectura demuestra que los defectos históricos de órdenes hallados en el backup
del 2026-07-12 ya no están presentes en producción. No invalida los problemas de
costo: los IDs restantes son datos actuales y bloquean margen, receta, valorización
y costo de venta confiables. El ID `374` dejó de ser hallazgo: su receta activa
produce cuatro unidades con costo de lote `20.295534` y costo unitario `5.073883`;
el motor y los reportes ahora resuelven recetas multinivel con memoización y
detección de ciclos.

La investigación de fuentes, ejecutada también en transacción de sólo lectura,
determinó el criterio de cierre de cada caso:

| ID | Hecho comprobado | Acción autorizada requerida |
|---:|---|---|
| 58 | azúcar inactiva, stock 1 y sólo ajuste a costo cero | conteo físico, conversión de empaque y documento fuente |
| 176 | levadura inactiva con stock y ajuste cero; existe catálogo `511` con costo `0.20/g` | aprobar o rechazar reclasificación y conciliar stock |
| 172 | piña activa usada en menú, sin historia; existe catálogo `611` con costo `0.22/g` | aprobar relink/conversión y recalcular receta/margen |
| 310 | miel activa enlazada en gramos, sin historia; existe catálogo `397` con costo `0.13/g` | aprobar identidad y dimensión física antes de relink |
| 373 | producto intermedio con receta `DRAFT`; costo calculable `0.555469/g`, pero rendimiento y chile `237` siguen sin fuente aprobada | pesar rendimiento, costear chile y activar receta con aprobación |
| 404 | agua en ml usada por recetas activas a costo cero | registrar costo de utilidad o política explícita y aprobada de costo cero |

No se escribió ningún costo ni remapeo en producción. Los candidatos de catálogo
son evidencia para revisión humana, no autorización para alterar historia.

Producción todavía no contiene `Order.invoiceSnapshot` ni
`InventoryMovement.consumedLayers`, como se esperaba porque el candidato no fue
desplegado. Tampoco contiene el catálogo RH F1-F4 materializado por la migración
nueva.

## 5. Invariantes transaccionales maestras

### 5.1 Tenant, sucursal, marca y fecha local

```text
recurso.companyId = actor.companyId
recurso.branchId ∈ sucursales autorizadas del actor
timezone = branch.timezone ?? company.timezone ?? America/Managua
```

El `companyId` o `branchId` recibido nunca sustituye la comprobación en base. La
fecha operativa de horarios usa la zona de la sucursal cuando existe. El fallback
`America/Managua` es visible y sólo se usa cuando falta configuración en ambas
capas.

### 5.2 Unidad, cantidad y costo

```text
cantidadBase = cantidadIngresada × factorConversión
costoBase = costoUnidadIngresada ÷ factorConversión
valor = cantidadIngresada × costoUnidadIngresada
      = cantidadBase × costoBase
```

Cantidad, factor, costo, precio y mínimo deben ser finitos. Cantidad y factor son
mayores que cero; costos, precios y mínimos no pueden ser negativos. La conversión
debe pertenecer al producto, tenant y dimensión. No hay fallback 1:1 para una
conversión desconocida. Una unidad física referenciada no puede mutar su contrato
dimensional retroactivamente.

### 5.3 FIFO, kardex y reverso

```text
stockFIFO = Σ cantidadRestante(capa activa)
COGS = Σ cantidadConsumida(capa) × costo(capa)
orden determinista = createdAt, id
```

Cada salida nueva persiste `consumedLayers`. El reverso restaura exactamente las
capas y el valor consumidos. Movimientos anteriores a la migración conservan el
fallback ponderado legado, declarado como limitación; no se fabrica un linaje que
no existía.

### 5.4 Venta y operación

```text
subtotalBruto = Σ línea y modificadores autorizados
subtotalNeto = subtotalBruto - descuento persistido
total = subtotalNeto + impuesto + propina
saldo = total - Σ pagos ACTIVE
```

El backend es autoritativo. Los ciclos están separados:

```text
Operativo: OPEN → SENT_TO_KITCHEN → IN_PREPARATION → READY → DELIVERED
Financiero: UNPAID → PARTIAL → PAID
Contraflujo operativo: CANCELLED
```

Pagar no cocina ni descuenta inventario. La entrega dedicada exige pago completo o
total cero legítimo, almacén `BRANCH` explícito y estado preparado. Sólo entonces
consume inventario y libera mesa. Cancelar una preparación registra desperdicio;
revertir dinero no repone comida entregada.

### 5.5 Factura inmutable y contraflujo fiscal

La emisión ahora bloquea la orden, valida pago activo, reserva secuencia y persiste
número, fecha y `invoiceSnapshot` en una sola transacción. El snapshot contiene
líneas, organización, moneda, bruto, descuento, neto, impuesto, propina y total. La
consulta y el PDF leen exclusivamente ese snapshot; los cambios posteriores en
productos o empresa no alteran el documento.

```text
POST /api/invoices/:id/issue = mutación autorizada e idempotente
GET  /api/invoices/:id/data  = lectura/reimpresión
GET  /api/invoices/:id/pdf   = lectura/reimpresión
```

El candidato añade dos contraflujos separados y nunca borra ni reescribe el número
original:

```text
Emitida + no entregada + sin pagos activos → anulación fiscal
Emitida + entregada + pagada             → nota de crédito total
```

La anulación sólo procede antes de entrega, sin pago activo y sin documento fiscal
previo. La nota de crédito es total, exige factura entregada/pagada, reserva su
propia serie por empresa, congela snapshot tributario y crea compensaciones
exactamente una vez. En efectivo genera `REV-PAY-*`; en medios no efectivos exige
referencia externa del reembolso. La reposición física es una decisión explícita y,
si se autoriza, revierte exactamente las capas consumidas. Locks, llaves de
idempotencia, permisos `invoices.cancel`/`invoices.credit` y auditoría protegen
reintentos y concurrencia.

Antes de emitir se capturan razón/nombre fiscal, tipo y número tributario,
dirección, correo y teléfono. La jurisdicción, serie, longitud y juego de caracteres
del identificador son configuración por empresa, no constantes globales. El
snapshot del cliente queda inmutable en factura y contradocumento.

Limitaciones: no hay nota parcial; tampoco existe homologación con DGI, impresora
fiscal ni adquirentes/procesadores reales. Por ello la implementación queda verde
como contrato transaccional local, pero no como certificación tributaria externa.

### 5.6 Caja y banco

```text
efectivoEsperado = fondoInicial + movimientos IN - movimientos OUT
diferencia = efectivoContado - efectivoEsperado
```

El pago efectivo requiere turno abierto del actor y sucursal. El reverso crea OUT
compensatorio y no reabre un turno cerrado. Una conciliación bancaria no acepta un
depósito de sucursal sin turnos asociados: evita depósitos huérfanos que no serían
visibles en la conciliación.

### 5.7 RH

Las mutaciones sensibles usan permiso explícito, tenant/sucursal, lock o CAS y
auditoría. La baja termina asignaciones y contratos, desactiva el usuario, revoca
sesiones y biometría, y registra la purga. La asignación de turnos valida adscripción
y autorización operativa en la fecha local de la sucursal.

La custodia documental acepta únicamente PDF/JPEG/PNG de hasta 10 MB, verifica
firma y MIME, calcula SHA-256, usa claves opacas, escritura atómica, ACL, control de
integridad, retención y purga auditada; permanece deshabilitada hasta configurar y
homologar almacenamiento seguro. Contratos nacen `DRAFT`, activan sin solapamiento
y toda transición es CAS/auditada. La compensación conserva versiones append-only.

La nómina incorporó reconciliación paralela exacta y declara explícitamente
`legalValidationAsserted: false` y `productionCertificationAsserted: false`: el
sistema no puede fingir certificación legal. La biometría ya no depende de un fake
en producción: existe adaptador HTTP neutral, HTTPS obligatorio, token, timeout,
respuesta estricta, captura sólo en memoria y health visible. La homologación con
un proveedor real, consentimiento/alternativa y recuperación siguen pendientes.

## 6. Matriz end-to-end por módulo

| Módulo | Camino principal revisado | Contraflujo/reconciliación | Estado |
|---|---|---|---|
| Empresas | aislamiento de catálogo y configuración | ID de otro tenant rechazado; auditoría de cambios sensibles | Verde local |
| Sucursales | alta/edición, timezone, acceso operativo | sucursal ajena/inactiva rechazada; fecha local coherente | Verde local |
| Usuarios/sesiones | login, `/me`, permisos efectivos, branch grants | revocación de sesión; fallo DB no se transforma en autenticación válida | Verde local |
| Roles/permisos | catálogo `module.action`, grants efectivos cliente/servidor | grant explícito prevalece; error de catálogo falla cerrado; definición no se borra | Verde local |
| API keys | tenant y scopes experimentales separados | no hereda permisos humanos por rol | Verde local con limitación documentada |
| Marcas de menú | nombre, color, orden, activo | lock, auditoría y tenant en update/delete | Verde local |
| Categorías/menú | disponibilidad, marca, categoría, precio por sucursal | ajeno/inactivo/inválido rechazado | Verde local |
| Proveedores | tipo de suministro persistente | validación y aislamiento físico | Verde local |
| Compras | orden, recepción, costo y existencia | reverso de recepción/abono según estado y capas | Verde local |
| UOM | conversión de compra, inventario, catering y producción | incompatible, inactiva, ajena o mutación histórica rechazadas | Verde local |
| Almacenes | central/sucursal y visibilidad | acceso ajeno rechazado; reportes incluyen central cuando corresponde | Verde local |
| Inventario | IN/OUT, costo, stock, lotes | salida insuficiente falla; reverso exacto por capas | Verde local |
| Transferencias | salida y entrada preservando capas/costo | replay idempotente; rollback simétrico | Verde local |
| Kardex/costeo | orden estable y valor histórico | cero histórico no se sustituye silenciosamente por costo actual | Verde local |
| Mínimos | alertas de bajo stock de conjunto completo | evita falso positivo central/sucursal | Verde con granularidad pendiente |
| Merma/desperdicio | salida física con motivo y valor | totales dimensionados; no mezcla kg, L y unidades | Verde local |
| Recetas productivas | componentes, unidad y rendimiento visible | ciclo/UOM/dependencia inválida bloqueada | Verde local |
| Producción | iniciar, consumir, producir y costear | cancelar restaura insumo/producto/capas; negativo sólo ADMIN/SUPERADMIN | Verde local |
| Promociones | vigencia, límite y cálculo servidor | persistidas antes de cocina; cierre cero sólo por promoción legítima | Verde local |
| POS/órdenes | líneas, modificadores, totales, cocina, pago, entrega | cancelar/revertir sin mezclar operación y finanzas | Verde local |
| Cocina/KDS | iniciar y marcar READY por flujo dedicado | actor, auditoría, idempotencia y salto de estado bloqueado | Verde local |
| Mesas | ocupar con orden, seguimiento y liberación | sólo entrega/cancelación libera; retry no duplica | Verde local |
| Split bill | pagadores, partes y cobros en centavos | llave/cuerpo congelados; no doble cobro | Verde local |
| Facturación POS | emisión atómica, snapshot e identidad tributaria inmutables | anulación previa o nota total posterior, caja/stock/idempotencia | Verde local; falta homologación fiscal/externa |
| Caja | apertura, movimientos, conteo y cierre | lock contra pago concurrente; reverso compensatorio | Verde local |
| Banco | depósito y conciliación por turnos | rechaza depósito huérfano; conserva reverso | Verde local |
| Reservaciones | disponibilidad, confirmación y check-in | rama/mesa inválida rechazada; check-in no duplica orden | Verde local |
| Catering | cotización, evento, conceptos, pago y ejecución | pagos activos congelan sucursal/total/estado; reverso durable | Verde local |
| PedidosYa | webhook tenant/firma y contrato permitido | error durable/fail-closed | Condicionado a sandbox real |
| Uber/Rappi genérico | entrada protegida | outbound no configurado queda bloqueado | No habilitar |
| Reportes | ventas, servicio, producción, inventario y merma | fechas/UOM/scope inválidos fallan visiblemente | Verde local |
| Backup/restore | backup productivo actual, checksum, restore, migrate y verify | 134 tablas/2,753 filas; DB protegida y eliminada al final | Verde local; falta custodia cifrada y rollback de ventana |
| RH empleados | expediente, jerarquía, asignación y baja | ciclo de supervisor, CAS, revocación y auditoría | Verde local F1-F6 |
| RH horarios | asignación, publicación e intercambio | adscripción y sucursal revalidadas dentro de transacción | Verde local F1-F6 |
| RH asistencia | marcaje, incidencia y revisión | actor, dispositivo/geocerca y estados | Verde local; falta hardware real |
| RH biometría | adaptador HTTPS, enrolamiento/revocación/purga | timeout/contrato estricto, lease CAS y purga durable | Verde local; falta proveedor/consentimiento/homologación |
| RH fuerza laboral | solicitudes y aprobaciones | autorización propia/administrativa y CAS | Verde local F1-F6 |
| RH beneficios/gastos | solicitud, revisión y evidencia | evidencia falla cerrado; transición concurrente protegida | Verde local; DMS implementado pero deshabilitado hasta homologación |
| RH contratos/documentos | borrador, activación, versiones y custodia | sin solapamiento, CAS, hash, ACL, retención/purga | Verde local; falta almacenamiento homologado |
| RH nómina | cálculo técnico, estados y reconciliación paralela exacta | no permite afirmar validación legal/productiva | Piloto solamente; falta motor legal firmado y evidencia paralela |

## 7. Correcciones materiales de este ciclo

| ID | Severidad | Defecto encontrado | Corrección aplicada |
|---|---|---|---|
| C-001 | P0 | permisos explícitamente revocados podían reaparecer mediante fallback por rol | el catálogo/grant explícito es autoritativo; fallback sólo para definiciones realmente legadas; error DB falla cerrado |
| C-002 | P1 | cliente derivaba autorización sólo del nombre de rol | login, `/me`, contexto y menú consumen la lista efectiva de permisos |
| C-003 | P1 | catálogo de permisos podía borrarse y reactivar el fallback | nombres normalizados, definiciones inmutables/no eliminables, auditoría transaccional e invalidación de caché |
| C-004 | P1 | timezone no priorizaba la sucursal | resolución `branch → company → America/Managua` y regresión |
| C-005 | P1 | cambios de marca carecían de contrato y auditoría completos | validación, transacción, lock, actor y audit trail |
| C-006 | P0 | emisión de factura podía separar secuencia, número y datos mutables | emisión atómica e idempotente con snapshot inmutable y lectura pura |
| C-007 | P1 | PDF podía no reconciliar bruto/descuento/neto | parser estricto y conciliación al centavo; descuento visible |
| C-008 | P1 | depósito bancario podía existir sin turnos de sucursal | rechazo de depósito huérfano y regresión |
| C-009 | P0 | salidas FIFO no conservaban el linaje necesario para reverso exacto | `consumedLayers`, restauración exacta, valor simétrico y migración |
| C-010 | P1 | costeo/kardex podía depender de orden no determinista o sustituir ceros históricos | orden `(createdAt,id)` y preservación de costo histórico real |
| C-011 | P1 | transferencia podía perder composición FIFO | capas y costos preservados; retry idempotente |
| C-012 | P1 | números no finitos/negativos podían entrar a productos/UOM | validación finita y no negativa; contratos físicos referenciados inmutables |
| C-013 | P1 | alertas y reportes omitían o confundían almacén central | scope físico corregido y regresiones |
| C-014 | P1 | permiso `allowNegative` de producción podía exponerse a actores operativos | sólo ADMIN/SUPERADMIN; UI oculta para otros roles |
| C-015 | P2 | servicio de stock duplicado y sin referencias | eliminado `server/src/services/stock.service.ts` |
| C-016 | P0 | transición genérica podía saltar el KDS y marcar READY sin actor/auditoría | flujo READY dedicado, autorizado, atómico e idempotente |
| C-017 | P0 | POS podía enviar a cocina antes de persistir promociones/descuentos/propina | persistencia autoritativa previa y fallo cerrado offline |
| C-018 | P0 | entrega/cancelación preparada podía inferir almacén | almacén de sucursal explícito y contraflujo dedicado |
| C-019 | P1 | cierre manual podía convertir una orden en venta gratuita | total cero sólo se cierra si es resultado legítimo revalidado |
| C-020 | P1 | catering permitía cambios materiales con pagos activos | referencias/fechas/estados endurecidos y campos financieros congelados |
| C-021 | P1 | UI usaba GET de factura como si emitiera | POS, órdenes y mesas llaman `issue`; GET queda sólo para lectura |
| C-022 | P0 | permisos RH F1-F4 dependían del seed | migración aditiva e idempotente materializa 22 permisos y grants canónicos |
| C-023 | P0 | jerarquía RH permitía ciclos indirectos | recorrido y locks de jerarquía bloquean ciclos |
| C-024 | P0 | baja RH podía quedar parcial frente a concurrencia | CAS y transacción terminan asignaciones/contratos, desactivan usuario y revocan sesión/biometría |
| C-025 | P1 | horarios podían validar adscripción fuera de la transacción o en fecha equivocada | autorización revalidada con lock en fecha local de sucursal |
| C-026 | P1 | purga biométrica y revisión de gastos admitían carrera | lease/transición CAS; evidencia obligatoria falla cerrado |
| C-027 | P2 | nómina conservaba cálculo legado duplicado y warnings | lógica duplicada eliminada; tipado/textos corregidos; lint global en cero |
| C-028 | P0 | migración de snapshot se ordenó inicialmente antes de la columna `invoicedAt` | el primer rehearsal histórico falló; se reubicó y los ensayos posteriores quedaron verdes |
| C-029 | P0 | faltaban anulación fiscal, nota de crédito y captura tributaria completa | modelos, secuencias, snapshots, permisos, caja/stock, idempotencia, API, UI y regresión MySQL implementados |
| C-030 | P1 | auditoría marcaba el producto intermedio `374` como costo cero | resolución recursiva de recetas activas con memo/ciclos; costo unitario real `5.073883` |
| C-031 | P0 | documentos RH no tenían custodia fail-closed homologable | firma/MIME/tamaño, SHA-256, clave opaca, escritura atómica, ACL, integridad, retención y purga auditada |
| C-032 | P0 | biometría RH podía depender de proveedor simulado | adaptador HTTP neutral, HTTPS/token/timeout/contrato estricto y fake prohibido en producción |
| C-033 | P0 | nómina no explicitaba el límite entre cálculo técnico y validación legal | reconciliación paralela exacta y afirmaciones legal/productiva fijadas en `false` |
| C-034 | P1 | readiness podía responder sin comprobar DB/WS y webhooks/proveedor podían colgarse o aceptarse sin firma | probes separados, deadlines, timeout abortable y contratos fail-closed |
| C-035 | P1 | impresión/cámara/GPS no exponían fallos operativos completos | ticket 58/80 mm sanitizado, error de popup y contratos explícitos de cámara/GPS |

## 8. Resultado específico de Recursos Humanos

### 8.1 Núcleo revisado

El núcleo existente F1-F6 fue recorrido de vista a base:

- dashboard y catálogos organizacionales;
- expedientes, asignaciones, contratos y jerarquía;
- horarios, publicación, portal propio e intercambio;
- asistencia, incidencias, geocerca y dispositivos;
- biometría, enrolamiento, revocación y purga;
- solicitudes de fuerza laboral y aprobaciones;
- beneficios, gastos y evidencia;
- cálculo y flujo técnico de nómina;
- baja, desactivación, revocación y auditoría.

### 8.2 Lo que sí queda certificado técnicamente

- aislamiento por empresa y sucursal en los flujos inspeccionados;
- permisos F1-F4 instalables por migración, no dependientes de seed;
- grants propios separados de administración/sensibles;
- ciclos indirectos de supervisor bloqueados;
- asignación operativa comprobada en la fecha y zona local correctas;
- transiciones críticas protegidas por locks o CAS;
- baja transaccional y revocación de accesos/biometría;
- purga biométrica concurrente con lease;
- evidencia de gasto obligatoria y fallo cerrado;
- contratos `DRAFT`, activación sin solapamiento y cambios CAS/auditados;
- compensación versionada append-only;
- custodia documental fail-closed con hash, ACL, integridad, retención y purga;
- adaptador biométrico real neutral con HTTPS/token/timeout y fake bloqueado;
- conciliación paralela de nómina exacta y sin afirmación falsa de validez legal;
- suite RH integrada en los gates globales sin warnings.

### 8.3 Lo que no queda certificado para producción

- homologación del repositorio documental, cifrado/custodia de claves, análisis
  antimalware y evidencia de recuperación; la implementación queda deshabilitada
  hasta entonces;
- motor estatutario nicaragüense firmado: INSS, IR por tramos, vacaciones,
  liquidación, declaraciones y configuración versionada;
- fórmula legal de nómina validada por asesor laboral/tributario y corrida paralela
  contra nómina oficial con casos reales anonimizados;
- liquidación final completa y su validación legal;
- proveedor biométrico real homologado, DPA, consentimiento, retención, derecho de
  revocación y flujo alternativo no biométrico;
- cámara, GPS, geocerca, kiosco, HTTPS y dispositivos físicos reales;
- reclutamiento, onboarding/offboarding formal, desempeño, capacitación, SST,
  activos/uniformes, disciplina, dependientes, liquidación inmutable, declaraciones
  estatutarias y outbox documental;
- UI dedicada completa para contratos, documentos y reportes avanzados;
- volumen, observabilidad, contingencia y runbooks RH.

La ausencia actual de empleados, nóminas y perfiles biométricos en producción
impide ejecutar una corrida paralela representativa. RH puede pasar a staging y a
un piloto controlado; no debe presentarse todavía como suite RH integral certificada.

## 9. Migraciones y compatibilidad

El candidato añade cuatro migraciones:

1. `20260714_fiscal_credit_notes_customer_tax`: identidad tributaria, estados,
   series, anulaciones y notas de crédito;
2. `20260714_invoice_snapshot_after_issuance`: agrega y rellena
   `Order.invoiceSnapshot`, e impone número de factura → snapshot;
3. `20260714_materialize_hr_core_permissions`: instala 22 permisos RH F1-F4 y
   grants canónicos de forma aditiva/idempotente;
4. `20260714_preserve_inventory_movement_fifo_layers`: agrega trazabilidad de capas
   consumidas para nuevos movimientos.

Se produjo el backup actual
`server/backups/production-pre-release-current-20260714.ndjson.gz` mediante snapshot
lógico consistente y lectura exclusiva. El artefacto contiene 134 tablas y 2,753
filas, incluidas 37 filas de `_prisma_migrations`; su SHA-256 es:

```text
2146A716429B43B4190E06E4E7BCEE1FDE9E7EE6811E4C362319855A3AD74F3F
```

El archivo está ignorado por Git y no se incorporó al commit. Se restauró en la DB
aislada `codex_current_release_restore_test` con conteo exacto 134/2,753. Prisma
detectó 39 directorios, aplicó las cuatro migraciones candidatas pendientes y la
verificación final obtuvo 413 relaciones FK, 19 invariantes, 41 filas de historial,
0 migraciones sin resolver y 2 rollbacks históricos. La DB temporal fue eliminada
con el script protegido al terminar.

Este resultado cierra “no existe backup actual restaurado” en el plano técnico.
No demuestra cifrado/custodia fuera de esta estación, restauración por el equipo de
guardia ni rollback productivo cronometrado; esas evidencias siguen en el gate de
ventana.

Limitaciones de compatibilidad:

- el snapshot de facturas históricas se rellena con el mejor dato maestro disponible
  al migrar; no puede reconstruir cambios anteriores que nunca se versionaron;
- movimientos OUT anteriores a `consumedLayers` no adquieren un linaje FIFO exacto
  retroactivamente y usan el fallback legado;
- una restauración técnica local no sustituye la prueba de ventana, custodia y
  recuperación del entorno productivo por el equipo responsable.

## 10. Registro de riesgos residuales

| ID | Prioridad | Riesgo | Criterio de cierre |
|---|---:|---|---|
| B-001 | P0 | costos cero `58`, `172`, `176`, `310`, `373`, `404` | fuente/autorización, recálculo de recetas/margen/valor, conciliación y auditor productivo vacío |
| B-002 | P0 externo | contraflujo fiscal implementado pero no homologado | aprobación legal/DGI, series/configuración firmadas, proveedor fiscal y comprobantes reales |
| B-003 | P0 externo | captura tributaria implementada pero no homologada | validar campos/reglas por jurisdicción y comprobar aceptación/reimpresión real |
| B-004 | Cerrado local / P0 ventana | backup actual restaurado; falta custodia/rollback | copia cifrada/custodiada, restauración por guardia y rollback cronometrado con RTO/RPO |
| B-005 | Cerrado local / P0 despliegue | candidato congelado pero no desplegado | artefactos reproducibles y staging del mismo commit; no autoriza producción por sí solo |
| B-006 | P0 | RH legal/biométrico/documental incompleto | evidencias de sección 8.3, piloto y aprobación legal/privacidad |
| B-007 | P1 | proveedores/hardware externos no probados | sandbox fiscal/PedidosYa, impresoras, caja, cámara/GPS/kiosco con evidencias de éxito y caída |
| B-008 | P1 | harness corto verde, sin carga/soak prolongado equivalente | objetivos definidos, 2–8 h, volumen real, error rate/latencia/locks y recuperación aceptados |
| B-009 | P1 | sin observabilidad/rollback ensayado del candidato en staging | dashboards, alertas, correlación, runbook y rollback cronometrado |
| R-001 | P1 | `minStock` es por producto, no por almacén | definir necesidad; migrar a umbral por almacén si operación lo exige |
| R-002 | P2 | selectores operativos cargan máximo 500 registros | paginación/búsqueda remota antes de superar ese tamaño |
| R-003 | P1 | clientes externos sin idempotency key pueden duplicar intención | exigir llave o contrato idempotente en APIs públicas críticas |
| R-004 | P1 | lockout de login en memoria no coordina múltiples instancias | almacenar contadores/ventanas en componente compartido |
| R-005 | P2 | bundle PDF grande | lazy-load/separación del generador antes de afectar equipos de baja capacidad |
| R-006 | P1 | Uber/Rappi outbound no implementado | mantener deshabilitado hasta contrato tenant-specific y pruebas |
| R-007 | P1 | movimientos históricos sin linaje exacto | aceptar formalmente el legado o reconstruir con evidencia contable, nunca inferir silenciosamente |
| R-008 | P1 | backfill fiscal histórico usa maestros actuales | muestreo, aceptación contable y conservación del backup previo |

## 11. Gates obligatorios para convertir NO-GO en GO

Todos son acumulativos. Ninguno puede cerrarse por declaración verbal.

### Gate 1 — congelar la candidata

- crear un commit/branch de release con el workspace revisado: **se completa con el
  commit que contiene esta acta**;
- comprobar árbol limpio y registrar SHA de frontend/backend/migraciones: **se
  registra al cerrar el commit**;
- los gates se ejecutaron sobre el contenido exacto previo al commit; cualquier
  modificación posterior obliga a repetirlos.

**Evidencia:** SHA, logs completos, artefactos y aprobaciones.

### Gate 2 — sanear costos productivos

- identificar los productos `58`, `172`, `176`, `310`, `373`, `404`;
- documentar factura/recepción/inventario inicial u otra fuente válida;
- registrar costo sin sobrescribir historia de forma opaca;
- recalcular receta, costo de menú, margen, capas y valorización;
- conciliar stock físico, kardex y mayor contable;
- repetir auditor hasta obtener listas vacías.

**Prohibido:** asignar `0`, `1` o un promedio arbitrario sólo para superar el gate.

### Gate 3 — homologar decisión fiscal implementada

- validar con asesor/DGI jurisdicción, requisitos del comprobante, identidad del
  cliente, series, numeración, impuestos, redondeo, anulación y nota de crédito;
- el ciclo total está implementado y probado localmente; decidir si el negocio
  necesita notas parciales antes de liberar;
- reintento, concurrencia, reverso financiero, caja e inventario tienen regresión
  local; repetirlos contra proveedor/adquirente y reportes oficiales;
- certificar proveedor/hardware fiscal real si aplica.

### Gate 4 — cerrar RH productivo

- aprobación legal de fórmulas y configuración;
- nómina paralela con casos reales anonimizados y conciliación al centavo;
- DMS/evidencia segura y política de retención;
- evaluación de privacidad/consentimiento biométrico y alternativa;
- prueba cámara/GPS/geocerca/kiosco/HTTPS;
- decidir e implementar los submódulos faltantes necesarios para la operación.

### Gate 5 — backup y migración de ventana

- backup actual, checksum, restore aislado, conteos, cuatro migraciones candidatas,
  `db:verify-restore` y auditor: **completados localmente**;
- custodiar una copia cifrada fuera de la estación y verificar recuperación por el
  equipo de guardia;
- ensayar rollback/restauración y medir RTO/RPO;
- conservar evidencia y eliminar la base temporal con el script protegido.

### Gate 6 — staging equivalente

- desplegar el SHA candidato y migraciones en staging;
- ejecutar transacciones completas por rol, empresa y sucursal;
- probar PedidosYa, impresoras, caja, dispositivos y fallos de red;
- realizar carga, soak y caos con volumen objetivo;
- verificar logs, métricas, alertas, backups y rollback.

El harness local corto ya está verde (300/300 y 7,109/7,109 sin fallos, caos
contractual recuperado); no sustituye este gate en staging equivalente.

### Gate 7 — aprobación final

Firmas mínimas: Owner del producto, Operaciones, Finanzas/Contabilidad, Fiscal/Legal,
RH/Legal laboral, Seguridad/Privacidad y Tecnología. La firma debe referenciar el
SHA y las evidencias de los seis gates anteriores.

## 12. Protocolo repetible para futuras certificaciones

### 12.1 Preparación

1. congelar alcance y SHA;
2. registrar producción desplegada, versión DB y migraciones;
3. crear backup actual sin PII en logs;
4. dividir cadenas física, comercial, financiera/control y RH;
5. prohibir solapamiento de archivos o coordinar explícitamente los compartidos.

### 12.2 Matriz mínima por flujo

Para cada operación registrar:

| Campo | Contenido requerido |
|---|---|
| Identificador | módulo, endpoint, servicio, tablas y vistas |
| Camino | precondición → mutación → estado final |
| Contraflujo | cancelar/revertir/devolver/purgar/expirar |
| Efectos | cantidad, costo, stock, pago, caja, factura, reporte, auditoría |
| Aislamiento | empresa, sucursal, rol/permiso y timezone |
| Concurrencia | lock/CAS/idempotencia/replay |
| Evidencia | prueba y resultado reproducible |
| Residual | severidad, dueño, fecha y criterio de cierre |

### 12.3 Secuencia de gates

```powershell
# Servidor
Set-Location C:\restaurant\server
npm.cmd run lint -- --max-warnings=0
npm.cmd run typecheck
npm.cmd run test:unit -- --runInBand
npm.cmd run test:integration
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=high
npm.cmd exec prisma validate

# Cliente
Set-Location C:\restaurant\client
npm.cmd run lint -- --max-warnings=0
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=high
$env:CI='1'; npm.cmd run test:e2e

# Integridad del patch
Set-Location C:\restaurant
git -c safe.directory=C:/restaurant diff --check
```

El restore y auditor productivo requieren URLs/credenciales inyectadas por el
entorno; nunca deben copiarse al documento o a la consola. Usar únicamente los
scripts protegidos:

```powershell
npm.cmd run db:restore -- --target-database <nombre_restore_test> ...
npm.cmd run db:rehearse-migrations -- --target-database <nombre_restore_test>
npm.cmd run db:verify-restore -- --target-database <nombre_restore_test>
npm.cmd run db:drop-restore -- --target-database <nombre_restore_test>
```

### 12.4 Reglas de decisión

- cualquier P0 abierto produce NO-GO;
- una suite omitida no equivale a PASS;
- fallo de runner debe reproducirse con entorno limpio antes de clasificarlo;
- no se corrigen datos productivos sin fuente y autorización;
- no se inventan reglas fiscales, laborales o de privacidad;
- no se considera reversible un proceso si sólo borra o sobrescribe historia;
- GET no debe emitir, cobrar, consumir, cerrar ni cambiar estados;
- todo documento emitido debe ser inmutable y reimprimible;
- todo contraflujo debe reconciliar los mismos dominios que el camino principal;
- el GO sólo aplica al SHA, esquema, datos y entorno que generaron la evidencia.

## 13. Inventario de artefactos principales

### Migraciones nuevas

- `server/prisma/migrations/20260714_fiscal_credit_notes_customer_tax/migration.sql`
- `server/prisma/migrations/20260714_invoice_snapshot_after_issuance/migration.sql`
- `server/prisma/migrations/20260714_materialize_hr_core_permissions/migration.sql`
- `server/prisma/migrations/20260714_preserve_inventory_movement_fifo_layers/migration.sql`

### Auditoría operativa

- `server/prisma/audit-production-readiness.ts`
- `server/prisma/audit-production-cost-sources.ts`
- `server/prisma/audit-production-recipe-costs.ts`
- `server/scripts/release-operational-harness.ts`

### Áreas de código corregidas

- autenticación, autorización y catálogo de permisos;
- marcas, categorías, sucursales y validadores;
- proveedores, productos, UOM, almacenes, inventario, FIFO, kardex y costeo;
- producción, reportes productivos y autorización de stock negativo;
- POS, órdenes, cocina, mesas, reservas, catering y banco;
- emisión/lectura de factura, snapshot, anulación y nota de crédito;
- empleados, contratos/documentos, horarios, asistencia, biometría, workforce,
  beneficios, compensación y nómina RH;
- contexto de autenticación, menú y permisos del cliente;
- pruebas unitarias, integración y contratos de UI.

### Regresiones nuevas destacadas

- timezone y permisos efectivos/fail-closed;
- seguridad del catálogo de permisos;
- control transaccional de marcas;
- factura inmutable/idempotente;
- anulación fiscal y nota de crédito con caja/stock/idempotencia MySQL;
- captura tributaria y contratos UI de contraflujo fiscal;
- ledger físico FIFO/kardex/reportes;
- costo recursivo de producción multinivel;
- autorización de producción negativa;
- contratos físicos de proveedor/UOM;
- seguridad de empleado, contratos/documentos, horario, asistencia, biometría,
  beneficios y reconciliación de nómina RH;
- readiness/liveness, timeout de proveedores, webhooks, impresión y dispositivos.

## 14. Acta de cierre de esta revisión

| Elemento | Estado al 2026-07-14 |
|---|---|
| Barrido integral de código | Completado |
| Loops especializados | Completados y consolidados |
| Correcciones locales | Implementadas |
| Regresión automática global | Verde |
| Backup productivo actual | Creado; 134 tablas/2,753 filas; checksum registrado; artefacto no versionado |
| Restore/migrate actual | Verde; cuatro migraciones candidatas, 413 FK y 19 invariantes |
| Lectura productiva | Completada, sólo lectura |
| Escrituras en producción | Ninguna |
| Despliegue | No realizado |
| Commit de release | El commit que contiene esta acta congela la candidata; SHA por `git rev-parse HEAD` |
| Certificación de código candidato | Aprobada técnicamente dentro del alcance probado |
| Contraflujo fiscal | Implementado y probado localmente; no homologado externamente |
| RH integral | Endurecido y ampliado; no certificado legal/biométrica/operativamente |
| Hardware/proveedores/staging | Pendiente |
| Autorización de producción | **NO-GO hasta cerrar los P0 y gates externos de secciones 10-11** |

## 15. Cierre explícito de los seis enunciados solicitados

| Enunciado | Trabajo realizado | Estado final |
|---|---|---|
| Costos reales en cero | auditoría productiva y de fuentes; resolución recursiva corrigió el falso positivo `374`; diagnóstico y criterio de saneamiento para `58`, `172`, `176`, `310`, `373`, `404` | **Abierto P0 de datos:** seis IDs requieren fuente/aprobación; producción no fue alterada |
| Nota de crédito/anulación y cliente tributario | esquema, migración, series, permisos, servicios, API, UI, snapshots, caja, inventario, idempotencia, auditoría y pruebas MySQL | **Implementado localmente; abierto P0 externo:** homologación fiscal, notas parciales si aplican y procesadores reales |
| Completar RH | custodia fail-closed, contratos/compensación versionados, conciliación de nómina, adaptador biométrico real y paneles UI | **Parcial/no certificado:** faltan motor legal firmado, evidencia paralela, proveedor/DMS homologados y submódulos enumerados en 8.3 |
| Restaurar backup productivo actual | snapshot 134/2,753, SHA-256, restore exacto, cuatro migraciones, 413 FK, 19 invariantes y limpieza de DB temporal | **Cerrado técnicamente; abierta custodia cifrada/rollback de ventana** |
| Congelar y desplegar candidata | revisión consolidada y commit de release que contiene esta acta | **Congelado localmente; despliegue deliberadamente bloqueado por NO-GO** |
| Hardware, externos, carga, soak, caos y rollback | contratos de hardware/proveedor, harness 300 solicitudes, soak corto 7,109 solicitudes y caos local | **Parcial:** faltan hardware/proveedores reales, soak 2–8 h, carga equivalente, observabilidad y rollback staging |

### 15.1 Base legal consultada y límite de la revisión

La implementación se diseñó para conservar comprobante/número original, identidad
del comprador, contradocumento, trazabilidad y declaraciones configurables. Como
referencia oficial se consultaron los avisos de DGI sobre
[facturas anuladas](https://www.dgi.gob.ni/pdfNoticia/3203),
[nombre y RUC del comprador](https://www.dgi.gob.ni/pdfNoticia/1713) y
[declaraciones mensuales, RUC, nómina e INSS](https://www.dgi.gob.ni/pdfNoticia/2972),
además de los
[regímenes de afiliación del INSS](https://inss-princ.inss.gob.ni/index.php/tramites-37/10-afiliaciones/13-regimenes-de-afiliacion)
y el
[Código del Trabajo publicado por la Asamblea Nacional](https://legislacion.asamblea.gob.ni/Normaweb.nsf/%28%24All%29/FA251B3C54F5BAEF062571C40055736C).

Estas fuentes orientan el diseño, pero **no equivalen a dictamen jurídico ni a
homologación tributaria/laboral**. La configuración de series, identificadores,
retenciones, INSS, IR, vacaciones, liquidación y presentación debe ser firmada por
los responsables fiscal, contable y laboral antes del GO.

## 16. Plantilla de firma futura

```text
Release SHA:
Frontend SHA/artefacto:
Backend SHA/artefacto:
Versión de esquema / última migración:
Backup y checksum:
Restore verificado:
Auditor productivo sin P0:
Pruebas automáticas:
Pruebas de proveedores/hardware:
Carga/soak/caos:
Rollback y RTO/RPO:

Producto/Owner:
Operaciones:
Finanzas/Contabilidad:
Fiscal/Legal:
RH/Legal laboral:
Seguridad/Privacidad:
Tecnología:

Decisión: GO / NO-GO
Fecha y hora:
```

---

**Conclusión:** la revisión en loop terminó y dejó el candidato sustancialmente más
seguro, trazable y coherente. Los gates técnicos están verdes; el backup actual ya
fue restaurado y el contraflujo fiscal quedó implementado. La puesta en producción
no debe ocurrir todavía: deben sanearse con evidencia seis costos productivos,
homologarse fiscal/RH, inyectarse secretos reales y probarse el commit congelado con
hardware, proveedores, carga prolongada, observabilidad y rollback en staging
equivalente. Cualquier certificación que omita esos puntos sería más amplia que la
evidencia disponible.
