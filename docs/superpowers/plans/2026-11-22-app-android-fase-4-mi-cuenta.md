# App Android — Fase 4 (Mi centro de cuenta, celular personal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An employee manages everything from their own phone:
- clock in and out (Marcar) with face and location, and enroll their face;
- see their schedule and payslips;
- request leave, overtime, punch corrections, shift swaps and loans, and track or cancel those requests;
- for ADMIN/SUPERADMIN only, approve their team's requests.

**Architecture:**
- **Server:** one small task adds the missing self-service endpoints:
  - loan policy;
  - cancelling one's own loan request;
  - PIN status;
  - an employee summary.
- **App:** everything else lives in `mobile/src/features/account/` as a lazy chunk.
  - Shared HR data layer: `hrApi.ts`, built on the mobile `http`.
  - A small generic UI kit in `mobile/src/ui/`.
  - One screen per section.
- **Reuse and capture:** pure web modules come in through `@web/*`. Face capture uses the WebView's `getUserMedia` and `navigator.geolocation`. The Capacitor camera plugin is not used, because it takes a single still and the liveness check needs 6 frames.
- **Phase 5:** push notifications and "mi NPS" move there. Neither the NPS model nor FCM exists yet.

**Tech Stack:** Express 5 + Prisma/MySQL + Jest (server); Capacitor 6 (core 6.2.3), React 18, Vite, Vitest, axios (mobile).

**Spec:** `docs/superpowers/specs/2026-11-19-app-android-design.md` (§7.1, §7.2, §7.5, §7.6 items 4–5, §9.1 "Mi cuenta"). The inventory of what exists, with file:line citations, is at `.superpowers/sdd/2026-11-22-app-android-fase-4-mi-cuenta/api-inventory.md`. Read its relevant section before each task.

**User decision (2026-11-20):** "Por aprobar" appears only for ADMIN/SUPERADMIN and uses the current server rules. Team-scoped approval stays for later.

## Global Constraints

**Platform and layout**
- Personal phone, **portrait**, dark minimal theme (`theme/tokens.css`, `theme/ui.css`).
- One primary button per screen; secondary buttons are outlined.
- Color only communicates state: amber means attention or pending, soft red means rejected or error.

**Home and screens**
- The home has three blocks, in this order:
  1. **Marcar**, the primary action, driven by `GET /hr/me/attendance/today` `availableActions`.
  2. **Solicitar.** Cards in a **two-column grid**, each with an icon, a name and a useful datum (days available, maximum amount…).
  3. **Pendiente para ti** + **Mis solicitudes.** Cards showing status and detail, with "Cancelar" while the request is pending.
  - **Por aprobar** shows only for ADMIN/SUPERADMIN.
- Each request is a **single-screen form**.
- **Sections:** Mi información, Mi horario (current and next week, plus confirm), Mi nómina (receipts by period, PDF), Préstamos.

**Access and HTTP**
- Every HR request needs an `INTERNAL` account with an `employeeId`.
  - If the session user has no `employeeId`, the home shows "Tu usuario no está vinculado a un empleado. Pide a RH que lo vincule." and only Mi información (profile/password).
- HR mutations send the header `Idempotency-Key`. Workforce, benefits and attendance require it.
  - The key is created per user action and reused on retries of that same action (the `actionId` pattern from `features/cash/cashApi.ts`).
  - The app never auto-retries a non-idempotent call (`/swaps`).
  - Submit buttons are disabled while in flight.
- The default axios timeout stays at 15 s. Punch and enrollment uploads pass `timeout: 45000`.

**Reuse and dependencies**
- Reuse these pure web modules (via `@web`): `utils/idempotency`, `utils/apiError`, `utils/hrFormat`, `utils/dateInput`, `utils/currency`, `components/hr/attendanceRules`, `components/hr/scheduleDates`, `components/hr/vacationBalance`, `components/hr/collectAllPages`, `components/hr/hrMoneyInputFormat`, and the `types/hr-*.ts` files (type-only).
- Never import the web `*Client.ts` files: they use the cookie/CSRF axios instance.
- No new Capacitor plugin.
- **Android manifest** gains `android.permission.CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, and `<uses-feature android:name="android.hardware.camera" android:required="false"/>`.

**Bundle, copy and commands**
- Initial JS ≤ 250 KB gzip; the account screens are lazy chunks.
- All copy is in Spanish. `attendanceRules.cameraErrorMessage` texts that say "navegador" are replaced with app wording.
- Commands:
  - server: `cd server && npx jest --config jest.unit.config.cjs <path>` (hermetic, never bare `npx jest`) + `npx tsc --noEmit`;
  - mobile: `cd mobile && npx vitest run <path>`, `npx tsc --noEmit`, `npm run build`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/app-android`, local only. No new migration.

## Review Focus

1. **A slow or failed punch upload.** A timeout, a network drop or a 5xx mid-upload is retried with the same `Idempotency-Key` and the same challenge while it is valid: 5 min, 3 uses. The employee never gets two punches.
   - A domain rejection is a 201 with `decision: REJECTED`. It shows as a result with its reason, never as "error".
   - Test: Task 4 `retry after timeout reuses idempotency key and challenge`, `REJECTED shows reason not error`.
2. **Camera or location denied, or GPS too inaccurate.** The screen shows a clear Spanish message, says how to fix it ("Activa la cámara para la app en Ajustes"), and offers Reintentar. A spinner never hangs.
   - Test: Task 4 `camera denied shows settings hint`, `accuracy above max shows retry`.
3. **Password expires while the app is open.** Any request returns 403 `PASSWORD_CHANGE_REQUIRED`. The app shows the blocking change-password screen, not an error loop. After the change, it asks to sign in again.
   - Test: Task 2 `403 PASSWORD_CHANGE_REQUIRED opens the blocking screen`.
4. **The session expires (30 min idle) while the user fills a long form.** The user re-logs in over the same screen and the draft is intact. If a different user logs in, everything is wiped.
   - Test: Task 2 `same user re-login keeps the mounted screen`, `different user wipes`.
5. **Double tap on "Solicitar préstamo" / "Enviar".** Only one request is created: the button disables in flight and the key is stable per action.
   - Test: Task 6 `double submit sends once`, Task 7 `double submit sends once with same key`.

---

### Task 1: Server — self-service gaps (loan policy, cancel own loan request, PIN status, employee summary)

**Files:**
- Modify: `server/src/routes/hr-benefits.routes.ts`, `server/src/controllers/hr-benefits.controller.ts`, `server/src/services/hr-benefits*.ts` (see inventory §1 "Prestamos")
- Modify: `server/src/controllers/auth.controller.ts` (`GET /auth/me` ~:38-48), `server/src/services/pin.service.ts`
- Modify: `server/src/routes/hr-workforce.routes.ts` (or the hr router that owns `/me/*`) for the employee summary
- Test: next to the existing hr-benefits, auth and hr unit tests (`server/src/tests/unit/`)

**Interfaces (produces):**
- `GET /api/v1/hr/benefits/me/loan-policy` (permission `hr.benefits.self`, INTERNAL + employeeId) returns:
  `{ currency, maxAmount: string|null, maxInstallments: number|null, maxPaymentPercent: number|null, minTenureMonths: number|null, eligible: boolean, ineligibleReason: 'HR_LOAN_TENURE_POLICY'|'HR_LOAN_POLICY_DISABLED'|null, tenureMonths: number }`
  - Values come from the current policy that `POST /me/loan-requests` validates against (governance ~:286-351). There must be no divergent copy of the rules: extract one function used by both.
- `POST /api/v1/hr/benefits/me/loan-requests/:id/cancel` `{reason?: string ≤ 500}` + `Idempotency-Key`:
  - only the owner of a request in `REQUESTED` may cancel; it becomes `CANCELLED`;
  - another user's request → 404 `HR_LOAN_REQUEST_NOT_FOUND`;
  - any other state → 409 `HR_LOAN_REQUEST_NOT_CANCELLABLE`;
  - the cancellation is audited like owner transitions.
- `GET /api/auth/me` gains `hasPin: boolean` and `canUsePin: boolean`. `canUsePin` uses the same rule as `PinService.setPin`'s role check: PIN roles or the discount-authorize permission.
- `GET /api/v1/hr/me/employee` (any self permission, INTERNAL + employeeId) returns read-only:
  `{ code, fullName, position: string|null, branchName: string|null, hireDate: string|null, workEmail, workPhone, emergencyContactName, emergencyContactPhone }`
  - Fields that don't exist map to null.
  - Contact edits stay on the existing `PUT /users/profile`.

- [ ] **Step 1: Write failing tests:**
  - `loan-policy returns current limits and eligibility from the same rules as loan-requests`
  - `loan-policy ineligible by tenure`
  - `cancel own REQUESTED loan request → CANCELLED + audit`
  - `cancel other user's request → 404`
  - `cancel APPROVED → 409 HR_LOAN_REQUEST_NOT_CANCELLABLE`
  - `cancel replay with same Idempotency-Key returns same response`
  - `auth/me exposes hasPin and canUsePin (waiter true, admin-without-discount false)`
  - `me/employee returns summary; no employeeId → 403 like other self routes`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement following the existing self-route patterns: guards, `requireInternalEmployee`, idempotency.
- [ ] **Step 4:** Full unit suite + server tsc + client tsc → PASS.
- [ ] **Step 5:** Commit `feat(hr-self): loan policy, cancel own loan request, pin status, employee summary`.

### Task 2 [CRÍTICA]: App — account session (forced password change, expiry re-login over the same screen, 2FA kept)

**Files:**
- Modify: `mobile/src/core/session.ts` (Session gains `mustChangePassword?: boolean; passwordExpired?: boolean; sessionTimeoutMinutes?: number`)
- Modify: `mobile/src/features/account/accountApi.ts` (login keeps the flags; `changePassword(old, new)`)
- Modify: `mobile/src/core/http.ts`: a 403 with code `PASSWORD_CHANGE_REQUIRED` emits `appEvents` `'password-change-required'`; it does not clear the session.
- Modify: `mobile/src/app/Router.tsx` (account branch)
- Create: `mobile/src/features/account/ChangePasswordScreen.tsx`, `AccountShell.tsx` (+ tests)

**Interfaces (produces):**
- `<AccountShell session={Session|null} services />`: always mounted in account mode, like KitchenHome.
  - Without a session, it shows LoginScreen as an overlay above the kept screen tree.
  - When the user who logs in again has the same `user.id` as the last session, the tree and its drafts remain.
  - A different user unmounts and wipes the tree: remount with a new key.
- `ChangePasswordScreen` is blocking: there is no back button, and the only other action is "Cerrar sesión".
  - It is shown when the session has `mustChangePassword || passwordExpired`, or on `'password-change-required'`.
  - Fields: "Contraseña actual", "Nueva contraseña", "Repite la nueva contraseña".
  - Client checks: 8–128 characters, and the two new entries must match ("Las contraseñas no coinciden").
  - On success the server revokes all sessions. The app clears the session and shows login with the notice "Contraseña cambiada. Inicia sesión de nuevo."
- On session expiry, the login overlay shows "Tu sesión expiró. Vuelve a iniciar sesión."
- 2FA keeps working (existing `requires2FA` flow).
- No app idle lock on the personal phone: the phone's own lock applies, and the server idle timeout handles the rest.

- [ ] **Step 1: Write failing tests:**
  - `login keeps mustChangePassword/passwordExpired/sessionTimeoutMinutes`
  - `mustChangePassword session shows blocking change screen`
  - `403 PASSWORD_CHANGE_REQUIRED opens the blocking screen` (http emits the event; Router shows the screen)
  - `change success clears session and shows notice`
  - `mismatch and length validation`
  - `same user re-login keeps the mounted screen`: assert by DOM node identity and by a typed draft still present
  - `different user wipes`
  - `2FA flow unchanged` (regression)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full vitest + tsc → PASS.
- [ ] **Step 5:** Commit `feat(mobile): account session with forced password change and same-user re-login`.

### Task 3: App — HR data layer, UI kit, and the account home

**Files:**
- Create: `mobile/src/features/account/hrApi.ts`, `hrApi.test.ts`
- Create: `mobile/src/ui/Toast.tsx`, `ui/Card.tsx`, `ui/ScreenHeader.tsx`, `ui/ui-kit.css` (+ tests where there is logic)
- Create: `mobile/src/features/account/AccountHome.tsx` (replace the placeholder), `useAccountSummary.ts` (+ tests)
- Modify: `mobile/src/features/account/AccountShell.tsx` (simple in-app navigation: a `section` state with a back button in ScreenHeader; no router library)

**Interfaces (produces):**
- `createHrApi(http)`: one method per endpoint in the inventory §1, typed with `@web/types/hr-*`. Mutations take `opts?: { actionId?: string }`. Methods include:
  - `attendanceToday()`, `attendancePolicy()`, `biometricStatus()`, `createChallenge(purpose, action?)`, `punch(form, opts)`, `enroll(form, opts)`
  - `mySchedule(weekStart)`, `acknowledgeSchedule(id)`, `teamSchedule(weekStart)`
  - `myReceipts(params)`, `receiptPdf(id)` (blob)
  - `myWorkforce(range)`, `leaveTypes()`, `createLeave(body, opts)` (creates a DRAFT, then submits; returns the submitted request), `cancelLeave(id, reason, opts)`
  - `createOvertime`, `cancelOvertime`, `createCorrection`, `cancelCorrection`
  - `mySwaps(status?)`, `createSwap`, `respondSwap`, `cancelSwap`
  - `loanPolicy()`, `myLoans()`, `myLoan(id)`, `requestLoan(body, opts)`, `cancelLoanRequest(id, reason, opts)`
  - `myEmployee()`, `profile()`, `updateProfile(body)`, `setPin(pin, currentPassword)`
- `HrError { code?: string; status?: number; message: string }`:
  - messages via `@web/utils/apiError`, in Spanish;
  - `isAmbiguous` comes from `@web/utils/idempotency.isAmbiguousMutationFailure`.
- `useAccountSummary(hrApi)` returns `{ today, pendingForYou: PendingItem[], myRequests: RequestCardModel[], status, reload }`. It is assembled from:
  - `me/attendance/today`;
  - `me/schedule` for this week and next, where `acknowledgedAt == null` → "Confirma tu horario";
  - `me/receipts`, where a receipt id is not in the local seen set (`localStorage` `acct.seenReceipts`, try/catch) → "Recibo nuevo";
  - `me/swaps` waiting for my response → "Responde cambio de turno";
  - `me/workforce` and `me/loans` (myRequests: leave/overtime/correction/swap/loan with status, and `cancellable` when pending).
- **AccountHome:**
  - Marcar card: primary button labelled by the first `availableActions` entry using `ATTENDANCE_ACTION_LABELS`. With `blockingIssue` `STALE_OPEN_ATTENDANCE`, it shows "Tienes una jornada abierta sin cerrar" and a "Corregir marcaje" button.
  - Solicitar grid (two columns): Permiso/vacaciones (days available via `selectVacationBalance`), Horas extra, Corregir marcaje, Cambio de turno, Préstamo (maximum amount from loanPolicy, or "No disponible").
  - Pendiente para ti list and Mis solicitudes cards.
  - Por aprobar entry only for ADMIN/SUPERADMIN.
  - Links to Mi horario, Mi nómina, Préstamos, Mi información.

- [ ] **Step 1: Write failing tests:**
  - `hrApi sends Idempotency-Key stable per actionId`
  - `punch/enroll use 45 s timeout`
  - `receiptPdf requests blob`
  - `summary builds pending items (unacknowledged schedule, new receipt, swap to answer)`
  - `home hides Por aprobar for non-admin`
  - `home without employeeId shows the unlinked message`
  - `stale open attendance shows Corregir marcaje`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** vitest + tsc + build; initial JS ≤ 250 KB → PASS.
- [ ] **Step 5:** Commit `feat(mobile): HR data layer, UI kit and account home`.

### Task 4 [CRÍTICA]: App — Marcar (face + location) and face enrollment

**Files:**
- Create: `mobile/src/features/account/attendance/`: `useFaceCapture.ts`, `useLocation.ts`, `PunchScreen.tsx`, `EnrollScreen.tsx` (+ tests)
- Modify: `mobile/android/app/src/main/AndroidManifest.xml` (permissions per Global Constraints)

**Interfaces:**
- Consumes `hrApi` from Task 3; `@web/components/hr/attendanceRules`.
- `useFaceCapture()` returns `{ start(): Promise<void>, captureFrames(count=6, intervalMs=450): Promise<Blob[]>, stop(), error?: 'denied'|'unavailable'|'unknown' }`.
  - It uses `getUserMedia({video:{facingMode:'user', width:{ideal:720}}})` and draws to a canvas at 640×640, `toBlob('image/jpeg', 0.86)`.
  - It always stops the tracks on stop or unmount.
- `useLocation()` returns `{ get(): Promise<{latitude, longitude, accuracyM, capturedAt}> }` using `getCurrentPosition({enableHighAccuracy:true, timeout:15000, maximumAge:0})`, with errors `'denied'|'timeout'|'unavailable'`.

**Punch flow:**
1. Show the action, the scheduled shift and the branch.
2. Take location first. If `accuracyM > locationRequirements.maxAccuracyM`, show "Ubicación imprecisa (±{n} m). Sal a un lugar abierto y reintenta." with Reintentar.
3. Create a challenge (`ATTENDANCE_PUNCH`, action), then show `livenessInstruction` big ("Gira la cabeza a la izquierda"…).
4. Capture the frames (`captureFrameCount`, `captureIntervalMs` from the challenge).
5. Build multipart: `faceImage` = frame 0, `faceFrames` = the rest, plus the location fields and the challenge id/token, with `Idempotency-Key`.
6. On `network`/timeout/5xx: retry the same request (same key, same frames, same challenge) while the challenge is not expired (`isChallengeExpired`). Otherwise create a new challenge and capture again with a new key.

**Results:**
- `ACCEPTED`: "Entrada registrada 08:02" (label per action), with a checkmark.
- `REVIEW_REQUIRED`: amber, "Registrado — RH lo revisará: {message}".
- `REJECTED`: soft red, `message` + the failed `checks` via `presentAttendanceChecks`, and Reintentar.

**Errors:**
- Camera denied: "Activa la cámara para la app en Ajustes del teléfono." + Reintentar.
- Location denied: "Activa la ubicación para la app en Ajustes del teléfono." + Reintentar.
- 503 `FACE_PROVIDER_UNAVAILABLE`: "El reconocimiento facial no está disponible. Intenta en unos minutos."

**Enrollment:**
- Reached when `biometricStatus` is NOT_ENROLLED or REVOKED.
- Shows the consent text from `attendancePolicy.biometricRetentionNotice` with an "Acepto" checkbox.
- Challenge `BIOMETRIC_ENROLLMENT`, capture, `enroll` with `consentAccepted:'true'` and `consentVersion`.
- Result: PENDING → "Enviado. RH debe aprobar tu registro antes de marcar." While PENDING, the Marcar card shows "Registro facial pendiente de aprobación" and does not let the user punch.

- [ ] **Step 1: Write failing tests** (mock `navigator.mediaDevices`, geolocation, hrApi):
  - `captures 6 frames at 450 ms and stops tracks`
  - `camera denied shows settings hint`
  - `location denied shows settings hint`
  - `accuracy above max shows retry`
  - `retry after timeout reuses idempotency key and challenge`
  - `expired challenge gets a new challenge and new key`
  - `ACCEPTED shows time`
  - `REVIEW_REQUIRED amber`
  - `REJECTED shows reason not error`
  - `FACE_PROVIDER_UNAVAILABLE message`
  - `not enrolled routes to enrollment with consent`
  - `PENDING enrollment blocks punching`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement, and add the manifest entries.
- [ ] **Step 4:** vitest + tsc + build → PASS.
- [ ] **Step 5:** Commit `feat(mobile): attendance punch with face liveness and location, and face enrollment`.

### Task 5: App — Mi horario, Mi nómina, Mi información (password, PIN)

**Files:** create in `mobile/src/features/account/`: `ScheduleScreen.tsx`, `PayrollScreen.tsx`, `ProfileScreen.tsx`, `PinSetupSheet.tsx` (+ tests).

**Mi horario**
- This week and next (`weekStartFor` from `@web/components/hr/scheduleDates`).
- Shifts are grouped by day; a shift that crosses midnight is marked "+1".
- With `status` PUBLISHED and `acknowledgedAt` null, the primary button is "Confirmar horario"; once confirmed it shows "Confirmado {fecha}".
- With no published schedule: "Aún no hay horario publicado para esta semana".

**Mi nómina**
- Receipts list per period: period, net pay via `formatHrMoney`, and a "Nuevo" badge until opened.
- Opening a receipt marks it seen.
- The detail shows the self-safe fields.
- "Descargar PDF" calls `receiptPdf(id)`, then `sharePdf(blob, 'recibo-{periodo}.pdf')` from `features/print/printOut.ts`.

**Mi información**
- Employee summary (read-only), and editable profile phone, email and address via `PUT /users/profile`.
- "Cambiar contraseña" opens ChangePasswordScreen in non-blocking mode.
- "Definir PIN" / "Cambiar PIN" appears only if `canUsePin`; the label follows `hasPin`.
  - The sheet asks for the PIN twice (4–6 digits) and "Contraseña actual".
  - The client rejects repeated digits or sequences with the server's message text.
  - It sends `setPin(pin, currentPassword)`.
- "Cerrar sesión".

- [ ] **Step 1: Write failing tests:**
  - `schedule shows two weeks and confirm when unacknowledged`
  - `confirm calls acknowledge once and shows Confirmado`
  - `no schedule message`
  - `receipts show Nuevo until opened`
  - `download shares PDF blob`
  - `PIN option hidden when canUsePin false`
  - `PIN sheet sends currentPassword and validates match`
  - `profile save sends only whitelisted fields`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** vitest + tsc + build → PASS.
- [ ] **Step 5:** Commit `feat(mobile): my schedule, payslips and profile with PIN`.

### Task 6: App — Solicitudes (leave, overtime, correction, swap), Mis solicitudes, Pendiente para ti

**Files:** create in `mobile/src/features/account/requests/`: `LeaveForm.tsx`, `OvertimeForm.tsx`, `CorrectionForm.tsx`, `SwapForm.tsx`, `MyRequests.tsx`, `PendingForYou.tsx` (+ tests).

**Each form is a single screen with one primary "Enviar"**, disabled in flight. The actionId is created when the form opens and reused for retries.

- **Leave:**
  - type picker from `leaveTypes()`, excluding types with `requiresAttachment`;
  - dates;
  - fraction FULL_DAY/HALF_DAY/HOURS, with times when HOURS;
  - reason of 3–2000 characters;
  - shows "Disponibles: {n} días" for the vacation type.
- **Overtime:** date, minutes (1–10080), reason.
- **Correction:**
  - type and fields per the inventory;
  - prefilled from the `STALE_OPEN_ATTENDANCE` entry point (`type: ADD_PUNCH`, `requestedAction: CHECK_OUT`).
- **Swap:**
  - pick one of my future published shifts;
  - pick a teammate and optionally their shift from `teamSchedule(weekStart)`;
  - reason.
  - Ambiguous failures are NOT auto-retried. Show "No se pudo confirmar el envío; revisa Mis solicitudes antes de reintentar."
- **Mis solicitudes:**
  - cards with type, dates or amount, and status chip: Pendiente amber, Aprobada neutral, Rechazada soft red, Cancelada muted;
  - "Cancelar" asks for a reason (≥ 3 characters where the server requires it) on pending requests (DRAFT/PENDING; swaps PENDING/ACCEPTED as requester).
- **Pendiente para ti:**
  - confirm schedule → Mi horario;
  - new receipt → the receipt;
  - swap waiting for my answer → Aceptar / Rechazar (`respondSwap`).
- Server errors appear inline in Spanish (e.g. `HR_OVERTIME_OVERLAP` → the server message).

- [ ] **Step 1: Write failing tests:**
  - `leave hides requiresAttachment types and shows balance`
  - `leave create then submit`
  - `double submit sends once`
  - `ambiguous failure on leave retries with same key`
  - `swap ambiguous failure is not retried and shows check message`
  - `cancel pending asks reason and calls cancel`
  - `respond swap accept`
  - `correction prefilled from stale attendance`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** vitest + tsc + build → PASS.
- [ ] **Step 5:** Commit `feat(mobile): request forms, my requests and pending-for-you`.

### Task 7: App — Préstamos (active loans, detail, request with live installment, cancel)

**Files:** create in `mobile/src/features/account/loans/`: `LoansScreen.tsx`, `LoanDetail.tsx`, `LoanRequestForm.tsx`, `loanMath.ts` (+ tests).

**Interfaces:**
- Consumes Task 1 `loanPolicy`, `cancelLoanRequest`.
- `installmentPlan(amount: string, n: number): string[]`: decimal strings. Each installment is `floor(amount/n, 2)`; the last one absorbs the remainder, so the total equals the amount exactly. Work in integer cents.

**Screens:**
- **List:** active loans and requests, each showing status, amount, and outstanding balance (from the detail when the list lacks it).
- **Detail:** `schedule[]` with number, due date, scheduled amount, paid and outstanding, and a status chip; OVERDUE is soft red.
- **Request form:**
  - amount (money input via `hrMoneyInputFormat`) ≤ `maxAmount`;
  - installments 1..`maxInstallments`;
  - purpose ≤ 900;
  - payroll deduction toggle;
  - live line: "{n} cuotas de {monto} (última {monto})";
  - if `maxPaymentPercent` exists, the note "Máximo {p}% de tu salario por cuota" (the server is authoritative).
  - When `eligible` is false, it shows the reason ("Aún no cumples la antigüedad mínima de {m} meses") and no form.
- **Cancel:** "Cancelar solicitud" only in `REQUESTED`.

- [ ] **Step 1: Write failing tests:**
  - `installmentPlan 1000/3 = 333.33,333.33,333.34`
  - `installmentPlan 100/1 = 100.00`
  - `installmentPlan sums exactly for 0.05/2`
  - `form blocks amount above max and installments above max`
  - `ineligible shows reason and no form`
  - `double submit sends once with same key`
  - `cancel only for REQUESTED`
  - `detail shows overdue in soft red`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** vitest + tsc + build → PASS.
- [ ] **Step 5:** Commit `feat(mobile): loans with live installments and request cancel`.

### Task 8: App — Por aprobar (ADMIN/SUPERADMIN only)

**Files:** create `mobile/src/features/account/approvals/ApprovalsScreen.tsx` (+ test), and add approval methods to `hrApi.ts`:
- `pendingLeave()`, `decideLeave(id, decision, reason, opts)`
- `pendingOvertime()`, `decideOvertime(id, decision, approvedMinutes?, reason, opts)`
- `pendingCorrections()`, `decideCorrection(...)`
- `pendingSwaps()`, `approveSwap(id, notes)`

Use the existing list endpoints filtered to PENDING, as in inventory §1 "Aprobaciones".

**Behavior:**
- **Visibility:** only when the session role is ADMIN or SUPERADMIN. Any other user never sees the entry, even with `hr.workforce.approve` (user decision).
- **Layout:** tabs Permisos / Horas extra / Correcciones / Cambios de turno. Each tab has cards with employee, dates and minutes, and reason, plus "Aprobar" and "Rechazar". Rechazar requires a reason of ≥ 3 characters.
- **Overtime:** approve allows editing `approvedMinutes`, which must be ≤ requested.
- **Errors:** `HR_SELF_APPROVAL_FORBIDDEN` shows "No puedes aprobar tu propia solicitud". Other errors show inline.
- After a decision, the card leaves the list.

- [ ] **Step 1: Write failing tests:**
  - `hidden for non-admin even with approve permission`
  - `approve leave sends decision with key`
  - `reject requires reason`
  - `overtime approve caps minutes`
  - `self approval error message`
  - `decided card leaves list`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** vitest + tsc + build → PASS.
- [ ] **Step 5:** Commit `feat(mobile): approvals for admins on the phone`.

---

## Phase 4 gate (code closes here; device part deferred to Android Studio)

**Checks to pass**
- Server suite + tsc green; client tsc green; mobile vitest + tsc + build green; initial JS ≤ 250 KB.

**Final reviews**
- Opus on the backend (Task 1).
- Opus + Fable 5.2 on the app (Tasks 2–8).
- One fix wave, then a scoped re-review.

**Deferred to the device**
- "Empleado gestiona todo desde su celular" on a real phone:
  - enroll, have RH approve, then punch in and out (indoor and outdoor GPS, deny and then allow permissions);
  - confirm a schedule;
  - download a receipt;
  - request and cancel leave and a loan;
  - forced password change;
  - session expiry mid-form;
  - an admin approves from the phone.
- `npx cap sync android` with the manifest permissions.

**Moved to Phase 5**
- Push notifications (FCM, decisions and published schedule).
- "Mi NPS".
- Team-scoped approvals, if wanted later.
