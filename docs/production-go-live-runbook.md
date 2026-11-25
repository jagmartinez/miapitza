# Production Go-Live Runbook

## 1. Alcance y regla de seguridad

Este runbook separa cuatro estados: compilaciÃ³n, readiness tÃ©cnica, validaciÃ³n
transaccional y certificaciÃ³n de hardware/proveedores. Un `200` de liveness no
certifica base de datos, impresora, proveedor delivery, cÃ¡mara, GPS ni kiosco.

- Nunca ejecutar seeds demo, carga, caos o restores contra producciÃ³n.
- Nunca inventar credenciales para aprobar un gate.
- No habilitar un canal si su contrato outbound o su secreto tenant-specific no
  existen y no fueron probados en sandbox.
- Las migraciones son forward-only. El rollback de datos es restaurar un backup
  verificado en infraestructura aislada y cambiar al artefacto compatible.

## 2. Preflight obligatorio

1. Confirmar commit/tag inmutable y CI verde sobre ese SHA.
2. Validar variables del servidor: `DATABASE_URL`, `JWT_SECRET`,
   `TWO_FA_ENCRYPTION_KEY`, `CLIENT_URL`, `STORAGE_DIR` y
   `PEDIDOSYA_HTTP_TIMEOUT_MS` (250..60000; recomendado 8000), ademÃ¡s de
   `READINESS_DB_TIMEOUT_MS` (50..10000; recomendado 2000).
3. Validar variables del cliente: `VITE_API_URL` y `VITE_WS_URL`, ambas HTTPS/WSS
   en producciÃ³n.
4. Confirmar volumen durable y escritura en `STORAGE_DIR`.
5. Confirmar backup reciente, checksum/retenciÃ³n y un restore ensayado.
6. Confirmar que la ventana de migraciÃ³n tiene owner, observador y criterio de
   aborto. `docker-entrypoint.sh` solo ejecuta `prisma migrate deploy`; nunca
   `db push --accept-data-loss`.

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
sin sesiÃ³n cerrado con `4001` y readiness `200` despuÃ©s del caos.

## 4. Healthchecks

| Endpoint | PropÃ³sito | Debe usarlo |
|---|---|---|
| `/health` | liveness del proceso, sin DB | diagnÃ³stico del proceso |
| `/api/v1/health` | readiness: DB + WebSocket inicializado | Railway, Compose y promociÃ³n de release |

Readiness no estÃ¡ detrÃ¡s del rate limiter pÃºblico. Un `503` impide recibir trÃ¡fico;
no debe convertirse manualmente en `200` para completar un despliegue.

## 5. Integraciones y hardware

| Interfaz | Estado comprobable sin hardware | Requisito para certificaciÃ³n real |
|---|---|---|
| Ticket 58/80 mm | columnas acotadas, controles sanitizados, popup/fallo fail-closed | impresiÃ³n en cada modelo, corte, acentos, logo, papel agotado, USB/red desconectada |
| Caja/POS | flujos transaccionales e idempotencia automatizados | gaveta/terminal/lector real, rechazo, timeout, duplicado y reconciliaciÃ³n del adquirente |
| PedidosYa | firma tenant, sandbox URL, timeout, estados FAILED durables | credenciales sandbox oficiales, OAuth, webhook firmado, catÃ¡logo, status y conciliaciÃ³n |
| Uber Eats/Rappi | webhook y outbound permanecen bloqueados | modelo de secreto por tenant y adapter oficial antes de habilitar |
| WebSocket/KDS | auth fail-closed, scope, carga y reconexiÃ³n automatizados | Wi-Fi real, suspensiÃ³n de tablet, reconexiÃ³n y ruido operativo |
| CÃ¡mara/GPS | permisos denegados, evidencia nula y timeout GPS contratados | HTTPS, navegador/dispositivo real, baja luz, cÃ¡mara ocupada, GPS pobre/simulado |
| Kiosco RH | flag apagado y solicitudes con device bloqueadas | cliente kiosco protegido, provisioning, rotaciÃ³n/revocaciÃ³n y piloto presencial |

No interpretar el botÃ³n del navegador `window.print()` como confirmaciÃ³n de que
la impresora recibiÃ³ o imprimiÃ³ el ticket. El sistema actual no integra ACK de
ESC/POS, spooler ni sensor de papel.

## 6. Ensayo seguro de backup/restore

Ejecutar primero con una base local que termine en `_test`. El destino de restore
debe terminar exactamente en `_restore_test`.

```powershell
cd server
$env:DATABASE_URL='mysql://USUARIO:CLAVE@localhost:3306/restaurante_test'
npm.cmd run db:backup -- --out C:\ruta-segura\release.ndjson.gz
npm.cmd run db:restore -- --file C:\ruta-segura\release.ndjson.gz --target-database restaurant_release_restore_test
npm.cmd run db:verify-restore -- --target-database restaurant_release_restore_test
npm.cmd run db:drop-restore -- --target-database restaurant_release_restore_test
```

`db:verify-restore` debe devolver cero issues, cero migraciones fallidas y validar
FKs/invariantes. Conservar evidencia de tiempos, tamaÃ±o y conteos; eliminar el
artefacto de prueba al finalizar. La restauraciÃ³n productiva requiere aprobaciÃ³n
del owner/DBA y nunca se ensaya por primera vez durante el incidente.

## 7. Despliegue y rollback

1. Crear backup consistente y registrar su identificador/checksum.
2. Desplegar backend canary/staging y aplicar `migrate deploy`.
3. Exigir `/api/v1/health = 200` antes de promover trÃ¡fico.
4. Ejecutar smokes: login, WebSocket, orden-cocina-caja, inventario, ticket y solo
   los canales externos aprobados.
5. Desplegar frontend del mismo SHA y validar asset hashing/cache.
6. Observar al menos una ventana operativa acordada.

Rollback obligatorio ante fallo sistÃ©mico de autenticaciÃ³n, corrupciÃ³n de
cantidades/caja, aumento sostenido de 5xx, readiness 503, incompatibilidad de
migraciÃ³n o integraciÃ³n crÃ­tica sin degradaciÃ³n segura.

1. Detener promociÃ³n y sacar el release nuevo de trÃ¡fico.
2. Reponer frontend/backend estable compatible con el esquema actual.
3. Si el esquema no es backward-compatible, restaurar el backup en una base
   nueva, verificarla y cambiar la conexiÃ³n siguiendo el procedimiento DBA.
4. Repetir readiness y smokes sobre el rollback.
5. Registrar ventana de impacto, datos reconciliados y causa.

Nunca ejecutar SQL rollback improvisado ni borrar migraciones aplicadas.

## 8. Observabilidad inicial

Durante la primera hora registrar, por sucursal/canal:

- tasa y p95/p99 HTTP, saturaciÃ³n del pool DB y consultas lentas;
- `401/403/409/413/429/5xx` y timeouts outbound;
- conexiones/cierres WebSocket y tiempo de reconexiÃ³n KDS;
- webhooks `RECEIVED/PROCESSED/FAILED`, retraso y duplicados;
- pagos/reversos, cierres de caja, desfases de stock y capas FIFO;
- errores de impresiÃ³n reportados operativamente (no existe ACK automÃ¡tico);
- sin PII, secretos, biometrÃ­a o salarios en logs/mÃ©tricas.

Los umbrales de producciÃ³n deben definirse con baseline de staging y capacidad
real. El presupuesto local del harness no sustituye un SLO.

## 9. Sign-off

No marcar el release completo sin firma de Engineering, QA, Operaciones y owner
de datos. Hardware/proveedor pendiente debe quedar como bloqueo explÃ­cito o canal
deshabilitado, nunca como aprobado por inferencia.
