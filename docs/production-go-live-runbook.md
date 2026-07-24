# Production Go-Live Runbook

## 1. Alcance y regla de seguridad

Este runbook separa cuatro estados: compilación, readiness técnica, validación
transaccional y certificación de hardware/proveedores. Un `200` de liveness no
certifica base de datos, impresora, proveedor delivery, cámara, GPS ni kiosco.

- Nunca ejecutar seeds demo, carga, caos o restores contra producción.
- Nunca inventar credenciales para aprobar un gate.
- No habilitar un canal si su contrato outbound o su secreto tenant-specific no
  existen y no fueron probados en sandbox.
- Las migraciones son forward-only. El rollback de datos es restaurar un backup
  verificado en infraestructura aislada y cambiar al artefacto compatible.

## 2. Preflight obligatorio

1. Confirmar commit/tag inmutable y CI verde sobre ese SHA.
2. Validar variables del servidor: `DATABASE_URL`, `JWT_SECRET`,
   `TWO_FA_ENCRYPTION_KEY`, `CLIENT_URL`, `STORAGE_DIR`,
   `STORAGE_SHARED_ID` y
   `PEDIDOSYA_HTTP_TIMEOUT_MS` (250..60000; recomendado 8000), además de
   `READINESS_DB_TIMEOUT_MS` (50..10000; recomendado 2000) y
   `READINESS_STORAGE_TIMEOUT_MS` (100..10000; recomendado 2000). Si el proveedor
   facial es HTTP, fijar también `HR_FACE_PROVIDER_MODEL` y
   `HR_FACE_PROVIDER_VERSION`.
3. Validar variables del cliente: `VITE_API_URL` y `VITE_WS_URL`, ambas HTTPS/WSS
   en producción.
4. Confirmar volumen durable y escritura en `STORAGE_DIR`. No promover tráfico
   hasta que `/api/v1/health` reporte `storage.status=ok`,
   `storage.mode=verified-shared` y `storage.verified=true`.
5. Confirmar backup reciente, checksum/retención y un restore ensayado.
6. Confirmar que la ventana de migración tiene owner, observador y criterio de
   aborto. `docker-entrypoint.sh` solo ejecuta `prisma migrate deploy`; nunca
   `db push --accept-data-loss`.

### Topología de almacenamiento soportada

- Desarrollo/pruebas de un solo proceso: `STORAGE_DIR` y `STORAGE_SHARED_ID`
  pueden omitirse; readiness reporta `local-development` y `verified=false`.
- Producción de una o varias réplicas: ambas variables son obligatorias,
  `STORAGE_DIR` debe ser absoluto y todas las réplicas conectadas a la misma
  base deben montar el mismo volumen físico con el mismo `STORAGE_SHARED_ID`.
- El arranque crea o lee un marcador aleatorio del volumen y concilia su hash
  con la fila singleton `PRIMARY` de `StorageIdentity` en MySQL antes de iniciar
  workers o escuchar tráfico. Una réplica con disco aislado falla cerrada
  incluso si intenta usar otro `STORAGE_SHARED_ID`; cambiar el ID sobre el
  volumen autoritativo también falla y requiere investigación operativa.
- Un snapshot/clon que copie también el marcador puede conservar el mismo hash;
  ese caso requiere control del proveedor de almacenamiento y prueba operativa
  de escritura/lectura cruzada entre réplicas.

## 3. Gates reproducibles

### Servidor

```bash
cd server
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

### Cliente

```bash
cd client
npm ci
npm run lint
npm run typecheck
npm test -- --run
npm run test:e2e
npm run build
```

### Carga, soak y caos local

Este comando lee `.env.test` y se niega a ejecutar si `DATABASE_URL` no apunta a
localhost o si la base no termina en `_test`.

```powershell
cd server
$env:RELEASE_HARNESS_ALLOW_LOCAL='true'
npm.cmd run test:release-harness -- --requests 300 --concurrency 16 --soak-ms 5000 --max-p95-ms 1500
```

El harness exige: liveness/readiness `200`, cero errores de carga/soak, p95 bajo
el presupuesto indicado, webhooks sin firma `401`, JSON >1 MiB `413`, WebSocket
sin sesión cerrado con `4001` y readiness `200` después del caos.

## 4. Healthchecks

| Endpoint | Propósito | Debe usarlo |
|---|---|---|
| `/health` | liveness del proceso, sin DB | diagnóstico del proceso |
| `/api/v1/health` | readiness: DB + WebSocket + storage; proveedor/modelo/versión facial cuando la biometría es requerida | orquestador, Compose y promoción de release |

Readiness no está detrás del rate limiter público. Un `503` impide recibir tráfico;
no debe convertirse manualmente en `200` para completar un despliegue.
Si el probe DB falla, readiness no intenta reconciliar `StorageIdentity`. Si el
filesystem o su consulta de identidad exceden `READINESS_STORAGE_TIMEOUT_MS`,
responde `503` y conserva un único probe en vuelo para evitar tormentas de
archivos o consultas durante la degradación.

## 5. Integraciones y hardware

| Interfaz | Estado comprobable sin hardware | Requisito para certificación real |
|---|---|---|
| Ticket 58/80 mm | columnas acotadas, controles sanitizados, popup/fallo fail-closed | impresión en cada modelo, corte, acentos, logo, papel agotado, USB/red desconectada |
| Caja/POS | flujos transaccionales e idempotencia automatizados | gaveta/terminal/lector real, rechazo, timeout, duplicado y reconciliación del adquirente |
| PedidosYa | firma tenant, sandbox URL, timeout, estados FAILED durables | credenciales sandbox oficiales, OAuth, webhook firmado, catálogo, status y conciliación |
| Uber Eats/Rappi | webhook y outbound permanecen bloqueados | modelo de secreto por tenant y adapter oficial antes de habilitar |
| WebSocket/KDS | auth fail-closed, scope, carga y reconexión automatizados | Wi-Fi real, suspensión de tablet, reconexión y ruido operativo |
| Cámara/GPS | permisos denegados, evidencia nula y timeout GPS contratados | HTTPS, navegador/dispositivo real, baja luz, cámara ocupada, GPS pobre/simulado |
| Kiosco RH | flag apagado y solicitudes con device bloqueadas | cliente kiosco protegido, provisioning, rotación/revocación y piloto presencial |

No interpretar el botón del navegador `window.print()` como confirmación de que
la impresora recibió o imprimió el ticket. El sistema actual no integra ACK de
ESC/POS, spooler ni sensor de papel.

## 6. Ensayo seguro de backup/restore

Ejecutar primero con una base local que termine en `_test`. El destino de restore
debe terminar exactamente en `_restore_test`.

```powershell
cd server
$env:DATABASE_URL='mysql://USUARIO:CLAVE@localhost:3306/restaurante_test'
npm.cmd run db:backup -- --out C:\ruta-segura\release.ndjson.gz
npm.cmd run db:restore -- --file C:\ruta-segura\release.ndjson.gz --target-database restaurant_release_restore_test
npm.cmd run db:rehearse-migrations -- --target-database restaurant_release_restore_test
npm.cmd run db:verify-restore -- --target-database restaurant_release_restore_test
npm.cmd run db:drop-restore -- --target-database restaurant_release_restore_test
```

`db:rehearse-migrations` debe aplicar sobre la copia restaurada exactamente las
migraciones del artefacto que todavía no existían en el respaldo. Después,
`db:verify-restore` debe devolver cero issues, comparar todas las migraciones
esperadas del repositorio con `_prisma_migrations`, detectar faltantes,
desconocidas, checksums distintos, fallidas o revertidas, y validar
FKs/invariantes. Conservar evidencia de tiempos, tamaño y conteos; eliminar el
artefacto de prueba al finalizar. La restauración productiva requiere aprobación
del owner/DBA y nunca se ensaya por primera vez durante el incidente.

## 7. Despliegue y rollback

1. Crear backup consistente y registrar su identificador/checksum.
2. Desplegar backend canary/staging y aplicar `migrate deploy`.
3. Exigir `/api/v1/health = 200` antes de promover tráfico.
4. Ejecutar smokes: login, WebSocket, orden-cocina-caja, inventario, ticket y solo
   los canales externos aprobados.
5. Desplegar frontend del mismo SHA y validar asset hashing/cache.
6. Observar al menos una ventana operativa acordada.

Rollback obligatorio ante fallo sistémico de autenticación, corrupción de
cantidades/caja, aumento sostenido de 5xx, readiness 503, incompatibilidad de
migración o integración crítica sin degradación segura.

1. Detener promoción y sacar el release nuevo de tráfico.
2. Reponer frontend/backend estable compatible con el esquema actual.
3. Si el esquema no es backward-compatible, restaurar el backup en una base
   nueva, verificarla y cambiar la conexión siguiendo el procedimiento DBA.
4. Repetir readiness y smokes sobre el rollback.
5. Registrar ventana de impacto, datos reconciliados y causa.

Nunca ejecutar SQL rollback improvisado ni borrar migraciones aplicadas.

## 8. Observabilidad inicial

Durante la primera hora registrar, por sucursal/canal:

- tasa y p95/p99 HTTP, saturación del pool DB y consultas lentas;
- `401/403/409/413/429/5xx` y timeouts outbound;
- conexiones/cierres WebSocket y tiempo de reconexión KDS;
- webhooks `RECEIVED/PROCESSED/FAILED`, retraso y duplicados;
- pagos/reversos, cierres de caja, desfases de stock y capas FIFO;
- errores de impresión reportados operativamente (no existe ACK automático);
- sin PII, secretos, biometría o salarios en logs/métricas.

Los umbrales de producción deben definirse con baseline de staging y capacidad
real. El presupuesto local del harness no sustituye un SLO.

## 9. Sign-off

No marcar el release completo sin firma de Engineering, QA, Operaciones y owner
de datos. Hardware/proveedor pendiente debe quedar como bloqueo explícito o canal
deshabilitado, nunca como aprobado por inferencia.
