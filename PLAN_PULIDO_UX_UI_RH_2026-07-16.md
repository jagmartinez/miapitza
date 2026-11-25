# Plan de pulido UX/UI del módulo de Recursos Humanos

Fecha: 2026-07-16

## Objetivo

Cerrar la brecha visual entre el acceso y la aplicación, y reconstruir las superficies de Recursos Humanos con la claridad operativa de Gestión de Inventario, sin alterar flujos de negocio ya validados. El resultado debe conservar dark mode, formatos monetarios con separadores de miles, `react-select`, accesibilidad, responsive y estados completos de carga, vacío, error, confirmación y bloqueo.

## Diagnóstico inicial

- El login usa una base casi negra con azules luminosos; el shell autenticado salta a superficies azul-gris más claras y densas. Se unificarán profundidad, bordes, acentos y contraste mediante tokens compartidos.
- Gestión de Personal no muestra identificación ni compensación. La compensación existe como historial separado, pero no participa en el alta ni en el listado.
- La frecuencia actual `BIWEEKLY` representa el pago quincenal de 24 periodos anuales. Catorcenal necesita una frecuencia propia de 26 periodos; no se resolverá con una etiqueta ambigua.
- Varias vistas RH reutilizan nombres de clases de Inventario, pero sin una composición uniforme de encabezado, filtros, KPI, bandeja, tabla/tarjetas, estados y acciones.
- Horarios semanales usa siete columnas estrechas y obliga a explorar tarjetas densas. Se priorizará la lectura por colaborador/día, la visibilidad de cobertura y las acciones contextuales.
- Perfil y Mi biometría conservan la lógica correcta, pero su jerarquía visual, orientación y lectura de estados requieren reconstrucción.
- Los modales y sidebars mezclan patrones viejos y nuevos. Se consolidarán estructura, espaciado, footer fijo, validación, inputs, `react-select`, foco, responsive y dark mode. La interfaz especializada de Procesar pago entra en la auditoría visual solicitada, pero conservará su lógica y composición operativa propia.

## Frentes no solapados

### Frente A — Personal, compensación y horarios

Propiedad exclusiva: `Employees`, `EmployeeForm`, contratos/compensaciones relacionadas, `Schedules`, `ScheduleWeekView`, sus tipos, clientes, rutas/servicios/prisma necesarios, pruebas y estilos específicos.

Entregables:

- Identificación segura en tabla/tarjetas de Personal, sin ampliar datos sensibles a roles no autorizados.
- Salario, moneda, tipo y frecuencia vigentes visibles con separadores de miles.
- Alta de empleado y compensación inicial transaccional; no dejar empleados parcialmente creados.
- Frecuencias Semanal, Quincenal, Catorcenal y Mensual modeladas sin reinterpretar datos históricos.
- Edición salarial mediante historial efectivo y auditable, nunca sobrescritura destructiva.
- Nuevo workspace semanal más práctico, con resumen de cobertura, navegación clara y adaptación móvil.

### Frente B — Operación RH con lenguaje de Inventario

Propiedad exclusiva: Revisión de asistencia, Control diario, Permisos y vacaciones, Viáticos/préstamos/deducciones, Marcaje, Mis viáticos y beneficios, Mis recibos y Mi gestión laboral; estilos y pruebas de esas vistas.

Entregables:

- Composición común: encabezado orientado a tarea, filtros compactos, KPI útiles, bandejas/tabs claras, tabla o tarjetas legibles, acciones consistentes y estados completos.
- Densidad y jerarquía equivalentes a Gestión de Inventario sin copiar elementos ajenos al dominio.
- Contraflujos visibles: rechazos, cancelaciones, reversos, devoluciones/ajustes, indisponibilidad y estados cerrados cuando apliquen.
- Responsive, teclado, foco, etiquetas y regiones accesibles.

### Frente C — Identidad visual, Perfil y Biometría

Propiedad exclusiva: login, Perfil, Mi biometría y sus estilos/pruebas específicas.

Entregables:

- Continuidad visual real entre login y shell autenticado.
- Perfil reconstruido desde cero como centro de identidad, seguridad, empresa y accesos personales.
- Mi biometría reconstruida desde cero como flujo guiado de estado, privacidad, consentimiento, enrolamiento y revocación.
- Mantener intactas autenticación, 2FA, permisos y reglas biométricas del servidor.

### Consolidación principal — Sistema compartido de modales y calidad final

Propiedad exclusiva del agente principal: primitivas compartidas `Modal`, `Sidebar`, confirmaciones, selects/inputs globales, tokens transversales, integración entre frentes y correcciones finales.

Entregables:

- Anatomía compartida para título/contexto, contenido seccionado, errores, footer y acciones destructivas.
- Dark mode sin superficies blancas residuales; contraste y foco visibles.
- `react-select` en selecciones complejas; sin `<select>` nativos nuevos en los flujos pulidos.
- Entradas monetarias con presentación agrupada y valor canónico seguro para API.
- Auditoría visual de todos los modales, incluida la superficie especializada de Procesar pago, sin modificar su lógica transaccional.

## Ciclo de revisión obligatorio

1. Cada frente inspecciona contratos, rutas y estados antes de editar.
2. Implementa solamente sus archivos asignados.
3. Ejecuta pruebas focalizadas, typecheck y revisión de diff.
4. Reporta riesgos, archivos y evidencia al agente principal.
5. El agente principal consolida, ejecuta la suite completa y prueba recorridos reales en navegador.
6. Los hallazgos vuelven al frente propietario para corrección; se repite hasta cerrar los criterios.

## Criterios de aceptación

- No hay pérdida ni exposición indebida de PII.
- Alta de empleado + compensación es atómica y queda auditada.
- Quincenal y catorcenal tienen semántica y periodos distintos end-to-end.
- Todas las vistas solicitadas comparten lenguaje visual, pero preservan su lógica.
- No hay cortes, scroll horizontal accidental ni acciones inaccesibles en 1440 px, 1024 px y móvil.
- Dark mode, focus-visible, contraste, navegación por teclado y lectores de pantalla quedan cubiertos.
- Montos se muestran agrupados y se envían sin corrupción de decimales.
- Tests focalizados y contractuales, lint, typecheck, build cliente/servidor y recorridos Playwright terminan en verde.
- La documentación final enumera cambios, decisiones, pruebas y cualquier riesgo residual real.
