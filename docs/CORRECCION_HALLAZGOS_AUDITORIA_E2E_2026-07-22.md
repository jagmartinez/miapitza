# Corrección de hallazgos de auditoría end-to-end

Fecha de corte: 22 de julio de 2026.

Estado: correcciones implementadas y verificadas en entornos locales aislados.
Este informe no certifica despliegue, migración ni datos de producción.

## 1. Resumen ejecutivo

Se revisaron y corrigieron defectos confirmados en autenticación y aislamiento
multiempresa, idempotencia, sesiones, carga y ciclo de vida de archivos,
integridad de caja, atomicidad de auditorías transaccionales, cola POS offline,
permisos y recuperación visible del frontend. También se actualizaron
dependencias vulnerables y la documentación operativa.

Los gates ejecutables terminaron en verde después de un ciclo de
reproducción-corrección-repetición: servidor (tipos, lint, Prisma, 798 pruebas
unitarias y 63 escenarios de integración vigentes cubiertos), cliente (tipos, lint, build, 294 pruebas de
componentes/contratos y 52 E2E), proveedor biométrico (32 pruebas y Ruff),
auditorías de dependencias y arnés operativo.

No se concede un GO de producción: no se desplegó, no se ejecutaron las
migraciones sobre una copia de producción y permanecen riesgos residuales
descritos en la sección 9.

## 2. Alcance y flujo funcional revisado

- Autenticación, registro, cierre de sesión, timeout por inactividad, API keys,
  webhooks, permisos nominales y aislamiento por empresa/sucursal.
- Idempotencia HTTP y de dominio, reintentos, concurrencia y replay entre
  instancias.
- POS, cola offline, envío a cocina, facturación, cobro, reverso, cancelación,
  nota de crédito y devolución física.
- Apertura, movimientos manuales, arqueo y cierre de caja.
- Inventario, FIFO/promedio ponderado, compras, transferencias, desperdicio,
  producción, cancelaciones y auditoría.
- Delivery, catering, reservaciones, mesas, KDS, configuración y recuperación
  de errores de carga.
- Documentos de compras, logos, expedientes laborales y proveedor biométrico.
- Migraciones Prisma, dependencias, compilación, navegación, accesibilidad y
  comportamiento móvil.

## 3. Especialidades orquestadas

- Arquitectura y seguridad: autenticación, tenancy, sesiones, idempotencia,
  archivos y biometría.
- Backend y transacciones: caja, inventario, producción, compras, auditoría,
  concurrencia y migraciones.
- Frontend y E2E: POS offline, permisos, estados de carga/error, accesibilidad,
  responsive y navegador.
- Orquestación principal: reproducción independiente, revisión cruzada de
  propuestas, corrección de fallos de integración, repetición de todos los
  gates y consolidación de evidencia.

## 4. Hallazgos confirmados y solución

### 4.1 Límite de autenticación e idempotencia

**Evidencia:** el middleware global podía intervenir antes de que el JWT o la
autenticación específica de API key/webhook quedaran validados. Además, el
namespace no estaba ligado a todo el contexto efectivo del actor.

**Causa raíz:** orden de middlewares y clave de ámbito insuficiente.

**Impacto:** riesgo de replay fuera del contexto autorizado y caché prematura de
respuestas en rutas con autenticación especializada.

**Corrección:** preautenticación JWT, namespace ligado a token, usuario,
empresa, sucursal, roles, permisos y tipo de cuenta; API keys/webhooks no usan
replay global hasta que la ruta autentica. Se agregó cobertura concurrente y
multiinstancia.

### 4.2 Registro multiempresa y roles globales

**Evidencia:** el registro podía aceptar una empresa distinta de la del actor en
condiciones no reservadas exclusivamente al operador de plataforma.

**Causa raíz:** resolución de tenant y privilegio global demasiado amplia.

**Impacto:** creación cruzada de usuarios o asignación indebida de roles.

**Corrección:** el tenant se resuelve por el alcance autenticado; únicamente el
operador de plataforma puede cruzar empresas o asignar roles globales.

### 4.3 Sesiones autoritativas

**Evidencia:** la inactividad dependía de estado no suficientemente
autoritativo y el touch concurrente podía invalidar solicitudes legítimas.

**Causa raíz:** ausencia de actividad persistida e interacción incorrecta entre
validación y actualización concurrente.

**Impacto:** sesiones que sobreviven más de lo debido o falsos cierres bajo
concurrencia.

**Corrección:** `UserSession.lastActivityAt` e `idleTimeoutMinutes`, validación
server-side, touch HTTP seguro y validación WebSocket sin extender la sesión.

### 4.4 Archivos y documentos

**Evidencia:** faltaban límites y validación uniforme de extensión, MIME y firma
binaria; algunos reemplazos o fallos podían dejar archivos sin correspondencia.

**Causa raíz:** controles dispersos y ciclo de vida de filesystem separado de
las mutaciones de base de datos.

**Impacto:** carga de contenido inesperado, exposición inline y archivos
huérfanos.

**Corrección:** middleware compartido de seguridad, límites, allowlists y
magic-bytes para Excel/PDF/JPEG/PNG/WebP; descarga forzada; bloqueo de
`invoicePdf` manual y compensaciones de archivos en crear, reemplazar, borrar y
fallar.

### 4.5 Arqueo y trazabilidad de caja

**Evidencia:** el cierre no conciliaba obligatoriamente el total declarado con
las denominaciones y no preservaba de forma completa actor, override real y
tasa USD histórica.

**Causa raíz:** contrato de cierre incompleto y datos de auditoría ausentes.

**Impacto:** cierre desbalanceado o sin reconstrucción verificable.

**Corrección:** el nuevo flujo de arqueo exige billetes y monedas, reconcilia el
total exacto, persiste actor, override efectivo y tipo de cambio. Los movimientos
manuales rechazan campos desconocidos, fechas/tipos inválidos y prefijos
reservados de pagos, reversos y notas de crédito.

### 4.6 Atomicidad de auditorías

**Evidencia:** algunas auditorías de inventario, producción y reversos de compra
se ejecutaban fuera o sin esperar la transacción de dominio.

**Causa raíz:** promesas no esperadas o cliente Prisma no transaccional.

**Impacto:** respuesta exitosa sin auditoría, o movimiento persistido pese al
fallo de trazabilidad.

**Corrección:** auditoría esperada con el cliente de la misma transacción; un
fallo comprobado revierte movimiento, stock, costo y estado.

### 4.7 Cola POS offline

**Evidencia:** operaciones dependientes podían ejecutarse o reintentarse sin
respetar el resultado de su operación padre y el backoff no era durable.

**Causa raíz:** cola plana sin causalidad persistente.

**Impacto:** envío a cocina sin líneas aplicadas, duplicados o reintentos
desordenados al reconectar.

**Corrección:** agrupación causal, dependencias explícitas, propagación de fallo,
`nextAttemptAt` persistido, backoff y aislamiento por propietario.

### 4.8 Recuperación, permisos y accesibilidad del frontend

**Evidencia:** varias vistas confundían fallos con listas vacías; configuración
podía guardar después de una carga fallida; navegación y rutas no aplicaban de
forma uniforme los permisos efectivos; controles visuales no siempre eran
activables por teclado.

**Causa raíz:** estados de UI y autorización duplicados/incompletos.

**Impacto:** falsa percepción de éxito, posible sobrescritura, enlaces
inaccesibles y UX inconsistente.

**Corrección:** estados de error/reintento explícitos, bloqueo seguro de guardado,
permisos efectivos con fallback legado controlado, logout local inmediato,
switch semántico, activación por teclado y correcciones móviles.

### 4.9 Dependencias

**Evidencia:** la auditoría completa del servidor reportó ocho vulnerabilidades
transitivas de desarrollo; el cliente usaba versiones anteriores de Axios,
Vite, Vitest y el plugin React.

**Impacto:** exposición de la cadena de herramientas y mantenimiento inseguro.

**Corrección:** actualización de lockfiles y toolchain; `npm audit` completo
quedó en cero vulnerabilidades tanto en cliente como servidor.

### 4.10 Cierre legado de caja y reverso de consolidación

**Evidencia:** `POST /cash-shifts/:id/close` permitía cerrar sin desglose físico,
y una consolidación de cuentas cancelaba órdenes absorbidas sin conservar un
snapshot suficiente para separarlas de forma segura.

**Causa raíz:** coexistían dos contratos de cierre con garantías distintas y la
consolidación sólo guardaba procedencia parcial en órdenes e ítems.

**Impacto:** arqueos no reconstruibles y ausencia de contraflujo autorizado ante
una consolidación operativa errónea.

**Corrección:** el cierre directo ahora responde `410 Gone`, publica
`/cash-arqueo/:shiftId/close` como sucesor y no persiste nada. Las consolidaciones
nuevas guardan snapshots inmutables de órdenes, importes, estados, mesas, ítems y
procedencia. El reverso exige versión, motivo y clave idempotente; bloquea pagos,
factura, entrega, cambios posteriores y mesas con otra cuenta; restaura y audita
en la misma transacción. Una consulta por orden o mesa permite recuperar después
de una recarga la consolidación activa y su versión sin exponer los snapshots.

Para consolidaciones anteriores a los snapshots,
`GET /tables/consolidations/legacy-inventory` reconstruye únicamente evidencia
persistida en `AuditLog`, vínculos de órdenes y procedencia de ítems. Clasifica
`NOT_REVERSIBLE` sólo cuando la traza es coherente pero el estado original fue
sobrescrito; cualquier ausencia, duplicidad o mutación queda `AMBIGUOUS`.
El marcado administrativo congela esa evidencia con SHA-256, exige la huella
esperada y una clave idempotente, y audita dentro de la misma transacción. Si
la evidencia cambia, conserva la revisión anterior y crea una nueva revisión
inmutable; el replay de la misma evidencia sigue siendo idempotente. No restaura
ni modifica órdenes o productos.

## 5. Archivos y módulos principales modificados

- `server/prisma/schema.prisma` y migraciones
  `20260722_authoritative_session_security` y
  `20260722_cash_close_and_atomic_audit_integrity`.
- Autenticación, sesión e idempotencia en `server/src/controllers/auth.controller.ts`,
  `server/src/middlewares/auth.ts`, `server/src/middlewares/idempotency.ts`,
  `server/src/services/auth.service.ts` y `server/src/services/session.service.ts`.
- Caja, inventario, producción y compras en sus controladores, rutas y servicios.
- Contraflujos de caja/mesas en
  `server/src/services/table-account.service.ts`,
  `server/src/controllers/table.controller.ts`,
  `server/src/controllers/cash-shift.controller.ts`,
  `server/src/routes/table.routes.ts`, `client/src/services/api.ts` y la
  migración `20260723_table_consolidation_counterflow`.
- Inventario histórico y revisión manual en
  `server/src/services/legacy-table-consolidation-review.service.ts` y la
  migración aditiva `20260723_legacy_table_consolidation_review`.
- Seguridad de archivos en `server/src/middlewares/upload-security.ts`,
  `server/src/controllers/upload.controller.ts` y rutas de productos/compras.
- Cola y recuperación frontend en `client/src/services/db.ts`,
  `client/src/services/offlineManager.ts`, `client/src/pages/POS.tsx`,
  `client/src/pages/Settings.tsx` y `client/src/components/LoadErrorState.tsx`.
- Navegación, permisos, accesibilidad y vistas operativas en `client/src/App.tsx`,
  `client/src/components/Layout.tsx` y páginas relacionadas.
- Proveedor biométrico en `biometric-provider/app/`.
- `package.json`/lockfiles, scripts de integración y arnés operativo.

## 6. Pruebas, datos y resultados

Se utilizaron fixtures aislados y bases desechables; no se modificaron datos de
producción.

| Gate | Resultado |
| --- | --- |
| Servidor typecheck | PASS |
| Servidor lint | PASS |
| Prisma validate | PASS |
| Unitarias servidor | 130 suites, 798/798 PASS |
| Integración MySQL/MariaDB | 53 migraciones; corrida completa 62/62 y escenario HTTP añadido después PASS focal (63 vigentes cubiertos) |
| Cliente typecheck | PASS |
| Cliente lint | PASS |
| Cliente Vitest | 67 archivos, 294/294 PASS |
| Cliente build | PASS, Vite 8.1.5 |
| Playwright | 52/52 PASS |
| Proveedor biométrico | 32/32 PASS y Ruff PASS con artefactos del contenedor |
| `npm audit` cliente | 0 vulnerabilidades |
| `npm audit` servidor | 0 vulnerabilidades |

El arnés operativo local registró:

- Warmup: liveness 200 y readiness 200.
- Carga: 300/300 respuestas exitosas, p95 31.61 ms.
- Soak: 5,536/5,536 respuestas exitosas, p95 12.25 ms.
- Contraflujos: webhooks Uber/Rappi y PedidosYa sin firma 401, JSON
  sobredimensionado 413 y WebSocket no autenticado cerrado con 4001.
- Recuperación: readiness volvió a 200 después de los fallos inducidos.

La primera corrida de integración detectó dos regresiones reales introducidas
durante la corrección: sanitización excesiva de errores válidos y limpieza
incompleta de fixtures frente a nuevas relaciones. Se corrigieron ambos puntos y
se repitió el conjunto completo dos veces en verde, incluida una repetición
posterior a la actualización de dependencias.

La integración completa aplicó las 53 migraciones sobre una base MySQL
desechable, ejecutó las 16 suites entonces vigentes con 62/62 escenarios y
eliminó la base temporal. Después se añadió y ejecutó focalmente el escenario
HTTP del contrato, por lo que los 63 escenarios vigentes quedaron cubiertos,
aunque no en una sola invocación monolítica. La prueba focal de consolidación
volvió a aplicar las 53 migraciones sobre otra base desechable y aprobó 4/4
escenarios: flujo completo, redescubrimiento tras recarga, rechazo sin
restauración parcial ante mutación y dos reversos concurrentes con un solo
asiento de auditoría. Además aprobaron 23/23 pruebas unitarias focales de
mesas/caja y 2/2 contratos de cliente.

La revisión histórica aplicó las 56 migraciones actuales sobre otra base MySQL
desechable y aprobó 6/6 escenarios: clasificación reproducible y aislamiento por
sucursal; marcado sin mutar órdenes/ítems y replay; nueva revisión inmutable al
cambiar evidencia; clave duplicada y evidencia obsoleta; dos marcados
concurrentes con una sola revisión y auditoría; y rollback del marcado si falla
la auditoría. Sus 7/7 pruebas unitarias focales también aprobaron, incluidos
mesas auditadas faltantes, sucursales incompatibles y conjuntos vacíos que no
pueden pasar por `every()` vacuo.

La prueba HTTP de contrato recorrió autenticación, lectura tenant/sucursal,
datos persistidos, conciliación fiscal y generación PDF real. Verificó
`application/pdf`, `private, no-store`, encabezado de descarga, firma `%PDF` y el
contraflujo `409` por identidad/cláusulas incompletas. El build ya no contiene
`@react-pdf/renderer`: se retiraron 55 paquetes y el antiguo chunk de
aproximadamente 517 KB gzip.

## 7. Contraflujos validados

- Reintento idéntico, key reutilizada con payload distinto, fallo 4xx/5xx y
  finalización durable fallida.
- Solicitudes concurrentes de sesión, pago, recepción, producción, promoción y
  nota de crédito.
- Factura pendiente, cancelación facturada, reverso sin motivo, devolución
  parcial excedida y reintento fiscal.
- Auditoría fallida con rollback integral.
- Unidad incompatible con rollback de catering e inventario.
- Transferencias y desperdicios revertidos sin borrar historia.
- Cola offline con padre fallido, reconexión y backoff.
- Carga fallida en vistas y bloqueo de configuración no inicializada.
- Webhooks sin firma, payload grande y WebSocket sin autenticación.
- Cierre legado de caja rechazado sin persistencia y enlace explícito al arqueo.
- Consolidación, redescubrimiento, reverso, replay idempotente, mutación posterior
  y dos solicitudes concurrentes.
- Inventario histórico coherente/ambiguo, alcance por sucursal, evidencia
  obsoleta, clave duplicada y marcado concurrente sin reconstrucción financiera.
- Lockout compartido entre réplicas, usuario inexistente con costo bcrypt,
  deadlock reintentado y login correcto que no limpia un bloqueo concurrente.
- Archivo escrito sin persistencia, rollback de referencia, borrado fallido,
  lease abandonado, doble worker, archivo ya ausente y ruta/tenant inválidos.
- Contrato válido descargado por HTTP y rechazo `409` sin PDF ante identidad,
  snapshot fiscal o cláusulas incompletas.
- Readiness biométrico sin proveedor y calibración que falla por FAR, FRR,
  cobertura global o cobertura por cámara/cohorte.

## 8. Hallazgos descartados o no confirmados

- La transferencia total de mesas no se modificó: la revisión y las pruebas no
  demostraron el defecto inicialmente sospechado.
- No se cambió la política contable de compras en efectivo: faltó evidencia de
  que el comportamiento actual contradiga una regla de negocio aprobada.
- Los mensajes `console.error` observados en pruebas negativas corresponden a
  fallos inducidos y esperados; no representan suites fallidas.

## 9. Otros riesgos comprobados y limitaciones

### Riesgos corregidos o controlados

1. **Filesystem/BD:** se añadió `FileCleanupTask`, una outbox durable que reserva
   antes de escribir, confirma o encola dentro de la misma transacción del
   dominio y reconcilia con claim CAS, lease, retry/backoff y `ENOENT` convergente.
   Se validaron caída posterior a escritura, rollback, commit, `EACCES`, lease
   abandonado, doble consumidor, tenant y traversal en facturas, logos y RH.
2. **Lockout multi-réplica:** se sustituyó el `Map` por `LoginAttempt` en MySQL,
   con `SELECT FOR UPDATE`, retry acotado de deadlock y bcrypt dummy para usuarios
   inexistentes. Cinco fallos concurrentes entre dos instancias bloquearon la
   cuenta de forma compartida y el login HTTP respetó el bloqueo.
3. **Cierre legado de caja:** ahora responde `410 Gone`, no persiste y dirige al
   arqueo físico; el wrapper interno sin consumidores fue retirado.
4. **Consolidaciones nuevas:** guardan snapshot durable, versión y procedencia;
   se redescubren tras recarga y se revierten atómicamente con motivo, idempotencia
   y auditoría. Pagos, factura, entrega, mutaciones u ocupación posterior bloquean
   sin restauración parcial.
5. **PDF:** la generación pasó al servidor con datos autoritativos y conciliados.
   Falta de identidad legal, cliente, snapshot fiscal, líneas o siete cláusulas
   produce `409`; React-PDF y su chunk pesado fueron eliminados del cliente.
6. **Gate biométrico:** readiness falla cerrado cuando una política activa exige
   biometría y el proveedor no está disponible. La calibración genera evidencia
   con fecha/hash, evalúa el umbral desplegable global y por cámara/cohorte y
   termina con código 2 al incumplir FAR, FRR o tamaños de muestra.

### Riesgos residuales y limitaciones

1. **Almacenamiento compartido:** BD y filesystem siguen sin ser una transacción
   distribuida; la outbox garantiza reintento/eventualidad, pero todas las
   réplicas deben montar el mismo `STORAGE_DIR` para que cualquier worker pueda
   borrar.
2. **Consumidores externos del cierre legado:** una integración no inventariada
   recibirá `410` y deberá migrar al arqueo. El repositorio no contiene un
   inventario externo que permita confirmarlos.
3. **Consolidaciones históricas:** no se fabricaron snapshots retroactivos. Sólo
   las creadas después de la migración son reversibles. El inventario y marcado
   reducen el riesgo operativo y conservan la decisión, pero no reconstruyen
   importes, estados ni documentos ausentes; un caso `AMBIGUOUS` requiere
   evidencia externa y decisión humana.
4. **Biometría física:** no se validaron cámara real, iluminación, latencia de red
   privada ni operación continua en hardware productivo. El gate existe, pero
   necesita un dataset representativo y límites aprobados por la operación.
5. **Producción no validada:** no hubo restore anonimizado de una copia
   productiva, ensayo de migración con su volumen real, despliegue, smoke remoto
   ni observación posterior.
6. **Árbol de trabajo compartido:** había cambios de usuario previos a esta
   auditoría, especialmente en asistencia y sucursales. Se preservaron y se
   validó el conjunto integrado, pero todavía no existe un commit de liberación.

## 10. Estado final y criterio de salida

Los defectos confirmados intervenidos quedaron corregidos y los gates locales
relevantes están en verde. No quedan hallazgos críticos confirmados dentro del
alcance corregido.

La implementación está lista para revisión de diff y preparación de un commit,
pero **no está autorizada ni certificada para producción**. Antes de liberar se
requiere, como mínimo: revisión humana del diff compartido, respaldo/restore
anonimizado, ensayo de las 53 migraciones con volumen representativo, resolución
o aceptación explícita de los riesgos residuales, despliegue controlado y smoke
remoto con conciliación posterior.

## 11. Adenda de gates de infraestructura del 23 de julio

### Hallazgos confirmados

1. El chequeo anterior de `STORAGE_DIR` sólo probaba permisos locales. Dos
   réplicas conectadas a la misma base, pero con discos aislados, podían quedar
   ready y un worker no encontrar los archivos creados por el otro.
2. El readiness facial consultaba `/health`, pero ignoraba el modelo y la
   versión reportados. Un proveedor disponible con artefacto distinto al
   esperado podía habilitar asistencia biométrica.
3. La base local XAMPP `restaurante_test` observada durante esta auditoría tenía
   139 tablas, pero sólo 13 migraciones registradas frente a 54 directorios
   esperados en el momento del ensayo (el árbol integrado pasó después a 56).
   En un clon desechable, `prisma migrate deploy` se detuvo con
   `P3018/1050` en `20260712_add_bank_deposit_reconciliation` porque
   `bankdeposit` ya existía. No se modificó ni se ejecutó `migrate resolve`
   contra la base original.

### Controles implementados

- La única fila `StorageIdentity.singletonKey=PRIMARY` vincula MySQL con el hash
  de un marcador aleatorio que contiene `STORAGE_SHARED_ID`. El `CHECK` de la
  migración impide crear claves alternas. Arranque y readiness prueban
  crear/escribir/fsync/leer/borrar y fallan si el marcador, la base, el ID o el
  volumen no coinciden.
- Producción exige `STORAGE_DIR` absoluto y `STORAGE_SHARED_ID`; desarrollo y
  pruebas siguen admitiendo modo local explícitamente no verificado.
- Workers de archivos y biometría sólo arrancan después del gate de storage.
- Readiness no consulta `StorageIdentity` si el probe DB autoritativo falla.
  `READINESS_STORAGE_TIMEOUT_MS` acota el gate; mkdir/access y el round-trip son
  asíncronos, y las solicitudes concurrentes reutilizan un solo probe en vuelo.
- El proveedor HTTP compara su `/health` con `HR_FACE_PROVIDER_MODEL` y
  `HR_FACE_PROVIDER_VERSION`; ambos pins son obligatorios en producción.
- `db:verify-restore` compara el ledger completo con los directorios de
  migración y falla ante faltantes, desconocidas, checksums distintos,
  incompletas o revertidas. No resuelve deriva ni altera el origen.

### Evidencia focal

- 56/56 pruebas unitarias focales PASS: volumen compartido, volumen aislado con
  igual o distinto ID, cambio de ID sobre el mismo volumen, marcador corrupto,
  creación/fsync/lectura/borrado del probe fallidos, compatibilidad local,
  configuración productiva, DB caída sin segunda consulta, timeout de DB/storage
  sin acumulación, filesystem bloqueado y modelo/versión biométricos.
- 1/1 prueba de integración MySQL PASS sobre base desechable con las 56
  migraciones: volumen compartido aceptado; volúmenes aislados, ID alterno y
  fila singleton alterna rechazados; la base temporal fue eliminada.
- `npm.cmd run typecheck`: PASS sobre el árbol integrado después de corregir el
  contrato de encoding concurrente.
- `npm.cmd run lint`: PASS.
- `npm.cmd exec prisma validate`: PASS.
- La repetición MySQL posterior al cambio asíncrono aplicó y concilió 56/56
  migraciones, pero el nuevo gate general de restore detuvo Jest por deriva de
  dos índices de payroll ajenos a storage. La base desechable fue eliminada; por
  tanto, esa repetición no se contabiliza como PASS de integración del cambio
  asíncrono.

### Límites y NO-GO

- La base local con ledger incompleto no es candidata a migración ni evidencia
  positiva de restore hasta conciliar su procedencia en una copia gobernada.
- El gate identifica volúmenes aislados por marcador; un clon físico que copie
  también el marcador requiere prueba de lectura/escritura cruzada y control
  del proveedor de almacenamiento.
- Modelo/versión y disponibilidad HTTP no certifican cámara, iluminación,
  latencia de red, liveness real, FAR/FRR con población representativa ni
  operación continua. Esas pruebas siguen requiriendo hardware y evidencia
  controlada.
