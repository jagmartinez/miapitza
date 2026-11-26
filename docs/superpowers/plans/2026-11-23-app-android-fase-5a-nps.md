# App Android — Fase 5a: Encuesta NPS del cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** after payment the waiter hands the service tablet to the customer for a locked, < 30 s survey. Answers are stored once per order. Admins see NPS reports on the web, and each waiter sees their own monthly score in Mi cuenta.

**Architecture:**
- **Server:** a new `/api/v1/surveys` module with three parts.
  - Submit endpoint for the PIN session of a SERVICE_TABLET. The device is derived from the session tag, so `http.ts` is unchanged.
  - Reports gated by the new permission `surveys.view`.
  - A self endpoint that needs authentication only.
- **Mobile:** a `survey` route in `WaiterHome`, launched from `PaymentDone`. It blocks Back and ends with the existing `onSwitchUser` lock and revoke.
- **Web:** one report page.

**Tech Stack:** Express + Prisma + MySQL (server), React 18 + Capacitor 6 (mobile), React + recharts (client).

**Spec:** `docs/superpowers/specs/2026-11-19-app-android-design.md` §7.3.3 (plus §7.5 for Mi cuenta, §9.1 for the visual language). Inventory with file:line citations: `.superpowers/sdd/2026-11-23-app-android-fase-5a-nps/api-inventory.md`. Read the relevant section before each task.

## Global Constraints

**Data and server**
- One `SurveyResponse` per order (`orderId @unique`). The submit is idempotent:
  - a repeat with the same order returns the stored row with 200 and `created:false`, and never 409;
  - a new row returns 201 with `created:true`.
- Field ranges:
  - `nps` is required, integer 0–10;
  - `waiterRating`, `serviceRating` and `foodRating` are each nullable, integer 1–5;
  - `comment` is optional, ≤ 500 chars, trimmed, empty becomes null;
  - `contactPhone` is optional, ≤ 30 chars, matching `^[0-9+()\-\s]{6,30}$`, and is stored only if typed.
- `waiterUserId = order.userId`, never `req.user.userId`, because a cashier may be logged in at payment.
- NPS = round(%promoters(9–10) − %detractors(0–6)), an integer from −100 to 100. It is `null` when there are 0 responses.
- New permission `surveys.view` for SUPERADMIN and ADMIN. MESERO and CAJERO do not get it.
- The waiter's self endpoint returns only `{ month, responses, attentionAvg, nps }`. When `responses < 3`, both `attentionAvg` and `nps` are `null`, because a score from 1 or 2 answers identifies the customer. It never returns comments or phones.
- Migration `20261123_customer_survey` (migration.sql + rollback.sql). Never edit an existing migration (checksum ledger).

**Mobile survey**
- **Layout:** landscape, large type (question ≥ 28 px, NPS keys ≥ 64 dp, stars ≥ 56 dp), dark tokens.
- **Locked mode:** while the survey is open, hardware Back is swallowed, there is no header navigation and no exit button. It ends only on finish or after 60 s idle.
- **Ending:**
  - "¡Gracias por tu opinión!" shows for 5 s, then `onSwitchUser()`, which locks and revokes and returns to the PIN screen.
  - 60 s without touch: if an NPS was chosen, submit what was answered and then lock; otherwise lock without submitting.
- The submit is sent before the lock, while the session token still exists. On an ambiguous or network failure it is queued through the existing offline queue (`GENERIC_MUTATION`, stable `X-Idempotency-Key` per order) and never blocks the customer. The thanks screen always shows.
- **Copy (Spanish, exact):**
  - "¿Qué tan probable es que nos recomiendes a un amigo?"
  - "Atención de {nombre}"
  - "Servicio en general"
  - "Comida"
  - "Comentario (opcional)"
  - "Teléfono (opcional, si quieres que te contactemos)"
  - "Enviar"
  - "¡Gracias por tu opinión!"
  - NPS key labels "0"…"10", with legend "Nada probable" / "Muy probable".
- The "Pedir opinión" button on `PaymentDone` is secondary (outlined). "Liberar mesa y volver" stays the primary.
- New dependency allowed: `@capacitor/app`, major 6, pinned to an exact version. It is used for the `backButton` listener. No other new plugin.

**Web report**
- Follows the RH layout rules: no nested cards, standalone table, box-less filters, KPI cards only with decision-relevant info.

**Commands and limits**
- Server tests: `cd server && npx jest --config jest.unit.config.cjs` (never bare `npx jest`).
- Mobile: `cd mobile && npx vitest run`, `npx tsc --noEmit`, `npm run build`. Initial JS ≤ 250 KB gzip; the survey screen is a lazy chunk.
- Client: `cd client && npx tsc --noEmit` and the client's vitest for touched contract tests.

## Review Focus

1. **The network drops when the customer taps Enviar.** The customer still sees thanks and the tablet locks. The answer is queued under the waiter's owner key with the same idempotency key, and is replayed exactly once when that waiter logs in again. Test: Task 3 `network failure queues and still thanks`.
2. **The same order gets surveyed twice** (the waiter reopens payment, or a queued replay runs after an online success). The server keeps the first answer and answers 200 `created:false`. Test: Task 1 `second submit for same order returns existing`.
3. **The customer walks away mid-survey.** After 60 s idle the tablet locks. A survey with an NPS is saved, one without is not. The 120 s IdleLockBoundary never fires first. Test: Task 3 `idle 60s with nps submits partial then locks`, `idle without nps locks without submit`.
4. **Hardware Back or a swipe during the survey** neither returns to the waiter's order screen nor exposes the waiter session. Test: Task 3 `back button is swallowed while survey open`.
5. **A cashier collects the payment.** The survey shows "Atención de {waiter who opened the order}" and the server attributes it to `order.userId`. Test: Task 1 `waiterUserId is order creator not session user`, Task 3 `shows order waiter name`.

---

### Task 1: Server — model, permission, submit endpoint

**Files:**
- Modify: `server/prisma/schema.prisma` (model `SurveyResponse` plus back-relations in Company, Branch, Order, User (relation name `"SurveyWaiter"`) and OperationalDevice)
- Create: `server/prisma/migrations/20261123_customer_survey/migration.sql`, `rollback.sql`
- Modify: `server/prisma/seed.ts`, `server/src/services/company-provisioning.service.ts` (add `surveys.view` to ADMIN; SUPERADMIN gets all)
- Create: `server/src/services/survey.service.ts`, `server/src/services/survey-errors.ts`, `server/src/utils/nps.ts`, `server/src/routes/survey.routes.ts` (mounted at `v1.use('/surveys', surveyRoutes)` in `routes/v1.router.ts`)
- Test: `server/src/tests/unit/survey-schema.test.ts` (contract, fs-based like `waiter-mode-schema.test.ts`), `server/src/tests/unit/survey-submit.test.ts`, `server/src/tests/unit/nps.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/v1/surveys` with body `{ orderId:int, nps:int, waiterRating?:int|null, serviceRating?:int|null, foodRating?:int|null, comment?:string|null, contactPhone?:string|null }` returns `{ success, data: { id, orderId, created: boolean } }`.
  - `npsSummary(scores: number[]): { responses, promoters, passives, detractors, nps: number|null }` in `utils/nps.ts`.
  - `SurveyError(code)` with codes `SURVEY_DEVICE_REQUIRED` 403, `SURVEY_ORDER_NOT_FOUND` 404, `SURVEY_ORDER_NOT_PAID` 409, `SURVEY_INVALID` 400.
- Model: `SurveyResponse { id, companyId, branchId, orderId @unique, waiterUserId, operationalDeviceId, nps Int, waiterRating Int?, serviceRating Int?, foodRating Int?, comment String? @db.VarChar(500), contactPhone String? @db.VarChar(30), createdAt }` with `@@index([companyId, branchId, createdAt])` and `@@index([waiterUserId, createdAt])`. All FKs are Restrict.

- [ ] **Step 1: Write failing tests**
  - `nps.test.ts`: `[]` → `nps:null`; `[10,9,8,7,6,0]` → promoters 2, passives 2, detractors 2, nps 0; `[10,10,10]` → 100; `[0]` → −100; `[9,9,6]` → 33.
  - `survey-schema.test.ts`:
    - the migration creates `SurveyResponse` with a unique `orderId` and inserts `surveys.view` for SUPERADMIN/ADMIN;
    - rollback drops both;
    - seed and provisioning contain `surveys.view` in the ADMIN map;
    - the routes file contains `requirePermission('surveys.view', 'SUPERADMIN', 'ADMIN')` (on the Task 2 routes; here assert only the submit route has no `requirePermission`).
  - `survey-submit.test.ts` (Prisma spied):
    - `creates response attributed to order creator` → 201, `created:true`, `waiterUserId === order.userId` while `req.user.userId` is a cashier;
    - `second submit for same order returns existing` → 200 `created:false` with the existing id. Cover both the `findUnique` path and the P2002 race path;
    - `rejects non-device session` → a session tag not `op-device:` gives 403 `SURVEY_DEVICE_REQUIRED`. The same holds for a device that is not ACTIVE, not SERVICE_TABLET, from another company, or whose branch differs from `order.branchId`;
    - `rejects unpaid order` → 409 `SURVEY_ORDER_NOT_PAID` when `financialStatus !== 'PAID'`;
    - `order of other company` → 404;
    - `validates ranges`: nps 11, rating 0, a comment of 501 chars and phone `abc` each give 400;
    - `empty comment and phone stored as null`.
- [ ] **Step 2: Run** `cd server && npx jest --config jest.unit.config.cjs survey nps` and confirm FAIL.
- [ ] **Step 3: Implement.**
  - Derive the device from `SessionService.deviceOf(extractAuthToken(req))`, which gives `op-device:<id>`, then load it, and validate it like `resolveDevice()` in `discount-authorization.service.ts:226-233`.
  - Load the order scoped by `companyId`, then `assertBranchAccess`.
  - Validate with `validate()`, then cast numbers by hand.
  - Write the migration SQL by hand, following `20261121_waiter_mode/migration.sql` (utf8mb4, `ON DELETE RESTRICT`), then `npx prisma generate`.
- [ ] **Step 4: Run** the same command and confirm PASS. Then run the full server suite and `npx tsc --noEmit`, both green.
- [ ] **Step 5: Commit** `feat(server): customer survey model, surveys.view permission and submit endpoint`.

### Task 2: Server — reports and waiter self endpoint

**Files:**
- Modify: `server/src/routes/survey.routes.ts`, `server/src/services/survey.service.ts`
- Test: `server/src/tests/unit/survey-report.test.ts`

**Interfaces:**
- Consumes: `npsSummary` (Task 1).
- Produces (all `requirePermission('surveys.view','SUPERADMIN','ADMIN')` except `/me`; dates via `validateQueryDates` and `parseQueryDateFrom/To(…, user.timezone)`; branch via `resolveBranchScope`):
  - `GET /api/v1/surveys/summary?dateFrom&dateTo&branchId?` returns `{ responses, promoters, passives, detractors, nps, avgWaiter, avgService, avgFood, byWaiter: [{ userId, name, responses, nps, avgWaiter }], byBranch: [{ branchId, name, responses, nps }] }`.
    - Each average is rounded to 1 decimal and is null when there is no rating.
    - `byWaiter` is sorted by responses desc.
  - `GET /api/v1/surveys/responses?dateFrom&dateTo&branchId?&waiterUserId?&detractorsOnly?&page&pageSize(≤100)` returns `{ items: [{ id, createdAt, branchName, waiterName, orderId, nps, waiterRating, serviceRating, foodRating, comment, contactPhone }], total, page, pageSize }`, newest first.
  - `GET /api/v1/surveys/me?month=YYYY-MM` (authMiddleware only; default is the current month in `user.timezone`) returns `{ month, responses, attentionAvg, nps }`, filtered by `waiterUserId = req.user.userId`. Below 3 responses, both `attentionAvg` and `nps` are null.

- [ ] **Step 1: Write failing tests.**
  - `summary computes nps and averages per waiter and branch`;
  - `summary scoped to company and pinned branch for non-admin`: a company-wide admin passing another company's branch still gets only its own company;
  - `responses detractorsOnly filters nps<=6 and paginates`;
  - `me masks below 3 responses`: 2 responses give `nps:null, attentionAvg:null, responses:2`; 3 responses give values;
  - `me never returns comments`: assert the exact key set;
  - `me month boundaries use user timezone`;
  - the contract test from Task 1 now also finds the permission literal on summary/responses.
- [ ] **Step 2: Run** `npx jest --config jest.unit.config.cjs survey-report` and confirm FAIL.
- [ ] **Step 3: Implement.** Aggregate in SQL (`groupBy`) or in memory over the date window, whichever is clear. Reuse `npsSummary` for each group.
- [ ] **Step 4: Run** the full server suite and `tsc`, both green.
- [ ] **Step 5: Commit** `feat(server): survey reports and waiter monthly score`.

### Task 3 [CRÍTICA]: Mobile — locked survey on the service tablet

**Files:**
- Modify: `mobile/package.json` (add `@capacitor/app` exact 6.x), `mobile/src/features/waiter/payment/PaymentDone.tsx` (secondary "Pedir opinión", new prop `onSurvey?: () => void`), `PaymentScreen.tsx`, `OrderScreen.tsx`, `WaiterHome.tsx` (route `{ name:'survey', orderId:number, waiterName:string }`)
- Create: `mobile/src/features/survey/SurveyScreen.tsx`, `survey.css`, `surveyApi.ts`, `useBackBlock.ts`, `mobile/src/features/survey/survey.test.tsx`
- Modify: `mobile/src/data/queueLabels.ts` (label "Encuesta del cliente")

**Interfaces:**
- Consumes: `POST /v1/surveys` (Task 1); `waiterApi.mutate(spec)` with `queue: { operationType: 'GENERIC_MUTATION' }`; `onSwitchUser` from `WaiterHome` props; `useIdleLock(onLock, ms)`.
- Produces:
  - `SurveyScreen({ orderId, waiterName, submit, onDone })`;
  - `useBackBlock(active: boolean)`, which registers `App.addListener('backButton', () => {})` while active and removes it on cleanup, and is a no-op on web;
  - `surveyApi.submit(input, idempotencyKey)`.

- [ ] **Step 1: Write failing tests** (vitest, `@capacitor/app` mocked):
  - `payment done shows Pedir opinión as secondary and opens survey with order waiter name`: a cashier session, with the order created by "Ana", shows "Atención de Ana";
  - `nps required before Enviar`;
  - `submits answers with stable idempotency key per order`;
  - `network failure queues and still thanks`: the queue receives a single item with the same key, and the thanks screen shows;
  - `thanks then onDone after 5s` (fake timers);
  - `idle 60s with nps submits partial then locks`;
  - `idle without nps locks without submit`;
  - `back button is swallowed while survey open`: the listener is registered on mount and removed on unmount;
  - `double tap Enviar submits once`;
  - `phone and comment trimmed; empty sent as null`.
- [ ] **Step 2: Run** `cd mobile && npx vitest run src/features/survey` and confirm FAIL.
- [ ] **Step 3: Implement.**
  - Three steps on one screen:
    - NPS keys 0–10 (selecting one advances);
    - the stars block plus comment and phone, then Enviar;
    - thanks.
  - `onDone` = `onSwitchUser`.
  - Lazy-load `SurveyScreen`.
  - Install with `npm i -E @capacitor/app@6` (exact pin).
- [ ] **Step 4: Run** full `npx vitest run`, `npx tsc --noEmit` and `npm run build`. All must be green, with initial JS ≤ 250 KB gzip.
- [ ] **Step 5: Commit** `feat(mobile): locked customer survey after payment`.

### Task 4: Mobile — "Mi servicio" in Mi cuenta

**Files:**
- Modify: `mobile/src/core/permissions.ts` (export `isWaiter(user)` = role MESERO), `mobile/src/features/account/AccountHome.tsx`, `hrApi.ts` or a new `surveyMeApi.ts`
- Create: `mobile/src/features/account/useMyService.ts`
- Test: `mobile/src/features/account/myService.test.tsx`

**Interfaces:**
- Consumes: `GET /v1/surveys/me` (Task 2).
- Produces: `useMyService(api, enabled)` returning `{ data, error, reload }`. It is a separate hook, so the `useAccountSummary` contract stays unchanged, and it reloads on `'account-user-changed'`.

- [ ] **Step 1: Write failing tests.**
  - `waiter sees Mi servicio with attention avg and NPS of the month`: the card reads "Atención 4.6 · NPS 72";
  - `below 3 responses shows Aún no hay suficientes opiniones este mes`;
  - `non-waiter does not see the card and does not call the endpoint`;
  - `load error shows inline retry without breaking the home`.
- [ ] **Step 2: Run** and confirm FAIL. **Step 3: Implement** the card in the "Mi espacio" block. **Step 4: Run** full vitest, `tsc` and build, all green.
- [ ] **Step 5: Commit** `feat(mobile): waiter monthly service score in Mi cuenta`.

### Task 5: Web — NPS report page

**Files:**
- Create: `client/src/pages/SurveyReport.tsx` (+ css), API methods in `client/src/services/api.ts` (`surveysAPI.summary/responses`)
- Modify: `client/src/App.tsx` (lazy route `/encuestas`, `<RoleGuard roles={ADMIN} permission="surveys.view">`), `client/src/components/Layout.tsx` (item "Encuestas NPS" in 'Gestión', `permission: 'surveys.view'`, both filter sites)
- Test: `client/src/pages/SurveyReport.test.tsx`; update `navigationPermissions.contract.test.ts` if it enumerates items

**Interfaces:**
- Consumes: Task 2 summary and responses endpoints.

- [ ] **Step 1: Write failing tests.**
  - `shows NPS, responses and three averages for the period`;
  - `by-waiter table sorted by responses`;
  - `Solo detractores filter lists comments with contact phone`;
  - `empty period shows Sin respuestas en el período`;
  - `nav item hidden without surveys.view`.
- [ ] **Step 2: Run** and confirm FAIL.
- [ ] **Step 3: Implement.**
  - Filters: dateFrom/dateTo (default the current month), branch.
  - KPI row: NPS (tone set by the value: ≥ 50 success, < 0 danger), Respuestas, Atención, Servicio, Comida.
  - Table by waiter, then the responses table (paginated, 20) with a "Solo detractores" toggle.
  - Follow the RH layout rules (PageHeader, CatalogTable, box-less filters). Use no chart unless it adds decision value.
- [ ] **Step 4: Run** `cd client && npx tsc --noEmit` and the client tests for the touched files, all green.
- [ ] **Step 5: Commit** `feat(client): customer NPS report`.

## Execution notes
- Planner calls (deviations from spec §7.3.3, to confirm): the three star ratings are nullable, so a survey abandoned after the NPS still counts (the spec types them as required). The waiter score is masked below 3 answers. `@capacitor/app` is added to block Back.
- **Order:** T1 → T2 (server), then T3 → T4 (mobile, one writer at a time). T5 can run in parallel with T3/T4 only if its commits stage explicit paths (ruling R8 of Phase 4).
- **Final reviews:** Opus for the server; Opus + Fable 5.2 for mobile + web; one fix wave; a scoped re-review.
- **Deferred to the device gate:** Back-button swallowing on real hardware, the survey at 1280×800 and 1024×600, and `npx cap sync android` after adding `@capacitor/app`.
- **New migration not rehearsed on MySQL:** `20261123_customer_survey`. It only creates a table and inserts permissions, with no lock on hot tables.
