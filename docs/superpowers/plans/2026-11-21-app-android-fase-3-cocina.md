# App Android — Fase 3 (Cocina / KDS en tablet fija) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The fixed kitchen tablet runs a whole shift without the web. It shows a kiosk KDS: cards per kitchen batch, Iniciar → Listo with a 5 s undo, recent ready batches, sound, automatic reconnection, and it never unpairs or drops its screen because of a transient 401.

**Architecture:**
- Server: two small hardening tasks on top of the existing KDS endpoints (`/api/orders/kitchen/*`) and `device-login`:
  - typed errors;
  - a `recent` list;
  - the batch `readyAt` in the payload;
  - a single session per device.
- App: `mobile/src/features/kitchen/`, a lazy chunk.
  - `kitchenApi` + `useKitchenQueue` (refetch on WS events) + `useReadyCommit` (deferred ready→release state machine) + board UI + a tiny native kiosk plugin.
  - The undo is device-side only (spec §7.6: there is no undo endpoint).

**Tech Stack:** Express 5 + Prisma/MySQL + Jest (server); Capacitor 6 (core 6.2.3), React 18, Vite, Vitest, axios (mobile); `@web/*` = `client/src` pure modules.

**Spec:** `docs/superpowers/specs/2026-11-19-app-android-design.md` (§7.4 Modo Cocina, §7.6, §8, §9, §9.1, §10). Inventory of what already exists, with file:line citations: `.superpowers/sdd/2026-11-21-app-android-fase-3-cocina/api-inventory.md` (read it before Tasks 1, 2 and 4).

## Global Constraints

**Platform and stack**
- Capacitor 6 only. Every new plugin must declare peer `@capacitor/core ^6`.
  - Keep-awake is `@capacitor-community/keep-awake@5.0.1`, exact.
  - Its 6.x/7.x/8.x releases require core ≥ 7 and are forbidden.
- No new migration. `UserSession.device` (indexed) and `KitchenBatch.readyAt` already exist.

**Session and kiosk**
- The kitchen account is fixed and auto-logs in.
- The session does not expire on idle and only ends when the device is revoked.
- **No idle lock in the kitchen branch:** `IdleLockBoundary`/`useIdleLock` must never wrap it.
- Kiosk: full screen, no navigation, screen always on. Use lock task when the app is device owner, otherwise system screen pinning.

**Board behavior**
- The queue unit is the kitchen batch (tanda). The card key is `${orderId}:${kitchenBatchId}`; one order can show several cards.
- Card: table, waiter (`order.user.name`), elapsed minutes, products with modifiers, and notes.
- Elapsed time uses `@web/utils/kdsTiming`, with thresholds from `GET /orders/kitchen/config` (defaults warning 3, urgent 10).
- One big button per card: `PENDING` → **Iniciar**; `IN_PREPARATION`/`READY` → **Listo**.
- Listo:
  - removes the card immediately and the rest reflow;
  - shows the toast `"{mesa} lista · aviso a {mesero} · Deshacer (5 s)"`;
  - after **5 s** without undo, sends `ready` then `release`.
- **Listas recientes:** the last **10** released batches.

**Realtime, sound and errors**
- New orders arrive over WS, with a sound.
- A new KDS order must be visible **≤ 2 s** after it is sent (spec §9).
- Reconnection is automatic, with a visible indicator.
- A load or permission failure shows the error, **never an empty queue**.

**Permissions**
- The same endpoints and permissions as the web `/kds`: `kds.view` to see, `kds.manage` to act.
- Every action is guarded with `can()` from `mobile/src/core/permissions.ts`.

**Layout (§9.1)**
- Cards sit in one row of equal height, with the button fixed at each card's foot.
- Amber means ready or kitchen notes; soft red means delay.
- Dark theme tokens; landscape; designed for 1280×800 and 1024×600.

**Copy, bundle and commands**
- All user copy is in Spanish.
- Initial JS ≤ 250 KB gzip. The kitchen screen is a lazy chunk.
- Commands:
  - server: `cd server && npx jest --config jest.unit.config.cjs <path>` (never bare `npx jest`); tests must be hermetic (no live DB).
  - mobile: `cd mobile && npx vitest run <path>` and `npx tsc --noEmit`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/app-android`, local only.

## Review Focus

1. **Network drop during the 5 s window or between `ready` and `release`.** The action must land exactly once, eventually. The card must not flicker back and disappear again, and a retry must not fail as an error because the first attempt already succeeded (409 "ya fue liberada" counts as success). Covered by Task 5 tests `retries after network error with the same keys` and `treats already-released as success`.
2. **The 8 h session ends mid-shift (WS 4001 / HTTP 401).** The board must stay mounted with its cards and pending commits. It shows "Reconectando…", re-logs in, and then retries the pending commits. It never unpairs. Covered by Task 3 `keeps KitchenHome mounted while the session is renewed` and Task 5 `resumes pending commits after the session returns`.
3. **A new order arriving on an empty queue, or at the same moment another batch leaves.** It must still beep: the web count rule misses both cases. Covered by Task 4 `reports new keys even when the count does not grow` and `reports the first batch after an empty queue`.
4. **An order with two batches (tandas).** Listo on one must hide only that card; the other stays with its own timer. Covered by Task 5 `hides only the committed batch key`.
5. **A load failure or a 403 (permission revoked while running).** It must show the error banner with Reintentar and keep the last cards, never "Sin comandas". Without `kds.manage`, the buttons are disabled with the reason. Covered by Task 4 `keeps last data on error` and Task 6 `shows error banner instead of empty state`.

---

### Task 1 [CRÍTICA]: Server — device-login typed errors and one session per device

Closes checkpoint rule "no desemparejar ante cualquier 401; evitar sesiones duplicadas" (inventory G11a/b).

**Files:**
- Modify: `server/src/services/auth.service.ts` (`deviceLogin` ~:470, `issueSession`)
- Modify: `server/src/controllers/auth.controller.ts` (`handleDeviceAuthError`, `deviceLogin` :229)
- Test: `server/src/services/__tests__/auth.device-login.test.ts` (create, or extend the existing device-login test file if one exists — grep `deviceLogin` under `__tests__`)

**Interfaces:**
- Produces:
  - `class DeviceAuthError extends Error { code: 'DEVICE_NOT_ACTIVE' | 'KITCHEN_ACCOUNT_UNAVAILABLE'; statusCode: 401 | 403 }`, exported from `auth.service.ts`.
  - HTTP mapping:
    - `DEVICE_NOT_ACTIVE` → 401 `{success:false, code:'DEVICE_NOT_ACTIVE', message:'Dispositivo no autorizado'}`.
    - `KITCHEN_ACCOUNT_UNAVAILABLE` → 403 `{success:false, code:'KITCHEN_ACCOUNT_UNAVAILABLE', message:'La cuenta de cocina no está disponible. Avisa al administrador.'}`.
  - The mobile app (Task 3) unpairs only on `DEVICE_NOT_ACTIVE`.

- [ ] **Step 1: Write failing tests** (mock prisma/OperationalDeviceService, as the existing auth tests do)
  - `device-login: unknown or revoked token → DeviceAuthError DEVICE_NOT_ACTIVE`: `resolveActive` returns null.
  - `device-login: non-kitchen device type → DEVICE_NOT_ACTIVE`.
  - `device-login: kitchen user inactive / other branch / not COCINA → KITCHEN_ACCOUNT_UNAVAILABLE`.
  - `device-login: revokes previous unrevoked sessions with the same device tag inside the issuing transaction`: assert `userSession.updateMany({where:{device: deviceSessionTag(id), revoked:false}, data:{revoked:true}})` is called on the tx before `create`.
  - `controller maps DEVICE_NOT_ACTIVE to 401 with code` and `KITCHEN_ACCOUNT_UNAVAILABLE to 403 with code`.
  - PIN-login and roster keep `GENERIC_AUTH_ERROR` (regression: existing tests stay green).
- [ ] **Step 2:** Run `cd server && npx jest --config jest.unit.config.cjs auth` → new tests FAIL.
- [ ] **Step 3: Implement.**
  - `deviceLogin` throws the typed errors.
  - `issueSession` accepts an option `revokePriorDeviceSessions?: boolean`. When it is set and a `deviceTag` exists, it runs the `updateMany` in the same transaction before creating the session. Only `deviceLogin` passes it.
  - The controller maps `DeviceAuthError` before the generic path. Rate limiting and audit stay unchanged.
- [ ] **Step 4:** Run auth tests, then the full unit suite and `npx tsc --noEmit` → PASS.
- [ ] **Step 5:** Commit `feat(auth): typed device-login errors and single session per kitchen device`.

### Task 2: Server — KDS typed errors, `recent` list, `kitchenReadyAt`, ORDER_READY guard

**Files:**
- Create: `server/src/services/kitchen-errors.ts`
- Modify: `server/src/services/order.service.ts` (`withPersistentKitchenBatch` ~:319, `findKitchenBatchForOperation` ~:394, start ~:3424, ready ~:3511, release ~:3595, history ~:3689)
- Modify: `server/src/controllers/order.controller.ts` (kitchen handlers :728–:860), `server/src/routes/order.routes.ts` (:30–:32), `server/src/middlewares/errorHandler.ts` only if `code` is not already echoed for typed errors
- Test: `server/src/services/__tests__/order.kitchen-recent.test.ts`, extend the existing kitchen batch service/controller tests

**Interfaces:**
- Produces:
  - `class KitchenError extends Error { code: KitchenErrorCode; statusCode: number }`, where `KitchenErrorCode =`:
    - `'KITCHEN_BATCH_NOT_FOUND'` (404)
    - `'KITCHEN_BATCH_RELEASED'` (409)
    - `'KITCHEN_BATCH_NOT_READY'` (409)
    - `'KITCHEN_NOTHING_PENDING'` (409)
    - `'KITCHEN_INVALID_STATE'` (409)
  - Messages stay the current Spanish texts. The body carries `code`.
  - `GET /api/orders/kitchen/recent?limit=` (permission `kds.view`, same fallback roles as `/kitchen/history`):
    - batches with status `RELEASED` and `releasedAt ≥ now − 12 h`;
    - branch-scoped via `resolveBranchScope`;
    - ordered by `releasedAt desc`;
    - `limit` default 10, clamped to 1..30;
    - same element shape as `/kitchen/queue`.
  - Every batch-shaped element gains `kitchenReadyAt: string | null` (from `KitchenBatch.readyAt`).
  - The batch `ready` handler emits `ORDER_READY` and creates the kitchen notification only when the service reports `changed: true`. This is the same guard release already has.

- [ ] **Step 1: Write failing tests:**
  - `ready on RELEASED batch throws KitchenError KITCHEN_BATCH_RELEASED (409)`.
  - `release on PENDING throws KITCHEN_BATCH_NOT_READY`.
  - `start with no pending items throws KITCHEN_NOTHING_PENDING`.
  - `unknown kitchenBatchId throws KITCHEN_BATCH_NOT_FOUND`.
  - `repeated ready does not emit ORDER_READY nor create a notification` (controller test with mocked websocket service).
  - `recent returns RELEASED batches of the last 12 h, newest first, clamped limit, branch-scoped` (assert the prisma `where`/`orderBy`/`take`).
  - `batch payload includes kitchenReadyAt`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
  - Replace the `{statusCode,message}` throws on the batch paths with `KitchenError`.
  - Item start/finish keep their 400s; they are not used by the app.
  - Add the `recentKitchenBatches(scope, limit)` service, the controller and the route. Declare the route before `/:id` routes.
- [ ] **Step 4:** Full unit suite + `tsc` → PASS. Also `cd client && npx tsc --noEmit`, since the web shares types only through the API.
- [ ] **Step 5:** Commit `feat(kds-api): typed kitchen errors, recent list, readyAt, ready event guard`.

### Task 3 [CRÍTICA]: App — resilient kitchen session (no unpair on transient 401, board stays mounted)

**Files:**
- Modify: `mobile/src/core/kitchenAuth.ts`, `mobile/src/core/kitchenAuth.test.ts`
- Modify: `mobile/src/core/realtime.ts`, `mobile/src/core/realtime.test.ts` (jitter)
- Modify: `mobile/src/app/Router.tsx` (kitchen branch :136), router test if present
- Modify: `mobile/src/features/kitchen/KitchenHome.tsx` (accept `session: Session | null`)

**Interfaces:**
- Consumes: Task 1 codes `DEVICE_NOT_ACTIVE`, `KITCHEN_ACCOUNT_UNAVAILABLE`.
- Produces:
  - `type KitchenAuthStatus = 'connecting' | 'online' | 'renewing' | 'account-unavailable' | 'offline'`, emitted via `appEvents` as `'kitchen-auth-status'`.
  - `createKitchenAuth(...)` keeps its current signature.
  - `<KitchenHome session={Session | null} services={Services} />`: always mounted in kitchen mode; it owns the board state.
  - While `session` is null, it keeps using the last non-null session for `can()` checks and shows "Reconectando…". Actions queued in that window wait, per Task 5.

- [ ] **Step 1: Write failing tests:**
  - kitchenAuth:
    - `unpairs only on 401 with code DEVICE_NOT_ACTIVE`.
    - `401 without code → backoff retry, no unpair`.
    - `403 KITCHEN_ACCOUNT_UNAVAILABLE → status account-unavailable, retries every 60 s, no unpair`.
    - `session-expired → status renewing, re-login, then online`.
  - realtime: `reconnect delay has ±20 % jitter within [800 ms, 36 s]` (mock `Math.random` to 0 and 1).
  - Router: `keeps KitchenHome mounted while the session is renewed`. Emit `session-expired`; the same KitchenHome instance remains (no unmount), receives `session=null`, and then the new session.
- [ ] **Step 2:** Run `cd mobile && npx vitest run src/core src/app` → FAIL.
- [ ] **Step 3: Implement.**
  - In kitchenAuth, read `code` from the error body via `@web/utils/apiError` (or `httpErrors.ts`).
  - In the Router kitchen branch, render `<Suspense><KitchenHome session={session} services={services} /></Suspense>` regardless of session. The `session-expired` handler still closes realtime and nulls the session.
  - Jitter is `delay * (0.8 + Math.random() * 0.4)`.
- [ ] **Step 4:** vitest + `tsc` → PASS.
- [ ] **Step 5:** Commit `feat(mobile): kitchen session survives 401s and renewals without unpairing`.

### Task 4: App — kitchen data layer (`kitchenApi`, `useKitchenQueue`)

**Files:**
- Create: `mobile/src/features/kitchen/kitchenApi.ts`, `kitchenApi.test.ts`
- Create: `mobile/src/features/kitchen/useKitchenQueue.ts`, `useKitchenQueue.test.ts`
- Create: `mobile/src/features/kitchen/kitchenTypes.ts`

**Interfaces:**
- Consumes: Task 2 endpoints and codes; `realtime.subscribe(type, fn)`; `@web/utils/kdsTiming` (`getKitchenReceivedAt`, `getKdsWaitMinutes`, `getKdsTimeClass`); `@web/utils/idempotency`; `@web/utils/orderLineVoid` (`isVoidedOrderLine`).
- Produces:
  - `KitchenBatch` type: the batch-shaped element (`id, kitchenBatchId, status, table?:{number}, user?:{id,name,color}, orderType, customerName, items[], kitchenReadyAt, kitchenReleasedAt`).
  - `batchKey(b): string` = `${b.id}:${b.kitchenBatchId}`.
  - `createKitchenApi(http)` returns:
    - `config(): Promise<{warningMinutes, urgentMinutes}>`
    - `queue(): Promise<KitchenBatch[]>`
    - `recent(limit = 10): Promise<KitchenBatch[]>`
    - `start(b, key)`, `ready(b, key)`, `release(b, key)`: each POSTs `{kitchenBatchId}` with header `X-Idempotency-Key: key`, where key is supplied by the caller.
    - It throws `KitchenActionError { kind: 'network' | 'already-done' | 'rejected' | 'auth'; code?: string; message: string }`.
      - `already-done` is for `KITCHEN_BATCH_RELEASED` on ready/release and a 200 `changed:false`.
      - `auth` is for 401.
      - Network and 5xx map to `network`.
      - Everything else is `rejected`.
  - `useKitchenQueue(api, realtime, opts?)` returns `{ batches, config, status: 'loading'|'ready'|'error', error?: string, lastLoadedAt?: number, reload(), onNewBatches(cb) }`.
    - Refetch on these WS types: `ORDER_SENT_TO_KITCHEN`, `ORDER_IN_PREPARATION`, `ORDER_READY`, `ORDER_UPDATE` (ignore `status` `ITEMS_CHANGED`/`GUESTS_CHANGED`), `CONNECTED`. Debounce 250 ms.
    - Drop stale responses (request sequence).
    - On error, keep the last batches and set `status:'error'`.
    - New-batch detection compares key sets against the previous successful load, not counts. It is skipped on the first load after mount.
    - Ordering is oldest received first.
    - Voided lines (quantity 0) are hidden; a batch with no visible lines is hidden.

- [ ] **Step 1: Write failing tests:**
  - kitchenApi:
    - `sends kitchenBatchId and idempotency header`.
    - `maps KITCHEN_BATCH_RELEASED to already-done`.
    - `maps 401 to auth, timeout to network`.
  - useKitchenQueue (fake timers, mocked api and realtime):
    - `debounces a burst of 5 events into one fetch within 250 ms`.
    - `ignores ITEMS_CHANGED`.
    - `refetches on CONNECTED`.
    - `drops a stale response`.
    - `keeps last data on error`.
    - `reports new keys even when the count does not grow` (one key replaced by another).
    - `reports the first batch after an empty queue`.
    - `does not report on the initial load`.
    - `two batches of one order are two entries`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** vitest + `tsc` → PASS.
- [ ] **Step 5:** Commit `feat(mobile): kitchen api and live queue hook`.

### Task 5 [CRÍTICA]: App — Listo with 5 s deferred undo, then ready → release

**Files:**
- Create: `mobile/src/features/kitchen/useReadyCommit.ts`, `useReadyCommit.test.ts`

**Interfaces:**
- Consumes: Task 4 `createKitchenApi` actions, `KitchenActionError`, `batchKey`; `kitchen-auth-status` events from Task 3.
- Produces: `useReadyCommit(api, opts?: {undoMs?: number})` returns:
  - `hiddenKeys: Set<string>`: keys to filter out of the board while they are pending or committing.
  - `pending: Array<{key, label, waiter, deadline}>`: these drive the toasts.
  - `markReady(b)`, `undo(key)`.
  - `committed: KitchenBatch[]`: locally released batches, merged into Recientes.
  - `failures: Array<{key, message}>`: a rejected commit whose card was restored.

**State machine per key:**
1. `markReady`: the key is hidden at once. The two idempotency keys (`ready`, `release`) are generated now and stored with the entry.
2. Within `undoMs` (default **5000**), `undo` removes it with no request sent.
3. At the deadline, `ready` then `release` run, strictly in sequence.
   - `already-done` counts as success for either step.
   - `network`: retry with backoff 2 s → 30 s, reusing the same keys, keeping the card hidden.
   - `auth`: pause until `kitchen-auth-status` is `online`, then resume with the same keys.
   - `rejected`: restore the card (unhide) and push to `failures`.
4. On success, add the entry to `committed` (max 10, newest first) and drop it from hidden after the next queue load no longer contains it.

- [ ] **Step 1: Write failing tests** (fake timers, mocked api):
  - `hides the card immediately and sends nothing before 5 s`.
  - `undo within 5 s restores the card and sends nothing`.
  - `after 5 s sends ready then release in order with stable keys`.
  - `hides only the committed batch key` (two batches of one order).
  - `retries after network error with the same keys`.
  - `treats already-released as success`.
  - `resumes pending commits after the session returns`.
  - `rejected restores the card and reports a failure`.
  - `two cards marked 1 s apart commit independently`.
  - `committed keeps the last 10`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Timers are owned by the hook. Clean them up on unmount, but in-flight commits finish; KitchenHome stays mounted per Task 3.
- [ ] **Step 4:** vitest + `tsc` → PASS.
- [ ] **Step 5:** Commit `feat(mobile): deferred ready-release commit with 5 s undo`.

### Task 6: App — KDS board UI (cards, toasts, recientes, sound, connection, errors)

**Files:**
- Modify: `mobile/src/features/kitchen/KitchenHome.tsx` (lazy-loaded from Router)
- Create in `mobile/src/features/kitchen/`:
  - `KitchenBoard.tsx`, `KitchenCard.tsx`, `ReadyToasts.tsx`, `RecentSheet.tsx`
  - `kitchenSound.ts`
  - `kitchen.css` (or the project's existing styling pattern)
- Test: `KitchenCard.test.tsx`, `KitchenBoard.test.tsx`, `kitchenSound.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5 hooks and types; `can(session, 'kds.manage')`; the `realtime-status` and `kitchen-auth-status` events.
- Produces: `playKitchenChime(): void` in `kitchenSound.ts`: a Web Audio oscillator, two 800 Hz sine beeps of 0.25 s with a 0.15 s gap. It is a no-op if `AudioContext` is unavailable, and it reuses one context.

**Layout and copy (exact):**
- **Top bar:**
  - title "Cocina";
  - clock HH:MM;
  - connection dot: "En línea" (online) / "Reconectando…" (realtime reconnecting or auth `renewing`) / "Sin conexión";
  - "Cuenta de cocina no disponible — avisa al administrador" for `account-unavailable`;
  - sound toggle (persisted in `localStorage` `kds.sound`, default on, inside try/catch);
  - button "Recientes (n)".
- **Cards:**
  - Horizontal row, equal height, horizontal scroll.
  - **Header:**
    - the table label (`M{table.number}`, or `customerName`, or `"Llevar #{id}"`);
    - waiter name;
    - minutes `"{n} min"`;
    - a batch badge `"Tanda {sequence}"` when `sequence > 1`.
  - **Delay colors:**
    - `time-warning` → soft-red border;
    - `time-urgent` → soft-red header fill.
  - **Body:**
    - lines `"{qty}× {name}"` with modifiers below;
    - line notes in amber;
    - READY batches have an amber outline.
  - **Foot button**, full width, ≥ 64 px tall:
    - "Iniciar" (PENDING) / "Listo" (IN_PREPARATION or READY);
    - while start is in flight: disabled "Iniciando…";
    - without `kds.manage`: disabled, with "Sin permiso para marcar" under it.
- **Toast** (bottom, stacked, max 3): `"{mesa} lista · aviso a {mesero}"` with a "Deshacer" button and a seconds countdown.
- **Failure toast:** `"No se pudo marcar {mesa}: {message}"`.
- **States:**
  - empty: "Sin comandas" (only when `status==='ready'` and no batches);
  - loading: "Cargando comandas…";
  - error: banner "No se pudo cargar la cola: {error}" + "Reintentar", above the last cards.
- **RecentSheet:** the last 10, merged from the server `recent()` and local `committed` and deduped by key. Each row shows table label, waiter, released time and line count. It is read-only.
- The clock tick is 30 s. The sound plays once per `onNewBatches` call when the toggle is on.

- [ ] **Step 1: Write failing tests:**
  - KitchenCard:
    - `shows table, waiter, minutes, lines, notes`.
    - `warning/urgent classes from thresholds`.
    - `Iniciar for PENDING, Listo for IN_PREPARATION and READY`.
    - `disabled with reason without kds.manage`.
  - KitchenBoard:
    - `shows error banner instead of empty state`.
    - `Listo hides card and shows undo toast with mesero`.
    - `Deshacer brings it back`.
    - `plays chime on new batches when sound on, not when off`.
    - `Recientes merges and dedupes`.
  - kitchenSound: `no-op without AudioContext`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Lazy-load `KitchenHome` in Router with `React.lazy`.
- [ ] **Step 4:** vitest + `tsc` + `npm run build` → PASS, and initial JS ≤ 250 KB gzip (report the number).
- [ ] **Step 5:** Commit `feat(mobile): kitchen KDS board with undo toasts, recents, sound and status`.

### Task 7: App — kiosk (keep screen on, lock task / screen pinning, immersive)

**Files:**
- Modify: `mobile/package.json`: add `@capacitor-community/keep-awake` at exactly `5.0.1`.
- Create: `mobile/android/app/src/main/java/<appId path>/KioskPlugin.java`. Register it in `MainActivity.java` via `registerPlugin(KioskPlugin.class)` before `super.onCreate`.
- Create: `mobile/src/core/kiosk.ts`, `kiosk.test.ts`
- Modify: `mobile/src/features/kitchen/KitchenHome.tsx`: enter the kiosk on mount and leave it on unmount or unpair.

**Interfaces:**
- Produces:
  - `enterKiosk(): Promise<void>`: keep-awake + `Kiosk.start()`.
  - `exitKiosk(): Promise<void>`.
  - Both are web no-ops and swallow and log plugin errors; they never throw to the UI.
- `KioskPlugin` methods:
  - `start()`:
    - calls `startLockTask()`;
    - device owner gets true lock task, otherwise Android shows the screen-pinning prompt;
    - also sets immersive sticky (hides the system bars) and `FLAG_KEEP_SCREEN_ON`.
  - `stop()`: calls `stopLockTask()` and clears the flags.
  - `isActive() → {active: boolean}`.
- **Exit path:** a long press of 5 s on the "Cocina" title opens a confirm "¿Salir del modo kiosco?" → `exitKiosk()`. Re-entry happens on the next app start. This is needed because the kitchen account has no PIN; with screen pinning the system gesture also exits.

- [ ] **Step 1: Write failing tests:**
  - `enterKiosk calls KeepAwake.keepAwake and Kiosk.start on native`.
  - `no-op on web`.
  - `plugin rejection is swallowed`.
  - `exitKiosk calls allowSleep and stop`.
  - `long-press 5 s on title asks to exit` (in a KitchenHome test).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement TS and Java. `npx cap sync android` is deferred to the device gate (note it in the report). Java compiles only with Android Studio, so keep it minimal and mirror Capacitor 6 plugin conventions (`@CapacitorPlugin(name = "Kiosk")`, `@PluginMethod`, UI-thread calls via `getActivity().runOnUiThread`).
- [ ] **Step 4:** vitest + `tsc` + build → PASS.
- [ ] **Step 5:** Commit `feat(mobile): kitchen kiosk mode with keep-awake and lock task`.

---

## Phase 3 gate (code part closes here; device part deferred to Android Studio)
- Server unit suite + `tsc` green; client `tsc` green; mobile vitest + `tsc` + build green, initial JS ≤ 250 KB.
- Final reviews: Opus on the backend (Tasks 1–2), Opus + Fable 5.2 on the app (Tasks 3–7); one fix wave; scoped re-review.
- **Deferred to the device:**
  - "Cocina opera un turno sin web" on the real tablet:
    - a new order is visible ≤ 2 s;
    - Listo/Deshacer;
    - Wi-Fi off then on (indicator and recovery);
    - 8 h renewal (or a forced 4001);
    - revoke the device (it must unpair) versus disable the kitchen user (it must not unpair).
  - Kiosk pinning and keep-awake.
  - Sound audible without a gesture.
  - Layout at 1280×800 and 1024×600.
  - `npx cap sync android`.
