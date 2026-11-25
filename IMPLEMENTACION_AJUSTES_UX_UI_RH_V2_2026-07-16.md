# Implementación de ajustes UX/UI RH V2

Fecha: 2026-07-16

## Resultado

Se consolidó una segunda pasada visual y funcional del módulo de Recursos Humanos, Profile, autoservicio Mi RH y la fundación de modales. La lógica de negocio existente se conservó; los cambios funcionales se limitaron al flujo de pago mixto y a la presentación/validación de la división de cuenta por unidades.

## Horarios y operación administrativa

- En Horarios semanales, las acciones de copiar y publicar se integraron en `filters-toolbar hr-schedule-filters`.
- Se eliminó `hr-schedule-actions-bar` y se ampliaron los selectores sin romper el ajuste móvil.
- Revisión de asistencia, Control diario, Permisos y vacaciones y Viáticos/préstamos/deducciones quedaron orientados a tabla, siguiendo la composición de Recetas de Producción.
- Se eliminaron KPIs redundantes, captions/títulos internos duplicados y banners positivos de conexión.
- Jornadas, Incidencias, Correcciones, Horas extra y Periodos usan una barra de tabs externa, compacta, navegable y con conteos.
- Los estados offline siguen visibles y bloquean mutaciones sensibles; sólo se suprimió el ruido visual del estado online normal.

## IR laboral, INSS e INATEC

- Inputs, tasas, montos, resúmenes y tablas numéricas usan alineación derecha y cifras tabulares.
- La tabla de versiones legales separa número y nombre de versión.
- Se aumentó la jerarquía tipográfica del encabezado y del número de versión.

## Profile y Mi RH

- Profile fue reconstruido como una superficie compacta y plana: hero reducido, navegación horizontal, contenido de una columna y formulario con ancho máximo de 880 px.
- Las cards de Mi RH son el launcher principal; se eliminaron las tabs repetidas del portal.
- Cada destino conserva únicamente el enlace contextual “Mis accesos de RH”.
- Mi horario, Mi gestión laboral, Mis recibos, Mis viáticos y beneficios, Marcaje y Mi biometría comparten una fundación visual específica de autoservicio.
- Mi biometría conserva consentimiento, reto, enrolamiento, revocación, retención y procesamiento exclusivo del servidor.
- Se verificó ausencia de desbordes en 1024 × 900 y 390 × 844 para los seis destinos.

## Modales

- Modal, Sidebar, ConfirmDialog, NumericKeypad, TableOrdersModal, TableSelectionModal y PaymentModal usan superficies planas, bordes y fondos del sistema.
- Se eliminaron barras superiores, gradientes, iconos azules decorativos, desplazamientos y sombras azules de hover.
- El azul queda reservado para acciones activas y foco accesible.
- Se conservan los anchos `sm`, `md` y `lg`; los flujos con mayor densidad pueden usar un ancho mayor sin cambiar el lenguaje visual.
- El panel de mesa ocupa todo su ancho útil y ya no reserva una franja lateral vacía.

## Procesar pago

- Pago mixto incluye efectivo cuando existe un método `CASH` activo y un turno de caja utilizable.
- No se crea ni se simula un método de efectivo fuera del catálogo persistido.
- La división abre por unidades y centra la interacción en “¿Quién paga cada plato?”.
- En esa estrategia no se renderizan cards `.payment-leg`; cada comensal se presenta en `.split-payer-total` con nombre, método, total exacto, efectivo recibido/cambio y estado confirmado.
- Al completar las asignaciones se solicita una vista previa al servidor.
- La respuesta debe reconciliar exactamente en centavos con el saldo pendiente.
- Los nombres se normalizan y se rechazan vacíos o duplicados sin distinguir mayúsculas.
- Se conservaron idempotencia, reintento únicamente de tramos pendientes, pagos ya confirmados y bloqueo de efectivo sin turno.

## Evidencia de validación

- Vitest cliente: 53 archivos, 231 pruebas aprobadas.
- ESLint cliente: aprobado.
- TypeScript cliente: aprobado.
- Build Vite de producción: aprobado, 2665 módulos transformados.
- Jest servidor focal: 4 suites y 26 pruebas aprobadas para división de cuenta, límites financieros, reversos y seguridad de asistencia.
- Playwright consolidado: 23 pruebas aprobadas en Chromium.
- Matriz responsive incluida en Playwright: Profile y los seis destinos de Mi RH a 1024 px y 390 px.
- `git diff --check`: aprobado.

## Estado de entrega

Los cambios permanecen en el working tree. En esta iteración no se realizó commit ni despliegue.
