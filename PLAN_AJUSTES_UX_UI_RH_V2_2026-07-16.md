# Plan de corrección UX/UI RH — segunda iteración

Fecha: 2026-07-16

## Objetivo

Corregir la sobrecomposición introducida en la primera iteración y homologar RH, Perfil y modales con las superficies principales del producto. Esta revisión elimina información redundante, recupera la densidad de Recetas de Producción y Business Intelligence, y corrige el flujo de pago mixto/división por unidades sin alterar cálculos financieros, permisos ni contraflujos.

## Lectura de las capturas

- `Versiones legales` presenta valores de versión comprimidos y de difícil lectura; encabezados y montos necesitan jerarquía y alineación tabular.
- Perfil desperdicia altura en un hero sobredimensionado, navegación lateral redundante y campos excesivamente largos.
- Algunos modales dejan una superficie visual vacía o un tratamiento lateral que parece una segunda columna.
- Los diálogos introducen brillo, gradientes y acentos azules que no existen en las vistas operativas principales.
- Business Intelligence confirma el patrón objetivo: superficies planas azul-gris, bordes sobrios, separadores claros y acento reservado para acciones/estado.

## Frentes no solapados

### Frente A1 — Horarios y configuración legal

Propiedad exclusiva:

- `Schedules`, `ScheduleWeekView`, `schedule.css`.
- `PayrollLegalSettings`, `PayrollRuleConfigurationPanel` y estilos de configuración legal.

Entregables:

- Mover la acción secundaria de Horarios al toolbar, eliminar `hr-schedule-actions-bar` y ampliar selects.
- Alinear montos legales a la derecha y mejorar la legibilidad de la tabla Versiones legales.

### Frente A2 — Operación RH, propiedad del agente principal

Propiedad exclusiva:

- `AttendanceReview`, `AttendanceManagement`, `LeaveManagement`, `BenefitsManagement` y estilos operativos compartidos RH.
- Integración global de `OnlineOnlyNotice` y `PayrollOnlineNotice`.

Entregables:

- Eliminar avisos online visibles y KPIs solicitados.
- Hacer que las tablas de revisión/control/ausencias/beneficios sigan el patrón de Recetas de Producción, sin títulos/captions visuales redundantes.
- Reubicar tabs Jornadas, Incidencias, Correcciones, Horas Extra y Periodos en una navegación compacta, estable y responsive.
- Eliminar de todas las vistas RH las superficies visuales `hr-online-notice online` y `hr-payroll-online online`, conservando avisos offline útiles.

### Frente B — Perfil y autoservicio Mi RH

Propiedad exclusiva:

- `Profile` y sus estilos/pruebas.
- `MyWorkforce`, `MyBenefits`, `MyPayroll`, `TimeClock`, `Biometrics`, `MySchedule`, navegación `MyHrNav` y estilos de autoservicio.

Entregables:

- Reconstruir Perfil con proporciones compactas, formularios acotados y jerarquía útil; eliminar la navegación redundante.
- En Mi RH, usar cards como navegación primaria y retirar tabs duplicados.
- Reconstruir visualmente todas las vistas asociadas al empleado con un patrón consistente, no sólo la portada.
- Mantener accesibilidad, responsive, estados sin vínculo laboral, permisos, seguridad y reglas biométricas existentes.

### Frente C — Sistema modal y pagos

Propiedad exclusiva:

- Primitivas `Modal`, `Sidebar`, `ConfirmDialog`, `NumericKeypad`, modales de mesas y estilos/tokens compartidos.
- `PaymentModal`, sus utilidades y pruebas financieras/UI.
- Modales POS que consumen esas primitivas.

Entregables:

- Un solo estándar visual para todos los modales; sólo el ancho varía por contenido.
- Retirar brillo, gradientes y barras/acento azul decorativo; usar las mismas superficies, bordes y sombras de las vistas principales.
- Corregir la zona vacía/lateral señalada en modales de mesa.
- Añadir Efectivo en pago mixto respetando métodos activos y validaciones del servidor.
- En división por unidades, mostrar únicamente `¿Quién paga cada plato?`, retirar `payment-leg` y calcular/mostrar por comensal el total exacto asignado.
- Conservar idempotencia, redondeo, validación de totales, permisos y contraflujos de pago.

## Consolidación principal

El agente principal:

1. Revisa que ningún frente haya modificado archivos de otro.
2. Ejecuta diff review de lógica y estilos.
3. Devuelve hallazgos concretos a cada frente y exige una segunda corrección cuando corresponda.
4. Prueba visualmente escritorio, 1024 px y móvil.
5. Ejecuta Vitest/Jest, lint, typecheck, builds, Prisma y Playwright focal/completo.
6. Documenta riesgos reales; no hace commit ni despliegue sin una solicitud posterior explícita.

## Criterios de aceptación

- No aparecen avisos `online`; los bloqueos offline siguen siendo visibles y accionables.
- Tablas RH solicitadas usan la densidad, encabezado, borde y acciones de Recetas de Producción.
- Tabs operativos no compiten con toolbar, KPIs o títulos duplicados.
- Perfil y Mi RH no repiten navegación y sus inputs no ocupan anchos desproporcionados.
- Todos los modales comparten anatomía, color, sombra, separadores, close button, footer y responsive.
- Sólo cambia el ancho cuando el contenido lo exige; no aparecen columnas vacías ni fondos laterales.
- Pago mixto incluye Efectivo cuando está disponible.
- División por unidades conserva cada plato y muestra un total reconciliado por comensal; la suma coincide exactamente con el saldo.
- Dark mode, separadores de miles, `react-select`, foco, teclado y scroll quedan preservados.
