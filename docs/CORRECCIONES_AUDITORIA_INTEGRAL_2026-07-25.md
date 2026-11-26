# Correcciones de auditoría integral aplicadas

Fecha de corte: 25 de julio de 2026.

Estado: correcciones implementadas y verificadas localmente sobre
`codex/rh-nomina-estatutaria`.

Este documento no certifica despliegue, datos productivos, cámara física ni
operación continua. No hubo commit, push, migración de una base persistente ni
despliegue. El directorio `output/` preexistente se preservó intacto.

## 1. Resultado ejecutivo

La revisión reprodujo y corrigió defectos confirmados en:

- reintento atómico ante conflictos/deadlocks financieros;
- validación de booleanos en catálogos y jornadas RH;
- revocación efectiva de roles en una sesión ya abierta;
- aislamiento de la cola offline entre identidades y tokens;
- cargas fuera de orden y falsos estados vacíos en Usuarios/Reservaciones;
- semántica de pago confirmado frente a fallos posteriores de refresco;
- accesibilidad de errores en selectores;
- readiness, almacenamiento, retención y observabilidad biométrica;
- portabilidad del gate de modelos y rotación de tokens en Compose.

Los gates funcionales, de tipos, lint, compilación, migraciones y contratos
descritos en la sección 4 terminaron en verde. Los audits de dependencias no
terminan en verde y se conservan como riesgo residual explícito.

## 2. Hallazgos confirmados y correcciones

### 2.1 Conflictos Prisma `P2034` en el ciclo mesa-orden

**Causa raíz:** la emisión de factura bloquea `Table -> Order`, mientras que
pago, reverso, entrega, cancelación y contradocumentos pueden bloquear
`Order -> Table`. MySQL puede elegir cualquiera de las transacciones como
víctima de un deadlock. Los límites transaccionales propagaban `P2034` sin
reintentar.

**Corrección:** `transactionWithP2034Retry` repite el callback transaccional
completo únicamente ante `P2034`, con máximo tres intentos. Los errores de
dominio, validación o infraestructura se propagan intactos. Se aplicó a:

- creación y reverso de pago;
- emisión y anulación de factura;
- completar y cancelar orden;
- emisión de nota de crédito.

**Contraflujos:** callback completo repetido desde ambos órdenes de bloqueo,
tope de intentos y error no reintentable sin ocultamiento.

**Límite:** no se ejecutó una prueba de carga que produzca deadlocks físicos. El
comportamiento de retry se validó con `P2034` determinista y las transacciones
reales pasaron la integración MySQL.

### 2.2 Booleanos silenciosamente coercionados en RH

**Causa raíz:** dos fast-paths convertían valores con `Boolean(...)` antes de
validar el DTO. La cadena `"false"` es truthy en JavaScript y podía producir
éxito aparente o persistir `true`.

**Corrección:**

- `ShiftTemplateService.update` valida `active` antes del retorno idempotente.
- `HrCatalogService.update` acepta únicamente booleanos reales.

**Contraflujo:** `"false"` como cadena se rechaza antes de abrir una
transacción; `false` booleano conserva su comportamiento válido.

### 2.3 Revocación de roles no reflejada en el cliente

**Causa raíz:** `roles: []` se convertía en “roles ausentes” y el cliente
reutilizaba `userRoles`/`role` almacenados. Una revocación completa podía dejar
navegación y guards antiguos hasta cerrar sesión.

**Corrección:** se conserva la diferencia entre payload omitido y arreglo vacío.
Un arreglo vacío es autoritativo y `getUserRoleNames` no recae en roles legados.

**Contraflujos:** normalización de roles en los tres formatos admitidos, arreglo
vacío, `hasAnyRole` y rol primario después de revocación.

### 2.4 Cola offline que continuaba después de cambiar identidad

**Causa raíz:** el lote capturaba owner/token al comenzar, pero no los volvía a
comprobar entre operaciones. Un logout/login o rotación de token durante la
primera solicitud permitía continuar el resto del lote anterior.

**Corrección:** antes de cada operación se compara el owner y token actuales con
los capturados. Ante cambio, el lote se detiene y deja las operaciones restantes
pendientes para su propietario original.

**Contraflujos:** cambio de usuario y rotación de token después de la primera
solicitud; una sola operación sale y las restantes no cruzan la sesión.

### 2.5 Usuarios y Reservaciones presentaban fallos como vacío válido

**Causa raíz:** los fallos se reducían a consola/toast y ambas vistas seguían
renderizando el estado vacío. En Usuarios, solicitudes por empresa también
podían resolverse fuera de orden.

**Corrección:**

- error persistente y reintentable mediante `LoadErrorState`;
- bloqueo de filtros, datos y mutaciones mientras la carga es incierta;
- conservación del `companyId` del intento fallido;
- guard monotónico que descarta respuestas obsoletas.

**Contraflujos:** fallo inicial, fallo con datos previos, retry y dos respuestas
en orden inverso.

### 2.6 Pago confirmado presentado como pago fallido

**Causa raíz:** `handlePaymentComplete` agrupaba la confirmación de pago y los
refrescos posteriores en el mismo `try/catch`. Si fallaba el refresh, el mensaje
decía “Error al procesar el pago”, incentivando un posible doble cobro.

**Corrección:** la confirmación se muestra una sola vez. Los fallos posteriores
se informan como “pago confirmado, refresco pendiente” y piden recargar antes de
continuar. El pago offline sigue marcado como pendiente, nunca confirmado.

### 2.7 Error visual de Select sin relación accesible

**Causa raíz:** el mensaje visible no estaba asociado al combobox.

**Corrección:** `aria-invalid`, `aria-errormessage`, identificador estable y
`role="alert"` enlazan el control con su error.

### 2.8 Readiness biométrico independiente de la retención

**Causa raíz:** un fallo de `purge_expired` sólo se registraba; `/health` podía
continuar en `200`.

**Corrección:** readiness:

- inicia cerrado hasta la primera purga exitosa;
- pasa a `503 RETENTION_NOT_READY` ante un fallo posterior;
- reintenta con intervalo acotado;
- vuelve a `200` después de un éxito;
- no trata `CancelledError`/apagado normal como fallo.

### 2.9 Fallos de almacenamiento biométrico como `500`

**Causa raíz:** errores SQLAlchemy de health, enrolamiento, verificación o
revocación alcanzaban el handler genérico.

**Corrección:** el límite común de almacenamiento devuelve
`503 TEMPLATE_STORAGE_UNAVAILABLE`, reintentable y sanitizado. El log incluye
operación y tipo, nunca URL, credenciales ni detalle interno.

### 2.10 Observabilidad biométrica potencialmente silenciosa

**Causa raíz:** el logger propio no heredaba necesariamente la configuración de
Uvicorn y los fallos críticos se emitían a nivel informativo.

**Corrección:** los eventos heredan `uvicorn.error`; fallos de retención,
almacenamiento y errores inesperados usan nivel error.

### 2.11 Gate de modelos no portable

**Causa raíz:** CI descargaba en `biometric-provider/models`, pero la prueba
exigía `/app/models`. La reproducción produjo 31 PASS y 1 FAIL.

**Corrección:** la prueba deriva la ruta del repositorio/fixture. La misma
expresión resuelve `biometric-provider/models` en host y `/app/models` en la
imagen.

### 2.12 Rotación de tokens incompatible con Compose

**Causa raíz:** la documentación permitía `activo,anterior`, pero Compose
alimentaba esa lista tanto al proveedor como al token Bearer saliente del API.
El API habría enviado ambos como un único token inválido.

**Corrección:** `HR_FACE_PROVIDER_TOKEN` contiene sólo el activo;
`FACE_AUTH_TOKENS` puede aceptar temporalmente `activo,anterior` y vuelve por
defecto al token activo. Los ejemplos y README explican la ventana y retiro.

## 3. Archivos principales

### Servidor

- `server/src/utils/transaction-retry.ts`
- `server/src/services/payment.service.ts`
- `server/src/services/order.service.ts`
- `server/src/services/invoice.service.ts`
- `server/src/services/invoice-cancellation.service.ts`
- `server/src/services/credit-note.service.ts`
- `server/src/services/hr-schedule.service.ts`
- `server/src/services/hr.service.ts`

### Cliente

- `client/src/context/AuthContext.tsx`
- `client/src/utils/auth-session.ts`
- `client/src/utils/authz.ts`
- `client/src/services/offlineManager.ts`
- `client/src/utils/latestRequest.ts`
- `client/src/pages/Users.tsx`
- `client/src/pages/Reservations.tsx`
- `client/src/pages/POS.tsx`
- `client/src/components/Select.tsx`

### Biometría/configuración

- `biometric-provider/app/main.py`
- `biometric-provider/tests/test_api.py`
- `biometric-provider/tests/test_engine.py`
- `biometric-provider/README.md`
- `biometric-provider/.env.example`
- `.env.example`
- `docker-compose.yml`

## 4. Evidencia ejecutada

### Servidor

- Focales de correcciones: 5 suites, 41/41 PASS.
- Unidad completa: 141 suites, 891/891 PASS.
- Lint: PASS.
- Typecheck: PASS.
- Build Prisma + TypeScript: PASS.
- Integración MySQL: 20 suites, 74/74 PASS.
- Migraciones en base desechable: 59/59 aplicadas.
- Restore verification: 474 FKs, 19 invariantes, 0 issues.
- Base desechable: eliminación posterior confirmada.

Los `console.error` de la integración corresponden a contraflujos inducidos
(400/401/404, rollback, dependencia inválida y fallo simulado de finalización);
la corrida terminó con exit code 0 y todas las aserciones en verde.

### Cliente

- Focales de correcciones: 7 archivos, 48/48 PASS.
- Vitest completo: 74 archivos, 339/339 PASS.
- Playwright Chromium: 73/73 PASS.
- Lint: PASS.
- Typecheck + build Vite: PASS, 2,282 módulos transformados.

Playwright usa contratos API simulados; no equivale a navegador conectado a un
backend o datos productivos.

### Proveedor biométrico/configuración

- Pytest: 35/35 PASS.
- Cobertura: 86.48%, superior al gate de 82%.
- Ruff: PASS.
- `pip check`: sin dependencias rotas.
- Modelos fijados: descarga y hashes verificados.
- Compose con perfil biométrico: configuración válida con valores ficticios.

## 5. Riesgos residuales y NO-GO

1. **Dependencias npm:** el audit actual informa 12 avisos high en servidor por
   `brace-expansion` transitivo (ExcelJS/Swagger) y 2 high en cliente por React
   Router RSC. npm reporta “No fix available”. El cliente es una SPA Vite y no
   usa APIs RSC detectables, pero el gate de dependencia permanece rojo. No se
   forzó un downgrade/override especulativo.
2. **Python:** `pip-audit` contra OSV agotó 120 segundos; `pip check` no sustituye
   una auditoría de vulnerabilidades.
3. **Concurrencia física:** no se indujo un deadlock real bajo carga. El retry
   tiene tope de tres intentos y después falla explícitamente sin estado parcial.
4. **Biometría física:** no se validaron cámara, iluminación, FAR/FRR real,
   latencia privada ni operación continua. Persiste un
   `StarletteDeprecationWarning` del cliente de pruebas.
5. **Producción:** no hubo restore anonimizado de producción, migración
   productiva, deploy, smoke remoto ni observación posterior.
6. **Orden 36:** no se alteró inventario ni se forzó su entrega. Su bloqueo
   operativo previo requiere conciliación/autorización física, no un bypass.
7. **Git:** los cambios quedan sin commit ni staging. `output/` sigue sin
   seguimiento y no pertenece a esta corrección.

## 6. Criterio de salida

Los defectos confirmados de este ciclo quedaron corregidos y las regresiones
funcionales locales están en verde. El resultado está listo para revisión del
diff y preparación de un commit controlado.

No se concede GO de producción por los riesgos residuales de dependencias,
hardware biométrico, carga concurrente y ausencia de ensayo/restauración con una
copia gobernada de producción.
