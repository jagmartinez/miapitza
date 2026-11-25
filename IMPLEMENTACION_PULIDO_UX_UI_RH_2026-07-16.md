# Implementación de pulido UX/UI de Recursos Humanos

Fecha: 2026-07-16

## Resultado

Se completó el pulido visual y funcional solicitado para Recursos Humanos. La intervención conserva las reglas de negocio existentes, pero también cerró los vacíos end-to-end necesarios para mostrar y administrar compensación inicial, distinguir pago quincenal de catorcenal y mantener un historial salarial auditable.

## Identidad visual

- Login y aplicación autenticada comparten ahora la misma base azul-gris, profundidad, bordes, radios y acento azul.
- El login usa un fondo continuo: el panel de acceso ya no añade otro degradado ni divisor vertical.
- Perfil fue reconstruido como centro de identidad, empresa, sucursal, seguridad y autoservicio RH.
- Mi biometría fue reconstruida como flujo guiado de estado, privacidad, consentimiento, enrolamiento y revocación, sin cambiar las reglas biométricas del servidor.

## Personal, compensación y horarios

- Gestión de Personal muestra identificación autorizada y compensación vigente en tabla y tarjetas.
- El alta crea empleado, usuario interno, compensación inicial y auditorías dentro de una sola transacción.
- Los cambios posteriores de salario se agregan al historial efectivo; no sobrescriben el dato anterior.
- Frecuencias definidas sin ambigüedad:
  - Semanal: 52 períodos por año.
  - Quincenal (`BIWEEKLY`): 24 períodos por año.
  - Catorcenal (`FORTNIGHTLY`): 26 períodos por año.
  - Mensual: 12 períodos por año.
- Horarios semanales incorpora KPIs, cobertura diaria, matriz colaborador por día y lectura cronológica responsive.

## Vistas operativas RH

Revisión de asistencia, Control diario, Permisos y vacaciones, Viáticos/préstamos/deducciones, Marcaje, Mis beneficios, Mis recibos y Mi gestión laboral adoptan el lenguaje operativo de Inventario:

- encabezados orientados a tarea;
- filtros compactos y KPIs accionables;
- superficies delimitadas, bandejas y tabs accesibles;
- estados vacíos, bloqueados y fuera de línea;
- contraflujos visibles para rechazo, cancelación, ajuste, cierre y reverso cuando aplican;
- composición responsive y navegación por teclado.

Mi gestión laboral separa Asistencia, Solicitudes y Vacaciones. Marcaje usa un cockpit de turno, próxima acción, biometría e historial.

## Modales y controles compartidos

- Modal, Sidebar, confirmaciones, selector numérico, pedidos de mesa y Procesar pago comparten tokens visuales, cabecera, separación, foco y dark mode.
- Los modales superiores se portalizan fuera de contenedores transformados.
- La pila de diálogos garantiza que sólo el modal superior procese `Escape` y `Tab`, mantiene el bloqueo de scroll balanceado y restaura el foco.
- `react-select` calcula la apertura según el diálogo y su footer; el host de portal accesible evita recortes en Procesar pago.
- Los atajos globales del POS ignoran eventos que nacen dentro de un diálogo.
- Se conservaron formato monetario agrupado y valores canónicos seguros para API.

## Validación consolidada

- Cliente Vitest: 52 archivos, 220 pruebas, todas aprobadas.
- Servidor Jest: 105 suites, 595 pruebas, todas aprobadas.
- Playwright: 20 recorridos visuales y de modales, todos aprobados.
- Lint cliente y servidor: aprobado.
- Typecheck cliente y servidor: aprobado.
- Build de producción cliente y servidor: aprobado.
- Prisma schema: válido.
- `git diff --check`: limpio.
- Inspección del login en escritorio y móvil: sin overflow horizontal y con fondo visual continuo.

## Pendiente operativo explícito

La migración `server/prisma/migrations/20260716_add_fortnightly_pay_frequency/migration.sql` está creada y validada, pero no fue aplicada a ninguna base de datos. Tampoco se hizo commit ni despliegue porque no formaban parte de esta solicitud. Antes de liberar estos cambios debe aplicarse la migración mediante el flujo normal de despliegue y ejecutar el smoke test autenticado con datos reales, incluyendo cámara/biometría y Procesar pago.
