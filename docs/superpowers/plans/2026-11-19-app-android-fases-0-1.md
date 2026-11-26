# App Android — Plan de implementación: Fase 0 (prototipo) y Fase 1 (base)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validar el rendimiento de Capacitor en la tablet real (Fase 0) y construir la base de la app: login por PIN en tablets registradas, tablet de cocina con cuenta fija, WebSocket por token y el esqueleto `mobile/` con sesión segura y selección de modo (Fase 1).

**Architecture:** El backend Express+Prisma gana un catálogo `OperationalDevice`, PIN por usuario, `POST /auth/pin-login` y `POST /auth/device-login` que reutilizan la emisión de sesión existente (`UserSession` + JWT). El WebSocket acepta un mensaje `AUTH` con token. La app nueva vive en `mobile/` (React 18 + TS + Vite + Capacitor Android), con cliente HTTP Bearer propio y reutilización de módulos puros de `client/src` vía alias `@web`.

**Tech Stack:** Express 5, Prisma (MySQL), Jest (server); React 18, TypeScript, Vite, Vitest + @testing-library/react, Capacitor 6 (Android).

**Spec:** `docs/superpowers/specs/2026-11-19-app-android-design.md`

## Hoja de ruta completa (planes posteriores se escriben al cerrar cada fase)

| Fase | Plan | Contenido | Gate de salida |
|---|---|---|---|
| 0 | este documento | Prototipo desechable en tablet real | Cumple presupuestos §9 del spec o se revisa enfoque |
| 1 | este documento | Backend PIN/dispositivos/WS + base `mobile/` | APK instala; PIN, cocina y "Mi cuenta" entran al modo correcto |
| 2 | `…-fase-2-mesero.md` | Vista de mesas, abrir mesa, acciones, POS, ticket largo, entregar listos, **promociones y descuentos con autorización de supervisor**, cobro (un pago/varios/dividir), borradores por mesero, offline | Pedido completo de punta a punta en tablet |
| 2b | `…-fase-2b-caja.md` | Abrir turno, turno activo, entradas/salidas, arqueo por denominación C$/US$, cierre y reporte | Un turno de caja completo desde la tablet |
| 3 | `…-fase-3-cocina.md` | KDS kiosco, Listo→desaparece + deshacer 5 s, recientes, sonido, reconexión | Cocina opera un turno sin web |
| 4 | `…-fase-4-mi-cuenta.md` | Marcar, solicitudes en tarjetas, préstamos, horario, nómina, por aprobar, mi NPS | Empleado gestiona todo desde su celular |
| 5 | `…-fase-5-nps-inventario.md` | Encuesta NPS en tablet + reportes web; levantamiento de inventario ciego + revisión/aprobación web | Encuesta y un conteo real completados |
| 6 | `…-fase-6-cierre.md` | Push FCM / fallback local, pulido, e2e, despliegue | Piloto en una sucursal |

**Política de revisión (decidida con el usuario):** agentes refutadores **solo** en tareas marcadas **[CRÍTICA]**; el resto, revisión normal.

## Global Constraints

- Android mínimo: **API 28 (Android 9), 2 GB RAM**; tablets de servicio y cocina **bloqueadas en horizontal**, celular en vertical.
- PIN: **4–6 dígitos**, solo roles **MESERO, CAJERO, HOST, BODEGA, CHEF** (BODEGA/CHEF para el levantamiento de inventario); ADMIN/SUPERADMIN nunca inician sesión por PIN.
- Tablets **no marcan asistencia**; el marcaje es solo desde celular personal.
- Cocina: **cuenta fija por sucursal** (usuario rol COCINA) ligada al dispositivo; su sesión no expira por inactividad, se revoca revocando el dispositivo.
- Al cambiar de usuario o bloquear: **la sesión anterior se revoca**.
- Token en almacenamiento seguro nativo; **nunca** en `localStorage`.
- Tema: **oscuro, monocromo**; el color solo comunica estado (ámbar `#D4A84B` listo, rojo suave `#C96B66` por cobrar/demora).
- Objetivos táctiles ≥ **48 dp** (44 dp solo secundarios en listas).
- Presupuestos: arranque en frío ≤ 3 s; abrir pedido ≤ 300 ms; toque → reflejo ≤ 100 ms; KDS nuevo pedido ≤ 2 s; JS inicial por modo ≤ ~250 KB gzip.
- Backend: mensajes de error de auth genéricos (`'Credenciales inválidas'`), sin revelar bloqueo ni existencia de usuario.

## Review Focus

1. **Fuerza bruta de PIN en una tablet compartida**: 10.000 combinaciones de 4 dígitos son pocas → bloqueo por usuario+dispositivo tras 5 fallos y por dispositivo tras 20 fallos/15 min, con error genérico. Test en Task 3.
2. **Dispositivo revocado a mitad de turno**: las sesiones emitidas por ese dispositivo deben dejar de valer de inmediato (HTTP y WS). Test en Task 2.
3. **Usuario inactivo o de otra sucursal intentando PIN** en la tablet: rechazo genérico. Test en Task 3.
4. **Token vencido mientras el mesero trabaja**: el cliente emite `session-expired` y vuelve a PIN sin borrar el estado local (borradores). Test en Task 7.
5. **WebSocket sin `AUTH` o con token revocado**: cierre `4001` en ≤ 5 s; nunca recibe eventos. Test en Task 5.

---

## FASE 0 — Prototipo de rendimiento (desechable)

### Task 0: Prototipo en tablet real

Es un spike: **sin TDD, sin revisión**, en la rama `spike/android-perf`, que **no se fusiona**.

**Files:** Create: `mobile-spike/` (proyecto Vite React TS + Capacitor Android).

- [ ] **Step 1:** Crear `mobile-spike` con Vite (`react-ts`), añadir `@capacitor/core @capacitor/cli @capacitor/android`, `npx cap add android`, orientación `sensorLandscape` en `AndroidManifest.xml`.
- [ ] **Step 2:** Pantalla de login simple (usuario/contraseña) contra `POST /api/auth/login`; guardar `data.token` en memoria; peticiones con `Authorization: Bearer`.
- [ ] **Step 3:** Tres pantallas con datos reales y el estilo del spec: plano de mesas (`GET /api/tables/plan/:branchId`), pedido POS con cuadrícula de productos del menú real y ticket con 40 líneas simuladas (lista virtualizada), KDS con 12 tarjetas.
- [ ] **Step 4:** `npm run build && npx cap sync android`, generar APK debug e instalar en la tablet real.
- [ ] **Step 5:** Medir y anotar en `docs/superpowers/plans/fase-0-resultados.md`: modelo, Android, RAM, versión de WebView, arranque en frío, abrir pedido, latencia de toque, scroll del ticket (fps aprox.), tamaño JS gzip.
- [ ] **Step 6:** Decisión con el usuario: **cumple** → seguir con Fase 1; **no cumple** → ajustar (menos efectos, Android System WebView actualizado) o revisar enfoque.

---

## FASE 1 — Base

### Task 1: Esquema — dispositivos operativos y PIN **[CRÍTICA]**

**Files:**
- Modify: `server/prisma/schema.prisma` (model `User`, nuevos `OperationalDevice` y enums)
- Create: `server/prisma/migrations/20261120_operational_devices_pin/migration.sql`, `rollback.sql`
- Test: `server/src/tests/unit/operational-device-schema.test.ts`

**Interfaces:**
- Produces: `enum OperationalDeviceType { SERVICE_TABLET KITCHEN_TABLET }`, `enum OperationalDeviceStatus { ACTIVE REVOKED }`; `model OperationalDevice { id Int @id, companyId Int, branchId Int, type OperationalDeviceType, name String @db.VarChar(100), tokenHash String @unique @db.VarChar(64), status OperationalDeviceStatus @default(ACTIVE), kitchenUserId Int?, createdById Int, revokedById Int?, revokedAt DateTime?, lastSeenAt DateTime?, createdAt, updatedAt }` con `@@index([companyId, branchId, status])`; `User.pinHash String?`, `User.pinUpdatedAt DateTime?`. Permiso nuevo `devices.manage` asignado a SUPERADMIN y ADMIN (patrón `INSERT IGNORE` de `20260714_add_kds_release_notifications`).

- [ ] **Step 1: Test que falla** — `operational-device-schema.test.ts`: `it('exposes OperationalDevice enums and User pin fields')` comprobando `Prisma.OperationalDeviceType.KITCHEN_TABLET === 'KITCHEN_TABLET'`, `Prisma.OperationalDeviceStatus.REVOKED === 'REVOKED'` y que `Prisma.UserScalarFieldEnum.pinHash === 'pinHash'`.
- [ ] **Step 2:** `cd server && npx jest src/tests/unit/operational-device-schema.test.ts` → FAIL (propiedad indefinida).
- [ ] **Step 3:** Editar schema, escribir `migration.sql` (CREATE TABLE, ALTER User ADD `pinHash` VARCHAR(100) NULL, `pinUpdatedAt` DATETIME(3) NULL, INSERT permiso) y `rollback.sql` inverso; `npx prisma generate`.
- [ ] **Step 4:** Test → PASS; `npm run db:rehearse-migrations` → sin errores.
- [ ] **Step 5:** Commit `feat(mobile-api): operational devices and user PIN schema`.

### Task 2: Servicio y rutas de dispositivos operativos **[CRÍTICA]**

**Files:**
- Create: `server/src/services/operational-device.service.ts`, `server/src/routes/operational-device.routes.ts`
- Modify: `server/src/routes/v1.router.ts` (montar en `/operational-devices`), `server/src/services/session.service.ts`
- Test: `server/src/tests/unit/operational-device.service.test.ts`

**Interfaces:**
- Consumes: modelo de Task 1.
- Produces:
  - `OperationalDeviceService.register(actor: {userId:number; companyId:number}, input: {branchId:number; type:OperationalDeviceType; name:string; kitchenUserId?:number}): Promise<{device: OperationalDevice; deviceToken: string}>` — token = 32 bytes aleatorios base64url; se guarda `sha256` hex. `KITCHEN_TABLET` exige `kitchenUserId` de un usuario ACTIVE con rol COCINA de la misma compañía.
  - `OperationalDeviceService.resolveActive(deviceToken: string): Promise<OperationalDevice | null>` — actualiza `lastSeenAt`.
  - `OperationalDeviceService.revoke(actor, deviceId: number): Promise<void>` — marca REVOKED y llama `SessionService.revokeByDevice(deviceSessionTag(deviceId))`.
  - `deviceSessionTag(deviceId: number): string` → `` `op-device:${deviceId}` ``.
  - `SessionService.revokeByDevice(tag: string): Promise<number>` — revoca `UserSession` con `device === tag`.
  - Rutas (todas `requirePermission('devices.manage')`, ámbito de compañía): `POST /api/operational-devices`, `GET /api/operational-devices?branchId=`, `POST /api/operational-devices/:id/revoke`.

- [ ] **Step 1: Tests que fallan** (prisma espiado como en `auth-login-hardening.test.ts`):
  - `register returns a token whose sha256 is persisted, never the raw token`
  - `register rejects KITCHEN_TABLET without an active COCINA kitchenUserId`
  - `resolveActive returns null for unknown or REVOKED tokens`
  - `revoke revokes every session tagged op-device:<id>` (espera `userSession.updateMany` con `where: { device: 'op-device:7', revoked: false }`)
- [ ] **Step 2:** `npx jest src/tests/unit/operational-device.service.test.ts` → FAIL.
- [ ] **Step 3:** Implementar servicio, `revokeByDevice` y rutas; registrar en `AuditLogService` (`OPERATIONAL_DEVICE_REGISTERED`, `OPERATIONAL_DEVICE_REVOKED`).
- [ ] **Step 4:** Tests → PASS; `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(mobile-api): operational device registry`.

### Task 3: PIN — gestión y login en tablet de servicio **[CRÍTICA]**

**Files:**
- Create: `server/src/services/pin.service.ts`
- Modify: `server/src/services/auth.service.ts` (extraer emisión de sesión), `server/src/controllers/auth.controller.ts`, `server/src/routes/auth.routes.ts`
- Test: `server/src/tests/unit/pin.service.test.ts`, `server/src/tests/unit/auth-pin-login.test.ts`

**Interfaces:**
- Consumes: `OperationalDeviceService.resolveActive`, `deviceSessionTag` (Task 2); `loginAttemptService` existente.
- Produces:
  - `PIN_ROLES = ['MESERO','CAJERO','HOST','BODEGA','CHEF']` en `server/src/constants/roles.ts`.
  - `PinService.validateFormat(pin: string): void` — lanza si no cumple `/^\d{4,6}$/`, si todos los dígitos son iguales, o si es secuencia ascendente/descendente (`1234`, `987654`).
  - `PinService.setPin(userId: number, pin: string): Promise<void>` — bcrypt; rechaza si el usuario no tiene un rol de `PIN_ROLES`.
  - `AuthService.issueSession(user: LoginUserRecord, opts: {ip?:string; userAgent?:string; idleTimeoutMinutes:number; deviceTag?:string; auditAction:'LOGIN'|'PIN_LOGIN'|'DEVICE_LOGIN'}): Promise<LoginResult>` — lo que hoy hace el final de `login()` (JWT, `SessionService.create`, auditoría, forma de respuesta idéntica). `login()` pasa a usarlo sin cambiar su comportamiento.
  - `SessionService.create` acepta `device?: string` para guardar el tag.
  - `AuthService.pinLogin(input: {deviceToken:string; userId:number; pin:string; ip?:string; userAgent?:string}): Promise<LoginResult>` — dispositivo `ACTIVE` y `SERVICE_TABLET`; usuario `ACTIVE`, de la misma compañía y con acceso a `device.branchId` (`branchId` o `UserBranch`), rol en `PIN_ROLES`, `pinHash` presente y válido. Lockout: `loginAttemptService` con `ipKey = \`device:${device.id}\`` (5 fallos por usuario) y contador por dispositivo (20 fallos / 15 min). `idleTimeoutMinutes: 15`, `deviceTag: deviceSessionTag(device.id)`. Cualquier fallo → `Error('Credenciales inválidas')`.
  - `AuthService.deviceRoster(deviceToken: string): Promise<Array<{id:number; name:string; initials:string; color:string|null}>>` — usuarios ACTIVE de la sucursal con rol en `PIN_ROLES` y `pinHash` no nulo.
  - Rutas: `PUT /api/auth/me/pin` (auth, body `{pin}`), `GET /api/auth/device-roster` (header `X-Device-Token`), `POST /api/auth/pin-login` (header `X-Device-Token`, body `{userId, pin}`; exento de CSRF como `/auth/login`).

- [ ] **Step 1: Tests que fallan**
  - `pin.service.test.ts`: `rejects 1111, 1234, 987654, 12a4, 123`; `accepts 2580 and 739164`; `setPin rejects an ADMIN user`.
  - `auth-pin-login.test.ts`: `issues a session tagged op-device:<id> with idle timeout 15`; `rejects KITCHEN_TABLET devices`; `rejects a user from another branch with the generic message`; `rejects INACTIVE users`; `locks after 5 wrong PINs for the same user without revealing the lock`; `rejects ADMIN even with a valid pinHash`; `login() still returns the same payload shape after the issueSession refactor` (snapshot de claves de `data`).
- [ ] **Step 2:** `npx jest src/tests/unit/pin.service.test.ts src/tests/unit/auth-pin-login.test.ts` → FAIL.
- [ ] **Step 3:** Implementar; añadir `/auth/pin-login` a `isCsrfExemptPath` en `middlewares/csrf.ts`.
- [ ] **Step 4:** Tests nuevos y `npx jest src/tests/unit/auth-` → PASS (no rompe los existentes).
- [ ] **Step 5:** Commit `feat(mobile-api): PIN login for shared service tablets`.

### Task 4: Login de tablet de cocina **[CRÍTICA]**

**Files:**
- Modify: `server/src/services/auth.service.ts`, `server/src/controllers/auth.controller.ts`, `server/src/routes/auth.routes.ts`, `server/src/middlewares/csrf.ts`
- Test: `server/src/tests/unit/auth-device-login.test.ts`

**Interfaces:**
- Consumes: `issueSession` (Task 3), `resolveActive`, `deviceSessionTag` (Task 2).
- Produces: `AuthService.deviceLogin(input: {deviceToken:string; ip?:string; userAgent?:string}): Promise<LoginResult>` — dispositivo `ACTIVE` y `KITCHEN_TABLET`; emite sesión de `kitchenUserId` con `idleTimeoutMinutes: 24 * 60`, tag del dispositivo, auditoría `DEVICE_LOGIN`. Ruta `POST /api/auth/device-login` (header `X-Device-Token`, sin body, exenta de CSRF).

- [ ] **Step 1: Tests que fallan:** `issues a session for the kitchen user with 1440 idle minutes`; `rejects SERVICE_TABLET devices`; `rejects when the kitchen user is INACTIVE`; `rejects revoked devices with the generic message`.
- [ ] **Step 2:** `npx jest src/tests/unit/auth-device-login.test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(mobile-api): kitchen tablet device login`.

### Task 5: WebSocket con autenticación por mensaje y orígenes Capacitor **[CRÍTICA]**

**Files:**
- Modify: `server/src/services/websocket.service.ts`, `server/.env.example` (documentar `CLIENT_URL=...,https://localhost,capacitor://localhost`)
- Test: `server/src/tests/unit/websocket-token-auth.test.ts`

**Interfaces:**
- Produces: protocolo de cliente — si la conexión no trae cookie, el servidor espera `{"type":"AUTH","payload":{"token":"<jwt>"}}` durante **5 000 ms**; éxito → responde `CONNECTED`; fallo o tiempo agotado → `close(4001)`. Cualquier otro mensaje antes de autenticar → `close(4001)`. `WebSocketService.AUTH_TIMEOUT_MS = 5000`.

- [ ] **Step 1: Tests que fallan:** `authenticates a cookieless client that sends AUTH with a valid session token`; `closes with 4001 when AUTH is not received within 5000 ms` (timers falsos de Jest); `closes with 4001 when AUTH carries a revoked session`; `does not deliver broadcasts to unauthenticated clients`; `isOriginAllowed accepts capacitor://localhost when listed`.
- [ ] **Step 2:** `npx jest src/tests/unit/websocket-token-auth.test.ts` → FAIL.
- [ ] **Step 3:** En `connection`: si no hay cookie, programar `client.authTimeout`; en `handleMessage`, aceptar `AUTH` cuando `!client.authenticated` reutilizando `authenticateClient`, y enviar `CONNECTED` tras éxito (mover el registro del cliente y el `CONNECTED` a después de autenticar).
- [ ] **Step 4:** → PASS; `npx jest src/tests/unit/websocket` completo verde.
- [ ] **Step 5:** Commit `feat(mobile-api): token auth message for websocket clients`.

### Task 6: Esqueleto `mobile/` con tema oscuro y alias `@web`

**Files:**
- Create: `mobile/package.json`, `mobile/vite.config.ts`, `mobile/tsconfig.json`, `mobile/capacitor.config.ts`, `mobile/index.html`, `mobile/src/main.tsx`, `mobile/src/App.tsx`, `mobile/src/theme/tokens.css`, `mobile/src/test/setup.ts`, `mobile/android/` (generado)
- Test: `mobile/src/theme/tokens.test.ts`, `mobile/src/shared.test.ts`

**Interfaces:**
- Produces: alias `@web/*` → `../client/src/*` **solo para módulos puros** (utils, types, offlinePolicy; nunca componentes ni `services/api.ts`); tokens CSS `--bg #0E0F10`, `--surface #151618`, `--surface-2 #1C1D20`, `--border #26272A`, `--text #E8E8E6`, `--muted #8C8D90`, `--ready #D4A84B`, `--alert #C96B66`; `appId: 'com.miapitza.ops'`, `appName: 'Mia Pitza Ops'`; `minSdkVersion 28`.

- [ ] **Step 1: Tests que fallan:** `shared.test.ts`: `formatCurrency(1580, { symbol: 'C$' })` importado de `@web/utils/currency` contiene `1,580`; `tokens.test.ts`: lee `tokens.css` y verifica `--bg: #0E0F10` y `--ready: #D4A84B`.
- [ ] **Step 2:** `cd mobile && npx vitest run` → FAIL.
- [ ] **Step 3:** Crear proyecto (React 18, Vite, Vitest + jsdom + @testing-library/react, Capacitor 6 Android), alias en Vite y TS, importar `tokens.css` en `main.tsx`; `npx cap add android`; en `variables.gradle` `minSdkVersion = 28`.
- [ ] **Step 4:** `npx vitest run` → PASS; `npm run build` OK; `npx cap sync android` OK.
- [ ] **Step 5:** Commit `feat(mobile): scaffold capacitor app with dark tokens`.

### Task 7: Sesión segura, cliente HTTP y tiempo real **[CRÍTICA]**

**Files:**
- Create: `mobile/src/core/session.ts`, `mobile/src/core/http.ts`, `mobile/src/core/realtime.ts`, `mobile/src/core/events.ts`
- Test: `mobile/src/core/http.test.ts`, `mobile/src/core/realtime.test.ts`

**Interfaces:**
- Produces:
  - `type Session = { token: string; user: LoginUser; issuedAt: number }` (`LoginUser` = forma `data.user` de `/auth/login`).
  - `interface SecureStore { get(key:string): Promise<string|null>; set(key:string, value:string): Promise<void>; remove(key:string): Promise<void> }` con implementación nativa (plugin de almacenamiento seguro, elección del implementador) y `memoryStore()` para tests.
  - `createSessionStore(store: SecureStore): { load(): Promise<Session|null>; save(s: Session): Promise<void>; clear(): Promise<void>; deviceToken(): Promise<string|null>; saveDeviceToken(t: string): Promise<void> }` — claves `session`, `deviceToken`.
  - `createHttp(opts: { baseURL: string; sessions: ReturnType<typeof createSessionStore> }): AxiosInstance` — añade `Authorization: Bearer` y `X-Device-Token` si existen; en 401 llama `sessions.clear()` y `appEvents.emit('session-expired')`, **sin** tocar otros datos locales.
  - `appEvents: { on(e: AppEvent, fn): () => void; emit(e: AppEvent, payload?): void }`, `type AppEvent = 'session-expired' | 'realtime-status'`.
  - `createRealtime(opts: { url: string; getToken: () => Promise<string|null> }): { connect(): void; close(): void; subscribe(type: string, fn: (payload: unknown) => void): () => void }` — envía `AUTH` al abrir; reconexión con backoff 1 s→30 s; emite `realtime-status` (`'online'|'offline'`).

- [ ] **Step 1: Tests que fallan:** `http adds Bearer and X-Device-Token`; `401 clears only the session and emits session-expired` (el `deviceToken` sigue guardado); `realtime sends AUTH first`; `realtime reconnects with growing backoff capped at 30000 ms` (timers falsos, WebSocket simulado).
- [ ] **Step 2:** `npx vitest run src/core` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(mobile): secure session, http client and realtime`.

### Task 8: Configuración de dispositivo, PIN y bloqueo automático **[CRÍTICA]**

**Files:**
- Create: `mobile/src/features/device/DeviceSetupScreen.tsx`, `mobile/src/features/device/deviceApi.ts`, `mobile/src/features/pin/PinScreen.tsx`, `mobile/src/features/pin/pinApi.ts`, `mobile/src/core/useIdleLock.ts`
- Test: `mobile/src/features/pin/PinScreen.test.tsx`, `mobile/src/core/useIdleLock.test.ts`, `mobile/src/features/device/DeviceSetupScreen.test.tsx`

**Interfaces:**
- Consumes: `createHttp`, `createSessionStore`, `appEvents` (Task 7); rutas de Tasks 2–4.
- Produces:
  - `deviceApi.register(input: {branchId:number; type:'SERVICE_TABLET'|'KITCHEN_TABLET'|'PERSONAL'; name:string; kitchenUserId?:number}): Promise<{deviceType; deviceToken?}>` — `PERSONAL` no llama al servidor, solo guarda el tipo.
  - `pinApi.roster(): Promise<RosterUser[]>`, `pinApi.login(userId:number, pin:string): Promise<Session>`, `pinApi.logout(): Promise<void>` (revoca vía `POST /auth/logout`).
  - `useIdleLock(onLock: () => void, ms = 120_000): void` — reinicia en `pointerdown`/`keydown`.
  - Pantalla de PIN según el mockup: avatares a la izquierda, teclado a la derecha, horizontal.
  - "Cambiar usuario" y bloqueo: `pinApi.logout()` → vuelve a `PinScreen`.

- [ ] **Step 1: Tests que fallan:** `PinScreen submits after the 4th digit and shows the generic error on failure`; `PinScreen lists roster users as initials avatars`; `useIdleLock fires after 120000 ms without input and resets on pointerdown`; `DeviceSetupScreen requires an admin password login (with 2FA field when requested) before registering`.
- [ ] **Step 2:** `npx vitest run src/features src/core/useIdleLock.test.ts` → FAIL.
- [ ] **Step 3:** Implementar. El envío ocurre al 4.º dígito solo si el usuario tiene PIN de 4; para 5–6 hay botón "Entrar". Decisión del implementador: obtener la longitud desde el roster (`pinLength`) o usar botón siempre; documentar la elección en el commit.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(mobile): device setup, PIN login and idle lock`.

### Task 9: Selección de modo, permisos y orientación

**Files:**
- Create: `mobile/src/core/mode.ts`, `mobile/src/core/permissions.ts`, `mobile/src/app/Router.tsx`, `mobile/src/features/account/LoginScreen.tsx` (usuario/contraseña + 2FA para "Personal"), placeholders `WaiterHome.tsx`, `KitchenHome.tsx`, `AccountHome.tsx`
- Modify: `mobile/src/App.tsx`
- Test: `mobile/src/core/mode.test.ts`, `mobile/src/core/permissions.test.ts`

**Interfaces:**
- Produces:
  - `resolveMode(deviceType: 'SERVICE_TABLET'|'KITCHEN_TABLET'|'PERSONAL'|null): 'setup'|'waiter'|'kitchen'|'account'`.
  - `can(user: LoginUser, permission: string): boolean`; `canAny(user, permissions: string[]): boolean`.
  - Orientación: `waiter` y `kitchen` → horizontal bloqueado; `account` → vertical (plugin de orientación de pantalla).
  - Cocina: al arrancar con `KITCHEN_TABLET` llama `POST /auth/device-login` automáticamente.

- [ ] **Step 1: Tests que fallan:** `null device → setup`; `KITCHEN_TABLET → kitchen`; `PERSONAL → account`; `can() is false for a permission not in user.permissions`; `canAny(['payments.process','bills.split'])`.
- [ ] **Step 2:** `npx vitest run src/core/mode.test.ts src/core/permissions.test.ts` → FAIL.
- [ ] **Step 3:** Implementar y conectar `Router`.
- [ ] **Step 4:** → PASS; `npm run build`; `npx cap run android` en la tablet: (a) tablet de servicio → PIN → `WaiterHome`; (b) tablet de cocina → entra sola a `KitchenHome`; (c) celular → login → `AccountHome`; (d) revocar el dispositivo desde la API → la siguiente petición vuelve a PIN.
- [ ] **Step 5:** Commit `feat(mobile): mode routing by device type and permissions`.

### Gate de Fase 1

- [ ] `cd server && npm run typecheck && npm test` verde.
- [ ] `cd mobile && npx vitest run && npm run build` verde; JS inicial ≤ 250 KB gzip.
- [ ] Verificación manual (a)–(d) del Task 9 en la tablet real.
- [ ] Medir % de uso semanal consumido por las Fases 0–1 y proyectar el resto antes de escribir el plan de la Fase 2.
