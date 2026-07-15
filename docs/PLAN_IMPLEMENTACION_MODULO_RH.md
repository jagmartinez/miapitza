# Plan maestro de implementación — Módulo de Recursos Humanos

**Proyecto:** Restaurant System / Mi Restaurante
**Fecha base:** 2026-07-13
**Estado general:** NÚCLEO F1–F6 CONSOLIDADO LOCALMENTE — GATES DE PRODUCCIÓN PENDIENTES
**Responsable funcional:** Owner de la empresa
**Fuente de verdad del avance:** este documento

> Este archivo se actualizará en cada entrega. Una tarea sólo cambia a `[x]` cuando su código, migración, pruebas y criterio de aceptación estén completos. `[~]` significa trabajo en curso y `[ ]` pendiente. No se considerará terminado un flujo por tener únicamente la interfaz o únicamente la API.

## 1. Objetivo

Construir un módulo RH multiempresa y multisucursal, integrado al modelo actual de usuarios, roles, sucursales y auditoría. Debe permitir:

- distinguir usuarios **internos** y **externos**;
- vincular cada usuario interno exactamente con un empleado y prohibir que un usuario externo tenga expediente laboral;
- administrar expedientes, puestos, contratos, compensaciones y documentos;
- planificar horarios semanales por usuario, puesto y sucursal;
- registrar asistencia mediante verificación facial y geocerca, validando turno, hora, sucursal y evidencia;
- gestionar incidencias, correcciones, horas extra, permisos, vacaciones y ausencias;
- calcular y cerrar nómina, aguinaldo y liquidaciones con reglas versionadas;
- administrar viáticos, préstamos, cuotas y deducciones;
- ofrecer autogestión al trabajador sin exponer información de otros empleados;
- mantener trazabilidad, privacidad, aislamiento por empresa y pruebas end-to-end.

## 2. Principios no negociables

1. **El usuario autentica; el empleado representa la relación laboral.** Rol de sistema, puesto laboral y forma de pago son conceptos independientes.
2. **Aislamiento multiempresa estricto.** Toda consulta y mutación RH se limita por `companyId`; las entidades de sucursal también validan pertenencia a la misma empresa.
3. **Permisos de capacidad, no sólo nombres de roles.** El Owner tiene acceso completo; la delegación se hace con permisos `hr.*`. La UI ayuda, pero la API es la autoridad.
4. **Evidencia inmutable.** Marcajes, resultados biométricos, cálculos cerrados y asientos de préstamos no se borran ni sobrescriben. Las correcciones son registros compensatorios auditados.
5. **Tiempo autoritativo del servidor.** La hora del dispositivo es evidencia auxiliar; la jornada se determina con el reloj del servidor y la zona horaria de la sucursal.
6. **Cálculos reproducibles.** Montos con `Decimal`, reglas con vigencia, redondeo definido y snapshot de entradas. No se usará `number`/`Float` como fuente contable.
7. **Privacidad por diseño.** No guardar fotografías crudas por defecto; cifrar plantillas biométricas y datos sensibles; retención mínima; consentimiento y alternativa supervisada.
8. **Degradación segura.** Un fallo de cámara, GPS o proveedor facial no inventa una asistencia ni elimina el intento; genera revisión/manual fallback según política.
9. **UX existente.** Reutilizar tokens, cards, tablas, sidebars, toasts, confirmaciones, responsive y accesibilidad existentes. El horario semanal y el marcaje pueden usar layouts especializados por densidad/operación.
10. **Migraciones aditivas.** Nada de `db push --accept-data-loss`. Cada fase incluye migración, rollback documentado, backfill seguro y ensayo sobre copia.

## 3. Línea base confirmada del repositorio

- Backend: Node.js 20+, Express, TypeScript, Prisma 5 y MySQL.
- Frontend: React 18, Vite, React Router 6, Axios y Lucide.
- Modelo actual: `Company -> Branch/User/Role`, usuario con sucursal primaria y sucursales permitidas, roles múltiples y permisos.
- Seguridad disponible: JWT, sesiones revocables, CSRF, rate limit, idempotencia HTTP, `requirePermission`, auditoría y almacenamiento privado.
- UI disponible: `CatalogTable`, `ViewToggle`, cards unificadas, `Sidebar`, modal premium, `ConfirmDialog`, Toast, formularios y tokens CSS.
- No existe actualmente dominio RH, asistencia, biometría, vacaciones ni nómina.
- `Branch` aún no tiene coordenadas/geocerca.
- El árbol de trabajo ya contiene numerosos cambios ajenos a RH. Se preservarán y no se reescribirán archivos fuera del alcance sin revisión de diff.

### Decisiones de compatibilidad

- `User.accountType` iniciará como `EXTERNAL` para usuarios históricos; no se inferirá una relación laboral por su rol.
- El Owner lógico se mapeará inicialmente a la capacidad completa de `SUPERADMIN`; las funciones se protegerán por permisos `hr.*` para permitir delegación posterior sin crear un rol paralelo incompatible.
- Un usuario externo conserva únicamente identidad/autenticación y no puede recibir horario, marcar asistencia, enrolar biometría, solicitar prestaciones ni entrar en nómina. Debe convertirse transaccionalmente en `INTERNAL` y quedar ligado a un `Employee ACTIVE` antes de cualquier operación laboral; su historial previo nunca se borra.
- `UserBranch` controla acceso operativo a sucursales; `EmployeeBranchAssignment` controlará adscripción laboral. No se mezclarán.
- Las sucursales existentes conservarán coordenadas nulas. No podrán activar marcaje geográfico hasta completar latitud, longitud, radio y precisión aceptable.
- El email seguirá siendo válido para usuarios históricos, pero la Fase 1 revisará hacerlo opcional para personal que autentica por `username`; nunca se generarán correos falsos para satisfacer la restricción actual.

## 4. Alcance funcional completo

### 4.1 Personas, organización y expediente

- Usuario interno/externo y conversión transaccional entre tipos.
- Empleado con código único por empresa, nombre legal/preferido, identificación, INSS/RUC-NIF cuando aplique, contactos, emergencia, datos bancarios y estado laboral.
- Departamentos, puestos, centros de costo y supervisor.
- Adscripciones de sucursal con vigencia, principal/secundaria y trazabilidad.
- Contratos con tipo, inicio/fin, jornada, período de pago, modalidad salarial y adjuntos.
- Historial de compensación y salario; nunca reemplazar retroactivamente el valor usado por una nómina cerrada.
- Documentos con tipo, vencimiento, visibilidad, metadatos y almacenamiento privado.
- Alta, reingreso, suspensión/licencia, terminación y liquidación.
- Importación/exportación controlada en una fase posterior, con dry-run y reporte por fila.

### 4.2 Horarios y turnos

- Plantillas de turnos reutilizables.
- Calendario semanal por usuario, con múltiples turnos por día y distintas sucursales.
- Turnos que cruzan medianoche, turnos partidos, descansos pagados/no pagados y puesto asignado.
- Estados: `DRAFT -> PUBLISHED -> SUPERSEDED/CANCELLED`.
- Versionado: un horario publicado no se edita; se crea una nueva versión.
- Detección de solapes, descanso mínimo configurable, límite de jornada y conflicto de sucursal.
- Copiar semana, publicar en lote, notificar cambios y reconocer recepción del trabajador.
- Solicitud de intercambio/cobertura de turno con aprobación; nunca cambia un horario publicado de forma silenciosa.
- Feriados nacionales/locales y excepciones de horario.
- Vista por empleado, puesto y sucursal; lista accesible alternativa a la cuadrícula semanal.

### 4.3 Biometría, geocerca y marcaje

- Configuración de sucursal: latitud, longitud, radio en metros, precisión GPS máxima y zona horaria.
- Política de asistencia por empresa/sucursal: tolerancia temprana/tardía, ventana de salida, descansos, marcaje sin turno y modo `BLOCK/REVIEW/WARN`.
- Enrolamiento facial con consentimiento explícito, desafío de servidor, prueba de vida, versión del modelo/proveedor y revocación.
- Adaptador de proveedor facial intercambiable; producción no confiará en un booleano calculado por el cliente.
- Marcaje personal autenticado y modo kiosco registrado por sucursal; ambos realizan comparación facial 1:1, no identificación masiva 1:N.
- Marcajes `CHECK_IN`, `BREAK_START`, `BREAK_END`, `CHECK_OUT` con idempotencia.
- Validación servidor contra:
  - identidad y estado del usuario;
  - plantilla biométrica activa y resultado facial/prueba de vida;
  - turno publicado compatible, incluyendo cruces de medianoche;
  - sucursal esperada y activa;
  - distancia Haversine, radio y precisión reportada;
  - ventana temporal y secuencia válida de marcajes;
  - duplicados/reintentos y desafío no reutilizado.
- Guardar siempre el intento y sus motivos. Los casos dudosos pasan a revisión; no se borra evidencia.
- Fallback supervisado con motivo, aprobador y auditoría cuando cámara/GPS fallen o exista revocación biométrica.
- Cola offline cifrada y firmada sólo para dispositivos previamente registrados, con antigüedad máxima, sincronización idempotente y estado de revisión; nunca se confía en EXIF/reloj local como autoridad.
- Señales de riesgo: GPS simulado/inconsistente cuando el dispositivo lo exponga, velocidad imposible, cambio de dispositivo, demasiados intentos, baja precisión, replay o nonce vencido.
- La geolocalización web reduce riesgo, pero no demuestra presencia absoluta; se reportará como evidencia, no como garantía infalible.

### 4.4 Asistencia, incidencias y horas extra

- Jornada derivada por empleado/día a partir de eventos crudos.
- Minutos ordinarios, descansos, tardanza, salida temprana, ausencia y tiempo extra candidato.
- Incidencias: sin turno, sin entrada/salida, secuencia inválida, fuera de geocerca, rostro no verificado, duplicado, tardanza, ausencia y exceso de jornada.
- Solicitud de corrección del empleado y ajuste administrativo con valor anterior/nuevo, motivo y evidencia.
- Horas extra preautorizadas o detectadas por marcaje; aprobación separada del cálculo de asistencia.
- Estados de extra: `CANDIDATE -> PENDING -> APPROVED/REJECTED -> PAID`.
- Topes, multiplicadores, feriado, séptimo día, nocturnidad y reglas con vigencia.
- Cierre mensual de asistencia; reapertura exclusiva con motivo y auditoría.

### 4.5 Permisos, vacaciones y ausencias

- Catálogo de tipos: vacaciones, enfermedad/subsidio, maternidad/paternidad, duelo, permiso con/sin goce, ausencia injustificada y personalizados.
- Solicitud por día, rango o fracción horaria; adjuntos y comentarios.
- Flujo `DRAFT/PENDING/APPROVED/REJECTED/CANCELLED` con aprobación y sustituto cuando proceda.
- Validación de solapes, período cerrado, saldo y cobertura del turno.
- Libro mayor de saldos de vacaciones: devengo, consumo, ajuste, expiración/pago y reversión.
- Calendario de vacaciones por equipo/sucursal y alertas de cobertura.
- Impacto explícito en asistencia, nómina, aguinaldo y liquidación.

### 4.6 Nómina, aguinaldo y liquidación

- Configuración versionada y efectiva por fecha: frecuencia, moneda, redondeo, jornada, componentes y reglas legales/empresariales.
- Períodos y corrida de nómina con estados `DRAFT -> CALCULATED -> REVIEWED -> APPROVED -> PAID`, más `VOID` mediante reversión.
- Snapshot por empleado: contrato, salario, asistencia cerrada, extras aprobadas, permisos, préstamos, deducciones, viáticos gravables/no gravables y versión de reglas.
- Componentes: salario, horas ordinarias, extras, feriados, bonos/comisiones, vacaciones, subsidios, ajustes, INSS, IR, préstamos, embargos/deducciones y neto.
- Comisiones y propinas se modelan como conceptos explícitos/configurables del restaurante; nunca se infieren automáticamente de ventas sin política aprobada.
- Motor determinista de reglas tipadas; no ejecutar fórmulas arbitrarias suministradas por usuarios.
- Validaciones: bruto = suma de ingresos; deducciones por categoría; neto; topes/prioridades; no duplicar período/empleado.
- Revisión de diferencias respecto al período anterior y bloqueo de anomalías.
- Aprobación dual configurable para nómina y acceso separado a salarios.
- Recibo individual, exportación PDF/Excel/contable y consulta de autoservicio.
- Aguinaldo/décimo tercer mes como corrida especial con acumulación trazable, proporcionalidad y reglas vigentes.
- Liquidación por terminación con vacaciones, aguinaldo proporcional, salarios pendientes, deducciones permitidas e indemnización configurada/validada.
- El sistema prepara y registra el pago; integración bancaria directa queda detrás de un adaptador y no se habilita sin proveedor/credenciales.

### 4.7 Viáticos

- Solicitud con destino, propósito, fechas, moneda, presupuesto y aprobador.
- Anticipo, categorías, comprobantes, gastos, tipos de cambio y política de topes.
- Liquidación: gasto aprobado, devolución del empleado o reembolso de la empresa.
- Estados y aprobación; integración opcional con nómina/contabilidad.
- Almacenamiento privado de facturas/recibos y trazabilidad de cambios.

### 4.8 Préstamos y deducciones

- Préstamo con principal, fecha de desembolso, plazo, periodicidad, interés configurable, cuota y contrato.
- Tabla de amortización versionada y saldo por libro mayor.
- Cuotas descontadas desde nómina, abonos extraordinarios, refinanciamiento, suspensión y cancelación/reversión.
- Deducciones únicas o recurrentes, prioridad, vigencia, límite y autorización/documento.
- No descontar dos veces una cuota en reintentos de nómina; idempotencia y relación explícita `PayrollLine -> LoanInstallment`.

### 4.9 Autoservicio, reportes y alertas

- `Mi RH`: horario, próximo turno, marcaje, historial propio, incidencias, solicitudes, saldos, préstamos y recibos.
- Dashboard Owner: dotación, cobertura de turnos, puntualidad, ausencias, extras, vacaciones próximas, costo de nómina y alertas.
- Reportes por rango/sucursal/puesto/empleado con exportación y scope autorizado.
- Alertas: turno sin cubrir, falta de marcaje, geocerca/rostro en revisión, extra pendiente, documento próximo a vencer, saldo/solicitud, nómina con anomalías y préstamo en mora.

## 5. Modelo de datos propuesto

Los nombres podrán ajustarse durante la migración, pero las responsabilidades no se mezclarán.

| Dominio | Entidades principales | Invariantes clave |
|---|---|---|
| Identidad | `User.accountType`, `Employee` | `INTERNAL` exige un `Employee` único; `EXTERNAL` prohíbe vínculo |
| Organización | `HrDepartment`, `HrPosition`, `CostCenter`, `EmployeeBranchAssignment` | Todo pertenece a la misma empresa; vigencias no ambiguas |
| Contrato | `EmploymentContract`, `CompensationHistory`, `EmployeeDocument` | Historial efectivo por fecha; documentos privados |
| Horario | `ShiftTemplate`, `WeeklySchedule`, `ScheduledShift`, `ShiftSwapRequest`, `HolidayCalendar` | Agenda por `userId`; sin solapes; publicación versionada; sucursal válida |
| Biometría | `BiometricProfile`, `BiometricChallenge`, `BiometricVerification` | Plantilla cifrada; challenge de un uso; sin foto cruda por defecto |
| Asistencia | `AttendancePolicy`, `AttendancePunch`, `AttendanceDay`, `AttendanceIncident`, `AttendanceAdjustment` | Punch append-only; resumen recalculable; ajuste auditable |
| Extras | `OvertimeRequest`, `OvertimeEntry` | Sólo extra aprobada alimenta nómina |
| Ausencias | `LeaveType`, `LeaveRequest`, `LeaveBalanceLedger` | Saldo por ledger, nunca contador editable sin asiento |
| Nómina | `PayrollRuleSet`, `PayrollPeriod`, `PayrollRun`, `PayrollEmployee`, `PayrollLine`, `Payslip` | Snapshot y montos inmutables tras aprobación/pago |
| Viáticos | `TravelRequest`, `TravelAdvance`, `TravelExpense`, `TravelSettlement` | Anticipo = gastos + devolución/reembolso conciliado |
| Préstamos | `EmployeeLoan`, `LoanInstallment`, `LoanLedgerEntry`, `RecurringDeduction` | Saldo derivado del ledger; cuota idempotente |
| Baja | `EmploymentTermination`, `FinalSettlement` | No se elimina historial; revoca acceso según flujo |

### Campos críticos en `Branch`

- `latitude Decimal(10,7)?`
- `longitude Decimal(10,7)?`
- `geofenceRadiusM Int?`
- `maxLocationAccuracyM Int?`
- `timezone String @default("America/Managua")`
- `attendanceEnabled Boolean @default(false)`

`BranchGeofenceVersion` conservará coordenadas, radio, precisión, timezone y vigencia. Cada marcaje referenciará la versión exacta usada para que un cambio posterior de ubicación no reinterprete evidencia histórica.

### Índices/constraints mínimos

- Índices por `companyId` y por rangos de fecha en toda entidad operativa.
- Unicidad `Employee(companyId, employeeCode)` y `Employee(userId)`.
- Unicidad de versión por `companyId + userId + weekStart + version`; sólo un horario publicado vigente se permite por transacción/bloqueo optimista.
- `AttendancePunch.clientEventId` único por empresa y usuario.
- Una corrida no anulada por empresa/tipo/período.
- Una línea de cuota por `payrollEmployeeId + loanInstallmentId`.
- Validaciones de pertenencia compuesta en servicio/transacción; no asumir que FKs individuales garantizan tenant.

## 6. API y servicios

### Routers

- Base versionada: `/api/v1/hr`.
- `/employees`, `/organization`, `/contracts`, `/documents`
- `/schedules`, `/shift-templates`, `/holidays`
- `/attendance/policies`, `/attendance/punches`, `/attendance/incidents`, `/attendance/adjustments`
- `/biometrics/enrollment`, `/biometrics/challenges`, `/biometrics/verifications`
- `/overtime`, `/leave-types`, `/leave-requests`, `/leave-balances`
- `/payroll/config`, `/payroll/periods`, `/payroll/runs`, `/payroll/payslips`
- `/travel`, `/loans`, `/deductions`, `/terminations`, `/reports`
- `/me/*` para autoservicio con scope del usuario autenticado.

### Servicios separados

- `HrEmployeeService`: conversión interno/externo, expediente, vigencias y baja.
- `HrScheduleService`: conflicto, publicación, versionado y cobertura.
- `GeofenceService`: distancia y política de precisión.
- `BiometricService` + `BiometricProvider`: challenge, enrolamiento, verificación, retención y revocación.
- `AttendanceService`: máquina de eventos y resumen diario.
- `OvertimeService`, `LeaveService`, `AccrualService`.
- `PayrollEngine`: snapshot, reglas, cálculo, revisión, aprobación, reversión y recibo.
- `TravelService`, `LoanService`, `DeductionService`, `SettlementService`.

### Contratos transversales

- Todas las mutaciones usan validación de esquema, `req.user.companyId`, permiso y auditoría.
- Los endpoints RH nunca aceptan un `companyId` arbitrario desde body/query, ni siquiera para `SUPERADMIN`; el tenant es siempre el de la sesión.
- Los DTO usan allowlists y rechazan/descartan campos desconocidos para impedir mass assignment.
- Creación de marcaje, publicación, aprobación y cálculo usan idempotencia.
- Marcajes multipart añaden challenge y `clientEventId` propios; no dependen solamente del fingerprint global de idempotencia JSON.
- Respuestas consistentes `{ success, data, message? }`.
- Errores de negocio diferenciados: 400 validación, 403 capacidad/scope, 404 entidad scoped, 409 estado/conflicto/idempotencia.
- Paginación, filtros, orden y rangos de fecha validados en listados de gran volumen.
- Auditoría financiera/laboral se escribe con el mismo `TransactionClient` que la mutación; no se ejecuta fire-and-forget.
- Documentos, comprobantes y biometría usan storage privado con ownership y endpoint autorizado; no reutilizan la ruta pública de logos.
- Cálculos grandes son reentrantes, persistentes y por lotes; no mantienen una única transacción HTTP larga.

## 7. Matriz de permisos

Permisos mínimos a sembrar:

- `hr.dashboard.view`, `hr.employee.view`, `hr.employee.manage`, `hr.employee.sensitive.view`
- `hr.schedule.view`, `hr.schedule.manage`, `hr.schedule.publish`
- `hr.attendance.self`, `hr.attendance.view`, `hr.attendance.manage`, `hr.attendance.adjust`
- `hr.biometric.self`, `hr.biometric.manage`
- `hr.overtime.self`, `hr.overtime.approve`
- `hr.leave.self`, `hr.leave.manage`, `hr.leave.approve`
- `hr.payroll.self`, `hr.payroll.manage`, `hr.payroll.approve`, `hr.payroll.mark_paid`
- `hr.travel.self`, `hr.travel.manage`, `hr.travel.approve`
- `hr.loan.self`, `hr.loan.manage`, `hr.deduction.manage`
- `hr.report.view`, `hr.config.manage`, `hr.audit.view`

Reglas:

- `SUPERADMIN` recibe todo el conjunto y representa al Owner en el modelo actual.
- Usuarios internos/externos reciben sólo capacidades `*.self` cuando su rol las incluya.
- `ADMIN` no obtiene automáticamente salario, biometría o aprobación de nómina; debe concederse permiso explícito.
- Ningún usuario aprueba su propia extra, permiso, viático o ajuste cuando la política requiera separación.
- Salarios, cuentas bancarias, identificaciones, biometría y recibos tienen selección de campos específica; nunca se retornan por `include` genérico.

## 8. Arquitectura UX/UI y rutas

### Navegación Owner

- `/rh` — resumen y alertas.
- `/rh/personal` — expediente, organización y contratos.
- `/rh/horarios` — calendario semanal y cobertura.
- `/rh/asistencia` — marcajes, jornada e incidencias.
- `/rh/solicitudes` — permisos, vacaciones y extras.
- `/rh/nomina` — períodos, corridas, aguinaldo y recibos.
- `/rh/viaticos` — solicitudes y liquidación.
- `/rh/prestamos-deducciones` — saldos, cuotas y deducciones.
- `/rh/configuracion` — políticas, catálogos, feriados y reglas.
- `/rh/reportes` — indicadores y exportaciones.

### Navegación empleado/usuario

- `/rh/mi-portal` — portada con próximo turno, acción de marcar y accesos propios.
- `/rh/mi-portal/horario`, `/asistencia`, `/solicitudes`, `/viaticos`, `/prestamos`, `/recibos`.

### Contrato visual

- Encabezado/acciones: patrón existente de gestión.
- Catálogos y personal: `CatalogTable` + cards + `ViewToggle`.
- Altas/ediciones: `Sidebar` `large/wide`, contenido premium, tabs, labels asociados, cuerpo desplazable y footer fijo.
- Estados: `status-pill`/`catalog-pill`; Toast para resultado; `ConfirmDialog` para acciones destructivas/irreversibles.
- Horario: cuadrícula semanal en escritorio y lista cronológica por día en móvil, con navegación de teclado y alternativa no drag-and-drop.
- Marcaje: experiencia móvil de pasos claros `Permisos -> Rostro -> Ubicación -> Resultado`, sin ocultar por qué queda en revisión.
- Nómina: tabla densa con totales fijos y detalle lateral; acciones de cierre con resumen de impacto y segunda confirmación.
- No introducir CSS global no encapsulado ni redefinir `.modal-*`, `input`, `select` o `textarea` desde una página.

## 9. Reglas funcionales críticas

### Conversión de usuario

1. `EXTERNAL -> INTERNAL`: crear empleado, contrato/compensación inicial opcionales según fase y cambiar tipo en una sola transacción.
2. Si falla cualquier validación, no queda usuario interno sin empleado.
3. `INTERNAL -> EXTERNAL`: requiere baja/cierre laboral; conserva historial y desvincula sólo el estado activo, no evidencia histórica.
4. Desactivar usuario revoca sesiones; dar de baja empleado no borra usuario automáticamente, pero ofrece acción explícita de revocación.

### Resolución de turno para marcar

1. Obtener hora de servidor y zona de sucursal.
2. Buscar turnos publicados dentro de la ventana, incluyendo el día anterior si cruza medianoche.
3. Descartar otra empresa/usuario/sucursal.
4. Si hay cero o más de un candidato, registrar incidencia/revisión según política.
5. Verificar challenge facial y geocerca.
6. Validar transición de evento y duplicado.
7. Persistir punch, verificación y auditoría atómicamente.
8. Recalcular resumen/incidencias de forma idempotente.

### Cálculo de nómina

1. Exigir período de asistencia cerrado.
2. Congelar versión de reglas y snapshot de empleados elegibles.
3. Incorporar sólo extras/solicitudes aprobadas y vigentes.
4. Calcular ingresos, bases, deducciones, préstamos y neto con redondeo definido.
5. Ejecutar reconciliaciones y banderas de anomalía.
6. Recalcular sustituye únicamente una corrida `DRAFT/CALCULATED`; nunca una aprobada.
7. Aprobar bloquea entradas; pagar genera recibo/asientos y cuotas.
8. Anular crea reversión y reabre dependencias sólo mediante flujo autorizado.

## 10. Seguridad, privacidad y cumplimiento

- Cámara y geolocalización requieren HTTPS en producción y permisos del navegador.
- Plantillas biométricas cifradas con clave versionada distinta de JWT; rotación y revocación documentadas.
- Challenge corto, aleatorio, de un uso y ligado a usuario/dispositivo/acción.
- Rate limit más estricto para enrolamiento/verificación y bloqueo progresivo sin impedir fallback legítimo.
- No registrar plantilla, imagen, salario, identificación, ubicación exacta ni cuenta bancaria en logs de aplicación.
- Política de retención configurable para verificaciones y coordenadas; los agregados necesarios para nómina pueden conservarse sin imagen.
- Consentimiento informado, finalidad, acceso/rectificación/revocación y alternativa no biométrica documentados.
- Auditoría de lectura para datos especialmente sensibles cuando sea viable.
- Exportaciones protegidas, con expiración y sin URLs públicas predecibles.
- MFA o reautenticación reforzada para nómina, biometría, exportaciones sensibles, anulaciones y reaperturas.
- Solicitudes de acceso/rectificación/cancelación, legal hold y restauración con claves se incluyen en el runbook de privacidad.
- Amenazas a probar: IDOR multiempresa, escalamiento de permisos, replay facial, punch duplicado, geocoordenadas manipuladas, cambio de reloj, solapes, aprobación propia, doble nómina y doble cuota.

## 11. Base legal configurable — Nicaragua

La implementación no sustituye revisión laboral/contable. Las reglas se almacenarán con vigencia y evidencia de aprobación. La base oficial consultada confirma, entre otros puntos:

- jornadas diurna/nocturna, límites de horas extra, descanso, feriados, vacaciones y pago de extra en el [Código del Trabajo, Ley 185](https://legislacion.asamblea.gob.ni/Normaweb.nsf/%28%24All%29/FA251B3C54F5BAEF062571C40055736C);
- tratamiento proporcional y fecha de pago del décimo tercer mes en la misma Ley 185;
- tasas por régimen y tamaño de empleador publicadas por el [INSS](https://inss-princ.inss.gob.ni/index.php/tramites-37/10-afiliaciones/13-regimenes-de-afiliacion);
- consentimiento, proporcionalidad, seguridad, confidencialidad y derechos del titular en la [Ley 787 de Protección de Datos Personales](https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNorma.xsp?action=openDocument&documentId=E5D37E9B4827FC06062579ED0076CE1D).

Antes de habilitar una corrida productiva se requiere acta de validación por la persona responsable de nómina/contabilidad con: tasas INSS, tabla IR, salario mínimo del sector, bases gravables, redondeo, subsidios, feriados/asuentos y reglas de liquidación vigentes a la fecha.

## 12. Fases de implementación y checklist vivo

### Fase 0 — Descubrimiento y diseño

- [x] Inventariar stack, modelo multiempresa, autenticación, permisos y auditoría.
- [x] Inventariar rutas, navegación y componentes UX/UI reutilizables.
- [x] Confirmar que no existe dominio RH previo.
- [x] Diseñar alcance funcional ampliado y flujos críticos.
- [x] Definir estrategia de privacidad biométrica y geocerca.
- [x] Crear este plan y matriz de aceptación.
- [x] Revisión final cruzada de agentes y ajuste del plan.

**Salida:** plan maestro aprobado técnicamente, sin programación de producto.

### Fase 1 — Fundación RH y geocerca

- [x] Añadir enum/tipo interno-externo a `User` con default/backfill `EXTERNAL`.
- [ ] Resolver email opcional para usuarios sin correo, conservando unicidad/login y sin placeholders ficticios; diferido por su impacto transversal en autenticación y recuperación.
- [~] Crear organización, empleado, adscripción, contrato, compensación y documentos: modelos completos y CRUD base de empleado/catálogos; contratos, compensaciones y documentos aún requieren API/UI propia.
- [x] Añadir campos geográficos, versión de geocerca y activación de asistencia a `Branch`.
- [~] Migración SQL aditiva y rollback creados/validados estáticamente; baseline, ejecución en MySQL `_test` y ensayo de rollback pendientes.
- [x] Servicios/controladores/rutas/allowlists/validaciones/permisos/auditoría de la fundación.
- [~] Conversión `EXTERNAL -> INTERNAL` transaccional implementada; la reversión conserva el vínculo histórico y queda bloqueada hasta diseñar baja/recontratación sin romper evidencia.
- [x] UI Personal, expediente, usuarios interno/externo y Sucursales con alta geográfica atómica/geocerca versionada.
- [~] Unitarias RH, typecheck, lint, Vitest y builds aprobados; integración MySQL y E2E de navegador pendientes.

**Aceptación:** Owner crea/edita/desactiva empleado ligado a usuario; externo no puede tener empleado; no hay fuga tenant; sucursal guarda coordenadas válidas y no habilita asistencia incompleta.

### Fase 2 — Horarios semanales

- [x] Modelos de plantillas, semana, turnos, feriados y versionado, con migración aditiva y rollback manual.
- [x] Solicitudes de intercambio/cobertura de turno y acuse de publicación.
- [x] Servicio de conflictos, copia, publicación, sustitución inmutable y revisión optimista CAS.
- [x] API por usuario/sucursal/puesto/semana, más plantillas, feriados, intercambios y autoservicio.
- [x] Calendario Owner y `Mi horario` responsive/accesible, con alternativa móvil, estados parciales y protección offline.
- [~] Acuse de recepción implementado; notificación push/in-app de nueva versión queda pendiente de una infraestructura de notificaciones RH persistente.
- [~] Pruebas unitarias de solape, turno nocturno, DST inexistente/duplicado, multi-sucursal, publicación concurrente, swaps efectivos/obsoletos, scope, contrato y carreras UI aprobadas; aplicación/rollback MySQL y E2E de navegador siguen pendientes.

**Aceptación:** Owner publica una semana sin conflictos; el usuario sólo ve su horario vigente; cada turno conserva sucursal/puesto/versión.

### Fase 3 — Marcaje facial y geográfico

- [x] Políticas versionadas, perfil/challenge/verificación biométrica y eventos inmutables de asistencia.
- [~] Interfaz facial 1:1, modo productivo `disabled` fail-closed y falso sólo con opt-in fuera de producción; adaptador/credenciales del proveedor productivo real pendientes.
- [x] Registro seguro de kiosco/dispositivo, secreto de una sola visualización, revocación y verificación 1:1.
- [x] Consentimiento versionado, enrolamiento, revocación local inmediata, cifrado y obligación de purga/retención.
- [x] Captura efímera de cámara/GPS con estados de permisos, precisión y fallback manual administrado.
- [x] Resolución del asignado efectivo, turno nocturno, Haversine, precisión, tolerancia y secuencia.
- [x] Excepciones explicables, revisión Owner y ajuste compensatorio sin modificar el evento original.
- [x] Pruebas de replay, proveedor deshabilitado/fallido, GPS impreciso, duplicado, secuencia y concurrencia; suite RH acumulada de 50 pruebas aprobada.
- [ ] Piloto de precisión/falsos rechazos con datos no productivos y criterios de go/no-go.

**Aceptación:** un marcaje válido queda ligado a usuario, turno y sucursal; fuera de regla produce resultado explicable/revisión; ningún fallo crea una asistencia silenciosa; no se expone plantilla/imagen.

### Fase 4 — Asistencia, extras, permisos y vacaciones

- [x] Resumen diario derivado, incidencias deduplicadas y cierre/reapertura versionado de período.
- [ ] Cola offline cifrada/firmada para dispositivos autorizados y conciliación tardía sin reabrir nómina silenciosamente.
- [x] Catálogo/flujo de incidencias y correcciones mediante eventos compensatorios canónicos.
- [x] Solicitud/aprobación de horas extra con snapshot de revisión y bloqueo por fuente obsoleta.
- [x] Tipos/solicitudes de permiso y ausencia, solapes, fracciones y evidencia fail-closed.
- [x] Ledger append-only de vacaciones, uso, ajuste y reversión compensatoria.
- [x] Autoservicio y bandejas Owner para jornada, extras, permisos y saldos.
- [~] Consultas operativas disponibles; exportación dedicada, calendario visual de cobertura y alertas persistentes quedan pendientes.
- [x] Pruebas de saldos, reversión, autoaprobación, cierre/reapertura, turno nocturno y permisos parciales/completos.

**Aceptación:** asistencia cerrada reconcilia eventos; sólo extras aprobadas y permisos vigentes alimentan el período; saldos se explican por ledger.

### Fase 5 — Nómina y aguinaldo

- [x] Reglas versionadas, configuración paramétrica append-only y componentes tipados.
- [x] Período, corrida, snapshot congelado, cálculo Decimal, reconciliación y cobertura única por persona/rango.
- [~] Esquema técnico de INSS/IR/reglas parametrizadas con carga, hash, evidencia y revisión dual implementado; valores legales reales siguen bloqueados hasta validación firmada.
- [x] Flujo `DRAFT -> CALCULATED -> REVIEW -> APPROVED -> PAID`, anulación compensatoria y bloqueo de reapertura de asistencia mientras exista dependencia viva.
- [x] Recibo PDF, consulta Owner/autoservicio y exportación CSV/XLSX autenticada.
- [x] Corrida especial de aguinaldo basada en componentes históricos pagados, lookback y prorrateo versionados.
- [x] Anomalías bloqueantes, trazabilidad de fuentes y segregación de preparar/calcular/revisar/aprobar/pagar.
- [x] Pruebas de configuración, Decimal, concurrencia/idempotencia, doble pago, reversión, privacidad y contratos de rutas.
- [ ] Validación firmada de nómina/contabilidad antes de producción.

**Aceptación:** la misma entrada/versiones producen el mismo resultado; totales reconcilian; una corrida aprobada es inmutable; cada línea es trazable a su fuente.

### Fase 6 — Viáticos, préstamos, deducciones y baja

- [x] Flujo de viático: borrador, envío, aprobación, anticipo, gastos, liquidación y reversión.
- [x] Préstamo principal-only, calendario versionado, desembolso, ledger, cuotas, abonos, cierre y reversión.
- [x] Deducciones únicas/recurrentes, vigencia, prioridad, límite por período, versión y aplicación.
- [x] Integración idempotente con nómina: proyectar al calcular, comprometer al pagar y revertir al anular.
- [ ] Terminación y liquidación final.
- [~] Autoservicio Owner/empleado implementado; repositorio seguro de comprobantes y reportes exportables dedicados pendientes.
- [x] Pruebas de conciliación, cuota duplicada, reversión, saldo, estados, aislamiento e idempotencia.

**Aceptación:** cada saldo se reconstruye desde asientos; nómina no duplica descuentos; la baja conserva historial y revoca acceso según decisión explícita.

### Fase 7 — End-to-end, hardening y entrega

- [~] Unit tests, Vitest, typecheck y build completos; integración MySQL y Playwright pendientes.
- [x] Auditoría adversarial estática/unitaria multiempresa, biométrica, geográfica, laboral, RBAC y financiera con remediación P1.
- [ ] Pruebas responsive/accesibilidad/teclado y permisos de navegador.
- [ ] Ensayo de migración, backup, restore y rollback.
- [ ] Piloto en una sucursal y una frecuencia de nómina.
- [ ] Runbooks, manual Owner/empleado, privacidad, soporte e incidentes.
- [ ] Monitoreo, métricas y alertas operativas sin PII sensible.
- [x] Actualizar plan vivo y base técnica con arquitectura, contratos, evidencias, gates y riesgos residuales.

**Aceptación:** todo el flujo `usuario -> empleado -> horario -> marcaje -> incidencia/aprobación -> nómina/beneficio -> reporte` pasa end-to-end, con tenant, auditoría y reversión verificadas.

### Fase 8 — Ampliación RH integral

- [ ] Reclutamiento: vacantes, candidatos, entrevistas, oferta y conversión a alta.
- [ ] Onboarding/offboarding con checklist, responsables y aceptación de políticas.
- [ ] Evaluaciones de desempeño, objetivos y planes de mejora.
- [ ] Capacitación, certificaciones/carnés, vencimientos y aptitud por puesto.
- [ ] Seguridad ocupacional: accidentes/incidentes, acciones correctivas y seguimiento documental.
- [ ] Entrega/devolución de uniformes, equipos, llaves y otros activos.
- [ ] Acciones disciplinarias con evidencia, confidencialidad y revisión autorizada.
- [ ] Reportes e historial de estas áreas con permisos granulares.

**Aceptación:** los procesos de ciclo de vida posteriores al núcleo usan el mismo expediente, vigencias, documentos, aprobaciones, privacidad y auditoría, sin crear identidades paralelas.

## 13. Estrategia de pruebas

### Unitarias

- Distancia Haversine, radio, precisión y coordenadas límite.
- Selección de turno y ventanas, incluidos turnos nocturnos/partidos.
- Máquina de marcajes y recálculo de jornada.
- Devengo/consumo/reversión de vacaciones.
- Extras, feriados, redondeo y topes.
- Nómina, aguinaldo, préstamos, amortización y liquidación con casos dorados.

### Integración MySQL

- Conversión interno/externo atómica.
- Scope empresa/sucursal y relaciones cruzadas maliciosas.
- Publicación concurrente de horarios.
- Punch duplicado/replay y resumen idempotente.
- Aprobaciones concurrentes, cierres y reaperturas.
- Corrida concurrente, cuota única y reversión.

### Frontend/E2E

- Owner administra persona, sucursal, horario y solicitudes.
- Usuario ve sólo `Mi RH`, concede/deniega cámara-GPS y marca.
- Emulación de geolocalización y proveedor facial falso firmado en entorno de prueba.
- Estados vacío/carga/error/reintento/sin permisos/offline.
- Mobile, dark mode, teclado, focus trap, labels y lectores de pantalla básicos.

### Reconciliaciones obligatorias

- `eventos crudos + ajustes = jornada`.
- `jornadas cerradas + aprobaciones = entradas de nómina`.
- `ingresos - deducciones = neto` por empleado y total de corrida.
- `principal + cargos - pagos/reversiones = saldo préstamo`.
- `anticipo + reembolso = gastos aprobados + devolución`.

## 14. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| GPS del navegador puede falsificarse | Marcaje indebido | Precisión, challenge, señales de dispositivo, límites, revisión y no prometer certeza absoluta |
| Falso rechazo/sesgo facial | Impide marcar | Prueba de vida/proveedor evaluado, umbrales pilotados, fallback supervisado y métricas |
| Exposición biométrica/salarial | Crítico | Cifrado, mínimos datos, permisos específicos, retención, logs limpios y auditoría |
| Reglas legales cambian | Nómina incorrecta | Reglas con vigencia, fuentes/acta de aprobación y no hardcodear tasas |
| Horarios nocturnos/zonas | Minutos incorrectos | Instantes UTC + timezone IANA + pruebas de cruce |
| Doble marcaje/corrida/cuota | Duplicación | Idempotencia, uniques, transacciones y locks |
| Cambios existentes no relacionados | Regresión/pérdida | Diffs acotados, preservar worktree, validación por fase |
| Volumen de eventos | Lentitud | Índices por tenant/fecha, paginación, resúmenes derivados y jobs idempotentes |
| Proveedor facial no definido | Bloqueo productivo | Interfaz de proveedor desde Fase 3 y gate explícito antes del piloto |

## 15. Definición de terminado por tarea

Una tarea sólo se marca completa cuando cumple todo lo aplicable:

- schema/migración/rollback/backfill;
- servicio transaccional y scope tenant;
- validación/controlador/ruta/permisos;
- auditoría e idempotencia cuando corresponde;
- tipos/API/vista/estados UX;
- unitarias + integración + frontend/E2E;
- lint, typecheck y build;
- documentación y criterio de aceptación con evidencia;
- sin degradar cambios preexistentes ni introducir secretos/PII en repositorio.

## 16. Puertas de decisión con valor predeterminado

Estas decisiones no detienen la fundación; se mantienen configurables:

1. **Proveedor facial:** interfaz agnóstica; ningún adaptador de prueba se habilita en producción.
2. **Modo ante fallo:** `REVIEW` por defecto, no rechazo definitivo silencioso.
3. **Geocerca inicial:** radio configurable por sucursal; no se inventa un radio universal.
4. **Owner:** `SUPERADMIN` + permisos; no se agrega rol `OWNER` duplicado sin necesidad.
5. **Usuarios históricos:** `EXTERNAL` hasta conversión explícita.
6. **Fotos crudas:** no conservar; una excepción requiere política, cifrado, acceso y expiración.
7. **Nómina legal:** cálculo productivo deshabilitado hasta registrar reglas vigentes y aprobación responsable.

## 17. Bitácora de avances

| Fecha | Fase | Cambio | Evidencia | Estado |
|---|---|---|---|---|
| 2026-07-13 | 0 | Auditoría inicial de arquitectura, UX/UI y dominio | Repositorio + fuentes oficiales enlazadas | Completado |
| 2026-07-13 | 0 | Creación del plan maestro RH | `docs/PLAN_IMPLEMENTACION_MODULO_RH.md` | Completado |
| 2026-07-13 | 0 | Revisión cruzada backend, frontend y dominio RH | Ajustes de rutas, versionado, privacidad, offline y alcance ampliado | Completado |
| 2026-07-13 | 1 | Fundación de datos y API RH | Prisma válido; migración/rollback; `/api/v1/hr`; 18 pruebas RH aprobadas | Implementado, ensayo DB pendiente |
| 2026-07-13 | 1 | Personal, expediente, usuarios y geocerca | Typecheck/lint/build cliente-servidor; 50 pruebas frontend aprobadas | Implementado, E2E pendiente |
| 2026-07-13 | 1 | Revisión adversarial multiagente y consolidación | Corregidos permisos, IDOR de sucursal, revocación de sesiones, intervalos, edición PII y loop de Toast | Completado |
| 2026-07-13 | 2 | Horarios semanales versionados y autoservicio | Backend, frontend e integración asignados en frentes no solapados | Implementado, ensayo DB/E2E pendiente |
| 2026-07-13 | 2 | Backend de horarios, plantillas, feriados e intercambios | Prisma/typecheck/build/ESLint aprobados; 7 suites y 32 pruebas RH aprobadas antes del endurecimiento final | Implementado, ensayo DB pendiente |
| 2026-07-13 | 2 | Calendario Owner y `Mi horario` | Typecheck/ESLint aprobados; 19 suites y 59 pruebas frontend aprobadas; revisión adversarial P1 corregida | Implementado, E2E pendiente |
| 2026-07-13 | 2 | Revisión cruzada de concurrencia y alcance | CAS real en UI, bloqueo de publicación filtrada, no mezcla de semanas y publicación corporativa restringida a alcance empresa | Completado |
| 2026-07-13 | 2 | Endurecimiento final de intercambios y tiempo local | Overrides efectivos, reservas/CAS, invalidación al superseder, retry serializable y política DST `earlier/later`; 18 pruebas focales | Completado |
| 2026-07-13 | 3 | Marcaje facial/geográfico | Backend y frontend integrados con proveedor productivo fail-closed, captura efímera, eventos inmutables y geocerca | Implementado; proveedor real, piloto, DB y E2E pendientes |
| 2026-07-13 | 3 | Validación técnica de servidor | Prisma format/generate/validate, typecheck, build, ESLint y 9 suites/50 pruebas RH | Completado |
| 2026-07-13 | 4 | Jornadas, extras, ausencias, vacaciones y autoservicio | Hito intermedio de vistas cliente; completado por la consolidación del 2026-07-14 | Superado |
| 2026-07-14 | 4 | Consolidación de jornadas y permisos | Resúmenes derivados, períodos, incidencias, correcciones, extras, permisos fraccionados, vacaciones y bloqueos de fuente; 50/50 pruebas focales | Implementado; DB/E2E pendiente |
| 2026-07-14 | 5 | Nómina y aguinaldo | Configuración legal dual-control e inmutable, snapshots, ledger histórico normalizado, cobertura, cálculo segmentado, pago evidenciado y reversión compensatoria; 22/22 pruebas F5 | Implementado; validación legal y DB pendientes |
| 2026-07-14 | 6 | Viáticos, préstamos y deducciones | Estados, ledgers, autoservicio, moneda fail-closed e integración project/commit/reverse con nómina; 13/13 pruebas F6 | Implementado; evidencias seguras/DB pendientes |
| 2026-07-14 | 7 | Hardening multiagente | Cerradas escalación de roles, PII de mutaciones, alcance Owner, empleados inactivos, publicación TOCTOU, permisos/marcaje y reintento ambiguo de gastos | Completado en código |
| 2026-07-14 | 7 | Gates completos locales | Servidor 85 suites/469 pruebas; cliente 38 archivos/140 pruebas; Prisma válido; typecheck y build cliente aprobados | Completado sin aplicar migraciones |
| 2026-07-14 | 7 | Loop adversarial final | Corregidos cinco controles financieros iniciales, estado E2E de componentes manuales y congelamiento total de reglas validadas; dos reauditorías independientes reportaron 0 P0/P1 | Cerrado |

## 18. Entregables documentales finales

- Este plan actualizado y cerrado.
- Diagrama de entidades y estados finales.
- Contrato API y matriz de permisos.
- Catálogo de reglas de asistencia/nómina con vigencias.
- Política de privacidad/retención biométrica y geográfica.
- Runbook de enrolamiento, marcaje manual, cierre/reapertura y nómina.
- Plan de migración/rollback y reporte de ensayo.
- Matriz de pruebas con evidencia y riesgos residuales.
- Manual Owner y guía `Mi RH` para el trabajador.
