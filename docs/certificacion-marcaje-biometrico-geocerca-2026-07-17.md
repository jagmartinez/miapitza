# Certificación de marcaje biométrico y geocerca — 2026-07-17

## Alcance y criterio

Esta barrida cubre el flujo de autoservicio `usuario -> acción -> reto facial -> GPS -> decisión -> evento -> jornada -> incidencia/corrección -> nómina`, junto con sus contraflujos. La autoridad es el servidor: el cliente no decide sucursal, política, secuencia, distancia, identidad ni tiempo trabajado.

Reglas certificadas:

- Un auto-marcaje efectivo exige adscripción RH vigente, sucursal activa, evidencia geográfica fresca dentro de la geocerca y reconocimiento facial válido cuando la política los requiere.
- `CHECK_OUT`, descanso y fin de descanso requieren una única sesión abierta compatible.
- Un turno nocturno permanece abierto hasta `endAt + lateCheckOutMinutes`, aunque cambie la fecha local.
- Una entrada olvidada fuera de esa ventana no se autocierra ni desaparece: bloquea otro inicio y deriva a una corrección compensatoria.
- Una evidencia facial/geográfica fallida nunca genera tiempo trabajado, aunque exista una política histórica `WARN` o `REVIEW`.
- Los intentos y las correcciones son trazables; no se reescribe ni elimina silenciosamente el evento original.

## Hallazgos consolidados

| ID | Severidad | Veredicto | Hallazgo | Corrección |
|---|---:|---|---|---|
| M-01 | Alta | Real | El marcaje autorizaba sucursal con `User.branchId/UserBranch`, no con `EmployeeBranchAssignment` efectiva. | Selección y autorización migradas a adscripción RH con vigencia inclusiva por fecha local. |
| M-02 | Alta | Real | La búsqueda de sesión abierta estaba limitada a 72 horas; una entrada antigua podía desaparecer y permitir otra. | Estado efectivo consultado sin ventana truncada, filtrando en BD sólo eventos potencialmente efectivos; bloqueo `STALE_OPEN_ATTENDANCE`. |
| M-03 | Alta | Real | Una revisión humana podía volver efectivo un intento cuyo proveedor facial había fallado. | Evidencia `FAILED/REVIEW/ERROR` o proveedor `UNAVAILABLE/ERROR` queda no aprobable; exige corrección compensatoria. |
| M-04 | Crítica | Real | Dos entradas no programadas concurrentes podían usar sesiones distintas y ser aceptadas. | Bloqueo por usuario, relectura global del estado efectivo dentro de la transacción y rechazo inmutable del candidato incompatible. |
| M-05 | Alta | Real | El cliente podía cargar la política de `User.branchId` mientras el servidor marcaba contra otra sucursal/turno. | `today` devuelve política y sucursal objetivo autoritativas; la UI usa exactamente esa versión. |
| M-06 | Crítica | Real | La salida de un turno nocturno exactamente al final o dentro de la tolerancia posterior quedaba fuera del resumen diario. | Eventos programados se cargan por `scheduledShiftId`; los no programados conservan límite por día local. |
| M-07 | Media | Real | El estado `CANCELLED` existía para correcciones, pero no había contraflujo para retirar una solicitud pendiente. | Endpoint, CAS, auditoría, cliente y UI para cancelar con motivo e idempotencia. |
| M-08 | Alta | Real | `ASSIGN_BRANCH` podía conservar turno/geocerca/política de otra sucursal. | Exige turno publicado coincidente, adscripción efectiva y geocerca de la sucursal corregida; no conserva una política ajena. |
| M-09 | Alta | Real | `WARN` podía aceptar rostro no coincidente o geocerca fallida. | Normalización fail-closed a `BLOCK` en lectura/escritura de política y decisión de auto-marcaje. |

## Falsos positivos y matices

- **“Todo cruce de medianoche queda huérfano”**: falso positivo. La sesión por turno ya sobrevivía el cambio de fecha. El defecto real era distinguir un turno nocturno aún válido de una sesión obsoleta, y la consulta posterior usada por jornadas/nómina.
- **“La salida sin entrada se aceptaba normalmente”**: falso positivo en el camino secuencial existente. `availableActionsFrom` ya la rechazaba. Se reforzó porque concurrencia, revisiones tardías o múltiples sesiones corruptas podían eludir una validación sólo local a `sessionKey`.
- **“La caída del proveedor ya generaba tiempo trabajado”**: parcialmente falso. El intento quedaba `REVIEW` y no era efectivo de inmediato; el hallazgo real era que una aprobación posterior sí podía volverlo efectivo sin evidencia válida.

## Matriz de flujo y contraflujo

| Escenario | Resultado autoritativo |
|---|---|
| Entrada, adscripción vigente, rostro y geocerca válidos | `ACCEPTED`; abre una sesión. |
| Salida sin entrada abierta | `REJECTED / OPEN_ATTENDANCE_REQUIRED`; no suma minutos. |
| Segunda entrada con sesión abierta | `REJECTED / OPEN_ATTENDANCE_EXISTS`; no abre otra sesión. |
| Dos entradas concurrentes | Como máximo una efectiva; la otra queda rechazada y trazada. |
| Turno 22:00–06:00, salida 06:00 o dentro de tolerancia | Cierra la misma sesión; el resumen incluye la salida. |
| Entrada previa olvidada y ventana vencida | `availableActions=[]`, `STALE_OPEN_ATTENDANCE`, enlace a solicitar corrección. |
| Rostro no coincide o prueba de vida falla | Rechazado; nunca se degrada a advertencia efectiva. |
| GPS fuera de radio, impreciso, viejo o futuro | Rechazado; nunca se degrada a advertencia efectiva. |
| Proveedor facial no disponible | Intento no efectivo y respuesta de servicio no disponible; no puede aprobarse como tiempo trabajado. |
| Usuario cancela antes de confirmar | No se crea evento. |
| Reintento con la misma idempotencia y contenido | Reproduce el resultado previo sin duplicar evento. |
| Misma idempotencia con contenido distinto | Conflicto; no muta la jornada. |
| Solicitud de corrección pendiente cancelada | `CANCELLED` con actor, motivo, CAS e idempotencia. |
| Corrección aprobada | Evento compensatorio; original permanece auditable. |
| Corrección rechazada | No modifica el tiempo efectivo. |
| Periodo de asistencia cerrado | Marcaje/corrección que lo altere queda bloqueado hasta reapertura autorizada. |

## Reconciliación descendente

- **Cantidades/minutos:** los minutos ordinarios y descansos se derivan de la secuencia efectiva; una salida nocturna ligada al turno ya no se pierde por el límite de fecha.
- **Estados:** `ACCEPTED` y `REVIEW + APPROVED` son los únicos candidatos efectivos; correcciones aplicadas desplazan por compensación, no por borrado.
- **Nómina:** una falta real de entrada/salida sigue creando incidencia crítica y bloquea el cierre; una salida nocturna válida ya no produce un `MISSING_CHECK_OUT` falso.
- **Sucursal:** turno, adscripción, evento y corrección deben reconciliar la misma sucursal. La geocerca usada queda versionada.
- **Caja, factura, costos e inventario:** no aplican al dominio de asistencia y esta entrega no modifica sus tablas ni cálculos.

## Silencios peligrosos revisados

- No se agregó ningún `catch` que convierta fallos biométricos/geográficos en `0`, `null` o éxito.
- La caída del proveedor se conserva como intento no efectivo y error operativo explícito.
- La recarga de `today` que falle después de un marcaje muestra error y obliga a refrescar antes de otro intento.
- No se calcula distancia, sucursal o política en paralelo en el cliente; se muestran como pendientes hasta la respuesta del servidor.
- Se eliminó el fallback operativo de sucursal basado en asignaciones de acceso (`allowedBranches`) para el marcaje RH.

## Evidencia de validación local

- Servidor: `119` suites, `735` pruebas, todas aprobadas.
- Cliente: `56` archivos, `248` pruebas, todas aprobadas.
- `eslint`, `tsc --noEmit` y builds de producción aprobados en servidor y cliente.
- Pruebas nuevas cubren sesión obsoleta, vigencia inclusiva de adscripción, evidencia fail-closed, proveedor no aprobable, salida nocturna y contrato de cancelación.

## Límite de la certificación

La validación automatizada certifica lógica, contratos y compilación. La comprobación física final de cámara, permiso GPS, precisión real y radio de una sucursal debe hacerse en producción con un empleado adscrito y un dispositivo móvil; no debe simularse desde pruebas unitarias.
