# Certificación técnica GO a producción

Fecha de corte: 26 de julio de 2026.

Rama revisada: `codex/rh-nomina-estatutaria`.

Base de la rama al iniciar el corte: `98ebd5d8c45f`.

## 1. Dictamen

**GO CONTROLADO para liberar el API y el cliente web.**

El proveedor facial puede desplegarse como servicio inactivo/no requerido, pero
hay **NO-GO para activar políticas biométricas obligatorias** hasta verificar
sus variables autorizadas, conectividad interna, readiness con
`required=true` y un piloto físico con calibración de cámara.

Este dictamen autoriza técnicamente preparar el commit y ejecutar el
procedimiento controlado de release. No afirma que estas correcciones ya estén
en producción: en este corte no se hizo commit, push ni despliegue.

Antes del despliegue son obligatorios:

1. congelar exactamente este candidato en un commit identificable, sin incluir
   artefactos locales ni cambios ajenos;
2. generar y verificar un respaldo lógico de producción inmediatamente antes
   de desplegar el API.

## 2. Correcciones incluidas

- Reintento acotado de la transacción completa ante `P2034` en pagos,
  reversos, facturación, cancelación, crédito y cierre/cancelación de órdenes.
- Validación estricta de booleanos en catálogos y plantillas RH.
- Revocación autoritativa de roles en sesiones abiertas.
- Aislamiento de la cola offline entre usuario y token.
- Descarte de respuestas obsoletas y estados de carga explícitos en Usuarios y
  Reservaciones.
- Separación entre pago confirmado y fallo posterior de refresco en POS.
- Asociación accesible de errores en selectores.
- Readiness biométrico cerrado ante fallos de retención o almacenamiento,
  recuperación acotada y errores `503` sanitizados.
- Rotación correcta del token facial: el API envía solo el token activo y el
  proveedor puede aceptar temporalmente activo/anterior.
- Diagnóstico seguro del harness, sin imprimir payloads arbitrarios.
- Verificación de ledger compatible exclusivamente con el mismo SQL en LF o
  CRLF; cualquier cambio real de contenido continúa fallando cerrado.
- Contextos de build protegidos contra `output/`, `.coverage`, temporales,
  cliente y proveedor ajenos a la imagen API.
- Cadena Swagger actualizada a `swagger-jsdoc 6.3.0` y contratos de runtime para
  OpenAPI y ExcelJS.

El detalle causal y los contraflujos están en
[`CORRECCIONES_AUDITORIA_INTEGRAL_2026-07-25.md`](CORRECCIONES_AUDITORIA_INTEGRAL_2026-07-25.md).

## 3. Evidencia del candidato

### API

- Unidad final: **143 suites, 897/897 PASS**.
- Integración MySQL: **20 suites, 74/74 PASS**.
- Migraciones del artefacto: **59**.
- Lint, typecheck y build TypeScript/Prisma: **PASS**.
- Compatibilidad OpenAPI y ExcelJS buffer/streaming: **3/3 PASS**.
- Harness operacional sobre base restaurada y migrada:
  - carga: 500/500, cero fallos, p95 63.79 ms;
  - soak de 10 segundos: 11,085/11,085, cero fallos, p95 9.9 ms;
  - webhook sin firma: 401;
  - JSON sobredimensionado: 413;
  - WebSocket sin autenticar: cierre 4001;
  - readiness posterior a contraflujos: 200.
- Imagen local:
  `sha256:532ee634c65d1cf2ba93b59e00740e099fed101d2ca4db67fa972f807bc99773`.
- Smoke de imagen contra baseline desechable:
  - migraciones restantes aplicadas correctamente;
  - `/api/v1/health`: HTTP 200, `healthy`;
  - proceso final UID 1000, igual al UID del usuario `node` de la imagen;
  - base, usuario, baseline, volumen y contenedor temporales eliminados y
    verificados.

### Cliente web

- Vitest: **74 archivos, 339/339 PASS**.
- Playwright Chromium: **73/73 PASS**.
- Lint, typecheck y build Vite: **PASS**, 2,282 módulos.
- Imagen local:
  `sha256:acdf47c0bbd13719194ed0508472cb47420930f9086894e7d91e778a47a17951`.
- Smoke local de la imagen: HTTP 200; contenedor temporal eliminado.

### Proveedor biométrico

- Pytest: **35/35 PASS**.
- Cobertura: **86.48%**, superior al gate de 82%.
- Ruff, `pip check` y `pip-audit --strict --vulnerability-service osv`:
  **PASS**, cero vulnerabilidades conocidas en 39 dependencias.
- Hashes de modelos: verificados.
- Imagen local:
  `sha256:065dbab598b40dac89b7fdfaa83aec3730a8db35bc02d4e753531396ac4894c0`.
- Smoke local de `/health` y `/ready` autenticado: HTTP 200, proceso no root;
  recursos temporales eliminados.

## 4. Evidencia de producción previa al release

Las siguientes comprobaciones fueron de solo lectura y describen la versión que
ya estaba desplegada, no el candidato todavía sin desplegar:

- API `/api/v1/health`: HTTP 200, base de datos, almacenamiento compartido y
  WebSocket en estado correcto.
- Cliente `/`: HTTP 200.
- Ledger:
  - 61 filas históricas;
  - 59 migraciones exitosas esperadas;
  - 2 intentos revertidos;
  - 0 pendientes, inesperadas o con drift de contenido.
- Invariantes:
  - stock negativo: 0;
  - órdenes con total negativo: 0;
  - órdenes pagadas sin detalle: 0;
  - pagos activos no positivos: 0;
  - drift de estado financiero: 0;
  - productos activos o con stock positivo sin costo: 0.

La alerta inicial de ocho checksums fue reproducida y se comprobó que provenía
exclusivamente de CRLF frente a LF. La corrección acepta solo esas
representaciones equivalentes; no debilita la detección de SQL modificado.

## 5. Excepciones de seguridad aceptadas

Los scanners npm no quedan en verde:

1. **Servidor: 9 avisos high.** Todos llegan por
   `ExcelJS -> archiver -> glob/minimatch -> brace-expansion`. El código revisado
   usa ExcelJS para buffer y streaming de libros; no entrega patrones glob
   controlados por el usuario a esa cadena. La recomendación automática de
   bajar ExcelJS a 4.1.1 fue probada de forma aislada y mantuvo los avisos. Los
   overrides de archiver rompieron contratos de runtime y se descartaron.
2. **Cliente: 2 avisos high.** El advisory de React Router afecta las APIs
   inestables de React Server Components. Este cliente es una SPA Vite con
   `BrowserRouter`; no contiene configuración, imports ni bundles RSC. La rama
   corregida disponible exige React y Node incompatibles con el stack actual.

Estas son excepciones de alcance demostrado, no un `npm audit` limpio. Deben
revisarse cuando ExcelJS/archiver y React Router publiquen versiones compatibles.

- React Router:
  <https://github.com/advisories/GHSA-qwww-vcr4-c8h2>
- brace-expansion:
  <https://github.com/advisories/GHSA-mh99-v99m-4gvg>

## 6. Secuencia obligatoria de release

1. Revisar y congelar el diff exacto; excluir `output/`, `.coverage`,
   `.tmp-*` y cualquier trabajo ajeno.
2. Crear commit y registrar su SHA.
3. Generar respaldo lógico de producción, verificar tamaño y SHA-256.
4. Desplegar primero el API.
5. Confirmar migraciones, `/api/v1/health`, identidad de almacenamiento,
   WebSocket y logs sin errores.
6. Desplegar el cliente desde la raíz `client`.
7. Ejecutar smoke de login, cambio de sucursal, POS, pago, factura, cocina,
   inventario, reservas, usuarios y RH.
8. Mantener biometría deshabilitada/no requerida. Su activación es un release
   separado sujeto al gate físico indicado en la sección 1.
9. Observar durante 15-30 minutos errores 5xx, latencia, conflictos
   transaccionales, readiness y conexiones WebSocket.

Rollback: volver a los despliegues anteriores de API/web si falla cualquier
readiness o smoke. No usar `db push --accept-data-loss`; las migraciones deben
fallar cerrado.

## 7. Límites del dictamen

- No se provocó un deadlock físico bajo carga; el retry se validó
  determinísticamente, con integración real y tope de tres intentos.
- Playwright usa contratos API simulados; el smoke posterior al despliegue sigue
  siendo obligatorio.
- El readiness productivo actual informa biometría `required=false`; por tanto
  no prueba la comunicación real API-proveedor.
- Las reglas operativas y contraflujos existentes no se omiten ni se fuerzan
  para declarar este GO.
