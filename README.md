# Mia Pitza Restaurant System

Sistema multiempresa para compras, inventario, producción, menú, promociones,
órdenes, POS, caja, cocina, facturación, delivery, catering y reservaciones.

El dictamen transaccional vigente y sus gates de salida están en
`docs/CERTIFICACION_TRANSACCIONAL_E2E_2026-07-13.md`. Los informes anteriores se
conservan en `docs/` únicamente como antecedentes históricos.

El núcleo de Recursos Humanos F1–F6 está consolidado localmente y documentado en
[`docs/MODULO_RH_BASE_TECNICA_FUNCIONAL.md`](docs/MODULO_RH_BASE_TECNICA_FUNCIONAL.md),
con avance y pendientes en
[`docs/PLAN_IMPLEMENTACION_MODULO_RH.md`](docs/PLAN_IMPLEMENTACION_MODULO_RH.md).
No debe habilitarse en producción hasta completar los gates legales, biométricos,
de evidencias, migración MySQL y pruebas de navegador descritos allí.

## Desarrollo

El proyecto requiere Node.js 20 o superior y MySQL. Copie los archivos
`.env.example`, configure secretos propios y luego ejecute, en `server/` y
`client/`, `npm install` y `npm run dev`.

Antes de liberar una versión se deben ejecutar lint, typecheck, pruebas, build y
la verificación de migraciones descritos en el dictamen vigente. Nunca use
credenciales predeterminadas ni reutilice secretos de ejemplos.

## Mesas, órdenes, facturación, pagos y KDS

El corte operativo del 14 de julio de 2026 está documentado en
[`docs/MESAS_ORDENES_PAGOS_KDS.md`](docs/MESAS_ORDENES_PAGOS_KDS.md). Incluye el
plano persistente y editable de salones/mesas a pantalla completa, consolidación y traslado, factura obligatoria antes
del pago, división por consumo, reversos, KDS táctil, notificaciones, permisos,
reglas transaccionales, migraciones, pruebas y riesgos pendientes.

Las migraciones principales son `20260714_harden_financial_payment_audit`,
`20260714_invoice_before_payment`, `20260714_add_table_map_and_account_operations`,
`20260714_add_floor_areas`, `20260714_add_kds_release_notifications` y `20260714_add_operational_permissions`.
Antes de desplegar ejecute lint, typecheck, pruebas unitarias/integración/E2E,
build, `npm audit --omit=dev --audit-level=high` y un ensayo de migraciones contra
una copia restaurable. El documento enlazado registra reglas, comandos y brechas
que no deben tratarse como terminadas, en especial anulación fiscal y reversión
de consolidaciones.
