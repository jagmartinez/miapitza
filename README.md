# Mia Pitza Restaurant System

Sistema multiempresa para compras, inventario, producción, menú, promociones,
órdenes, POS, caja, cocina, facturación, delivery, catering y reservaciones.

El informe técnico vigente, con correcciones, evidencia ejecutada y riesgos
residuales, está en
[`docs/CORRECCION_HALLAZGOS_AUDITORIA_E2E_2026-07-22.md`](docs/CORRECCION_HALLAZGOS_AUDITORIA_E2E_2026-07-22.md).
`docs/CERTIFICACION_TRANSACCIONAL_E2E_2026-07-13.md` y los demás informes
anteriores se conservan únicamente como antecedentes históricos.

El núcleo de Recursos Humanos F1–F6 está consolidado localmente y documentado en
[`docs/MODULO_RH_BASE_TECNICA_FUNCIONAL.md`](docs/MODULO_RH_BASE_TECNICA_FUNCIONAL.md),
con avance y pendientes en
[`docs/PLAN_IMPLEMENTACION_MODULO_RH.md`](docs/PLAN_IMPLEMENTACION_MODULO_RH.md).
No debe habilitarse en producción hasta completar los gates legales, biométricos,
de evidencias, migración MySQL y pruebas de navegador descritos allí.

## Desarrollo

El cliente requiere Node.js `^20.19.0` o `>=22.12.0`; el servidor requiere
Node.js 20 o superior y MySQL. Copie los archivos
`.env.example`, configure secretos propios y luego ejecute, en `server/` y
`client/`, `npm install` y `npm run dev`.

Antes de liberar una versión se deben ejecutar lint, typecheck, pruebas, build y
la verificación de migraciones descritos en el dictamen vigente. Nunca use
credenciales predeterminadas ni reutilice secretos de ejemplos.

En producción el servidor exige `STORAGE_DIR` absoluto y un
`STORAGE_SHARED_ID` estable. Antes de iniciar workers o aceptar tráfico concilia
un marcador del volumen con MySQL; `/api/v1/health` falla si una réplica usa
almacenamiento aislado. Si RH exige biometría, readiness también exige que el
proveedor remoto esté disponible y reporte exactamente el modelo y la versión
fijados. La topología soportada, los gates de migración y los límites de
certificación de hardware están en
[`docs/production-go-live-runbook.md`](docs/production-go-live-runbook.md).

## Mesas, órdenes, facturación, pagos y KDS

El corte histórico del 14 de julio de 2026 está documentado en
[`docs/MESAS_ORDENES_PAGOS_KDS.md`](docs/MESAS_ORDENES_PAGOS_KDS.md). Incluye el
plano persistente y editable de salones/mesas a pantalla completa, consolidación y traslado, factura obligatoria antes
del pago, división por consumo, reversos, KDS táctil, notificaciones, permisos,
reglas transaccionales, migraciones, pruebas y los riesgos que estaban
pendientes en esa fecha. Para el estado actual consulte primero el informe
vigente del 22 de julio.

Las migraciones principales son `20260714_harden_financial_payment_audit`,
`20260714_invoice_before_payment`, `20260714_add_table_map_and_account_operations`,
`20260714_add_floor_areas`, `20260714_add_kds_release_notifications` y `20260714_add_operational_permissions`.
Antes de desplegar ejecute lint, typecheck, pruebas unitarias/integración/E2E,
build, auditoría completa de dependencias y un ensayo de migraciones contra una
copia restaurable. El documento enlazado conserva el estado histórico; el
informe vigente registra las contramedidas fiscales ya implementadas y las
brechas que todavía no deben tratarse como terminadas, incluida la reversión de
consolidaciones.
