# App Android — Fase 2b (Caja) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the shared service tablet, the CAJERO (PIN login) opens a cash shift, records cash in/out, does a blind NIO+USD count, closes the shift, and gets the close report and an 80 mm ticket. Invoice PDF print/share is added to payment.

**Architecture:** Reuse the existing cash backend (`/api/cash-registers`, `/api/cash-shifts`, `/api/cash-arqueo`). Two backend tasks close the gaps the tablet needs:
- error codes and data hygiene;
- an exchange-rate setting, a suggested opening float, and report header data.

The mobile tasks add a cash data layer (online-only, never queued) and five screens, all in lazy chunks. Printing builds the 48-column text ticket in pure code. The phone's share sheet sends the text or the PDF; a Bluetooth ESC/POS driver waits for the real printer.

**Tech Stack:**
- Server: Express 5, Prisma (MySQL), Jest via `npx jest --config jest.unit.config.cjs`.
- Mobile: Capacitor 6, React 18, Vite, Vitest, axios.
- New pinned Capacitor 6 plugins: `@capacitor/share`, `@capacitor/filesystem`.

**Spec:** `docs/superpowers/specs/2026-11-19-app-android-design.md` §7.3.2b (plus §7.3.1 for invoice print/send, §9.1 visual language).

**Existing contracts:** `.superpowers/sdd/2026-11-21-app-android-fase-2b-caja/api-inventory.md` (not versioned; file:line for every endpoint, rule and gap G1–G6).

## Global Constraints

**Roles and access**
- Cash roles: `CASHIERS = SUPERADMIN, ADMIN, CAJERO` (`server/src/constants/roles.ts`). Cash UI is visible only to them, through `can`/`canAny` and role checks in `mobile/src/core/permissions.ts`.
- User decision 2026-11-21: the count is **blind** for CAJERO. While counting, a CAJERO never sees "Debe haber", the expected cash, or the difference amount. After pressing "Validar", they see only the result label (Cuadrado / Sobrante / Faltante) and whether a note is required. ADMIN and SUPERADMIN see everything, and are the only ones who can `forceClose` (mandatory note).

**Denominations and math**
- NIO bills: 1000, 500, 200, 100, 50, 20, 10. NIO coins: 10, 5, 1, 0.5, 0.25. USD bills: 100, 50, 20, 10, 5, 1.
- Total counted = NIO bills + NIO coins + USD × exchange rate. It is sent as `endAmount` and must equal the denomination total to the cent.
- Expected ("debe haber") = float + cash sales + IN − OUT. The server is authoritative.

**Close rules (server)**
- Tolerance is the `cash_reconciliation_tolerance` setting, default 1.
- A note is required when 0 < |diff| ≤ tolerance.
- When |diff| > tolerance, only ADMIN or SUPERADMIN can close, with `forceClose` and a note.
- A CAJERO can never close beyond tolerance. The UI tells them to call a supervisor.

**Exchange rate**
- A new company setting, `exchange_rate_usd`: C$ per US$, default 36.5, > 0, writable by ADMIN.
- The close screen pre-fills it. The cashier may adjust it for that close. It is sent as `exchangeRate` and stored as `closingExchangeRate`.

**Network and idempotency**
- Cash calls are online-only. They are never queued, and they show "Requiere conexión" when offline.
- Every mutation sends `X-Idempotency-Key`: a fresh key per action, reused only on retry after an ambiguous failure, the same rule as Phase 2.

**UI**
- Copy in Spanish, dark minimal theme, tokens only.
- Amounts on one line with tabular figures.
- Landscape. Nothing overflows at 1280×800 or 1024×600.
- Initial JS ≤ 250 KB gzip, with cash screens in lazy chunks.

**Ticket**
- 80 mm, 48 characters per line, monospace, hyphen separators, the sections exactly as spec §7.3.2b.
- If there is no printer, offer share (text or PDF).

**Process**
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The web client must behave the same unless a task says otherwise.

## Review Focus

1. **Retry after a lost close response.** Expect: the retry doesn't fail with a confusing 500. The tablet recognizes "already closed by me" and shows the report.
2. **A CAJERO peeking at the expected amount.** No screen, API response, or log on the tablet may reveal expected or difference before validating. This includes summary, preview-close and active-shift cards. Expect: blind count holds end to end.
3. **USD counted with no or zero exchange rate, or a fractional NIO coin (0.25, 0.5).** Expect: cent-exact totals that match the server, and a clear validation message, never a server 500.
4. **Two cashiers race to open the same register, or one user opens on two tablets.** Expect: a clear "caja ocupada por X" / "ya tienes un turno abierto", and no duplicate shift.
5. **Shift switch on a shared tablet.** Cashier A has an unfinished count, then B logs in by PIN. Expect: A's count and amounts are never shown to or sent by B (same session fence as Phase 2).

---

## BACKEND

### Task 1: Cash API hardening for the tablet **[CRÍTICA]**

**Files:**
- Modify: `server/src/services/cash-shift.service.ts`, `server/src/services/cash-arqueo.service.ts`, `server/src/controllers/cash-shift.controller.ts`, `server/src/controllers/cash-arqueo.controller.ts`, `server/src/services/cash-register.service.ts` (or wherever `GET /cash-registers` builds `activeShift`)
- Test: `server/src/tests/unit/cash-tablet-hardening.test.ts`

**Interfaces:**
- Produces:
  - **Error codes.** Business errors on open, movement, count, preview-close and close return 4xx JSON `{success:false, message, code}`. The Spanish messages are unchanged. Codes:
    - `CASH_SHIFT_ALREADY_OPEN` 409
    - `CASH_REGISTER_OCCUPIED` 409 (adds `occupiedBy:{id,name}`)
    - `CASH_COUNT_MISMATCH` 400
    - `CASH_EXCHANGE_RATE_REQUIRED` 400
    - `CASH_INVALID_BREAKDOWN` 400
    - `CASH_NOTE_REQUIRED` 400
    - `CASH_DIFF_EXCEEDS_TOLERANCE` 403
    - `CASH_SHIFT_ALREADY_CLOSED` 409 (adds `closedByMe:boolean`)
  - Today these come back as 500 or untyped 400. Check every web caller of these errors and keep its message-based handling working (cite file:line).
  - **G6:** `GET /cash-shifts/:id/summary` returns `user:{id,name}` only, never the full row.
  - **G3:** `GET /cash-registers` adds `activeShift.user:{id,name}`.
  - **Blind count on the server:** for a caller who is CAJERO without ADMIN or SUPERADMIN:
    - `preview-close` and `count` omit `expectedAmount`/`expected`, `difference` and `absoluteDifference`;
    - they keep `status`, `withinTolerance`, `requiresNote`, `exceedsTolerance` and `tolerance`;
    - `summary` omits expected end amount.
    - First verify that the web's blind CAJERO UI (`CashShift.tsx` `isBlindCashier` :189) never reads the omitted fields. If it does, change the web to read `status` instead and note it.
- [ ] **Step 1: Failing tests:**
  - `open on an occupied register returns 409 CASH_REGISTER_OCCUPIED with occupant name`
  - `second open by the same user returns 409 CASH_SHIFT_ALREADY_OPEN`
  - `close with diff over tolerance as CAJERO returns 403 CASH_DIFF_EXCEEDS_TOLERANCE`
  - `close retry on an already closed own shift returns 409 CASH_SHIFT_ALREADY_CLOSED closedByMe=true`
  - `USD counted without rate returns 400 CASH_EXCHANGE_RATE_REQUIRED`
  - `summary never includes passwordHash or other user columns`
  - `preview-close as CAJERO omits expected and difference; as ADMIN includes them`
  - `cash-registers list includes active shift user name`
- [ ] **Steps 2–4:** implement; run the full `npx jest --config jest.unit.config.cjs`, `npx tsc --noEmit`, and the client `npx tsc --noEmit`.
- [ ] **Step 5:** commit `fix(cash-api): typed errors, blind count and user hygiene for the tablet`.

### Task 2: Exchange rate, suggested float and report header

**Files:**
- Modify: `server/src/services/setting.service.ts` (default plus writable key), `server/src/routes/cash-shift.routes.ts`, the cash-shift controller and service, `server/src/services/cash-arqueo.service.ts` (report)
- Modify (web): the settings page where currency settings live. Add an "Tipo de cambio US$" input next to the tolerance setting, ADMIN only.
- Test: `server/src/tests/unit/cash-tablet-settings.test.ts`

**Interfaces:**
- Produces:
  - **Exchange rate setting:** `exchange_rate_usd` (string number), default `"36.5"`, validated finite and > 0, writable via `PUT /settings` by ADMINS, readable through `GET /settings`.
  - **Suggested float:** `GET /cash-shifts/suggested-float?cashRegisterId=N` returns `{suggested: number|null, fromShiftId|null}`. The value is the `endAmount` of the last CLOSED shift of that register, scoped by company and branch. Roles: CASHIERS.
  - **Report header:** `GET /cash-arqueo/:shiftId/report` adds `header:{companyName, ruc, branchName, branchAddress?, branchPhone?}`, from the same sources the invoice header uses (`invoice.service.ts:40-44`).
- [ ] **Step 1: Failing tests:**
  - `exchange_rate_usd defaults to 36.5 and rejects 0 and negative`
  - `suggested float is the last closed endAmount of that register only`
  - `suggested float is null when the register never closed`
  - `report header carries company RUC and branch`
- [ ] **Steps 2–4:** run the full jest suite, server `tsc` and client `tsc`.
- [ ] **Step 5:** commit `feat(cash-api): exchange rate setting, suggested float and report header`.

---

## APP (`mobile/`)

### Task 3: Cash data layer and arqueo math **[CRÍTICA]**

**Files:**
- Create: `mobile/src/data/cashApi.ts`, `mobile/src/data/cashTypes.ts`, `mobile/src/features/cash/cashMath.ts`, `mobile/src/features/cash/useCashShift.ts`
- Test: `mobile/src/data/cashApi.test.ts`, `mobile/src/features/cash/cashMath.test.ts`, `useCashShift.test.ts`

**Interfaces:**
- Consumes: `createHttp`, sessions and the Phase 2 session fence (epoch) in `mobile/src/data`. Read the fence code; don't reinvent it.
- Produces:
  - **`cashApi` (typed, online-only):**
    - `registers()`, `activeStatus()`, `suggestedFloat(registerId)`, `openShift({cashRegisterId,startAmount})`
    - `summary(shiftId)`, `addMovement(shiftId, {type:'IN'|'OUT', amount, documentType, description, reason})`. Map `reason` into the existing fields; check the validator, which rejects unknown keys.
    - `count(shiftId, breakdown)`, `previewClose(shiftId, payload)`, `close(shiftId, payload)`
    - `report(shiftId)`, `history({registerId?, from?, to?})`, `settings()` (exchange rate and tolerance)
  - **Mutation keys:** every mutation carries `X-Idempotency-Key`. A key is reused only on retry after an ambiguous failure (the Phase 2 rule).
  - **Errors:** errors map to a typed `CashError {code, message, occupiedBy?, closedByMe?}`.
  - **Close retry:** `CASH_SHIFT_ALREADY_CLOSED` with `closedByMe` resolves to `{alreadyClosed:true}` so the UI shows the report.
  - **`cashMath` (pure, integer cents):**
    - `DENOMINATIONS`
    - `countedTotals(breakdown, rate) → {nioBillsC, nioCoinsC, usd, usdInNioC, totalC}`
    - `buildClosePayload(breakdown, rate, notes, forceClose)`, matching the server's `calculateCountedAmount` to the cent (cite server file:line)
    - `expectedFromSummary(summary)`, for ADMIN only
  - **`useCashShift()`:** active shift state. It re-polls on focus, every 30 s while mounted, and after each mutation. It is cleared on lock or user switch by the session fence.
- [ ] **Step 1: Failing tests:**
  - `counted total matches server rule for coins 0.25 and 0.5 and USD at 36.5`
  - `endAmount equals denomination total to the cent`
  - `close retry after lost response resolves alreadyClosed and loads the report`
  - `occupied register error exposes occupant name`
  - `cash calls offline reject with requiere conexión and are never queued`
  - `user switch clears the active shift state`
- [ ] **Steps 2–4:** `cd mobile && npx vitest run`, `npx tsc --noEmit`, `npm run build`.
- [ ] **Step 5:** commit `feat(mobile): cash data layer and arqueo math`.

### Task 4: Open shift and entry points

**Files:**
- Create: `mobile/src/features/cash/CashHome.tsx` (router: open shift vs. active shift), `OpenShiftScreen.tsx`
- Modify: the tables header (cash icon), and the payment cash-shift block ("Abre tu turno de caja" becomes a button that opens OpenShiftScreen, then returns to the payment)
- Test: `*.test.tsx`

**Interfaces:**
- Produces: "Abrir turno" per spec §7.3.2b.
  - Register list: occupied registers dimmed, with the occupant's name.
  - Opening float shown large, with quick chips: suggested float (from Task 2) and round amounts. The rest is entered with the keypad.
  - "Contar billetes" opens the NIO denomination grid from `cashMath`.
  - Button "Abrir turno con C$ X".
  - The cash icon in the tables header is shown only to CASHIERS.
- [ ] **Step 1: Failing tests:**
  - `cash icon hidden for MESERO, shown for CAJERO`
  - `occupied register shows who has it and cannot be chosen`
  - `suggested float chip pre-fills the amount`
  - `open success lands on the active shift`
  - `payment without shift offers Abrir turno and returns to the payment`
- [ ] **Steps 2–4.**
- [ ] **Step 5:** commit `feat(mobile): open cash shift and entry points`.

### Task 5: Active shift and cash movements

**Files:**
- Create: `mobile/src/features/cash/ActiveShiftScreen.tsx`, `MovementSheet.tsx`
- Test: `*.test.tsx`

**Interfaces:**
- Produces:
  - **Active shift screen:**
    - Header: register, status, who, since when. Actions: Entrada / Salida / Arqueo parcial.
    - Four equal cards: Ventas (with number of payments), and Efectivo, Tarjeta and Transferencia (each with its % of the total).
    - List of cash movements.
    - Right panel "Efectivo en caja": float + cash sales + IN − OUT = **Debe haber**. It is shown only to ADMIN and SUPERADMIN. A CAJERO sees the panel without the expected amount (blind rule).
    - Main button **Cerrar turno**.
  - **MovementSheet:**
    - Entrada/Salida toggle, large amount with keypad.
    - Reason chips: Compra menor, Retiro a gerencia, Pago a proveedor, Otro.
    - Document type: FACTURA / RECIBO_GASTO / RECIBO_CAJA.
    - Description.
    - Double-tap guard.
- [ ] **Step 1: Failing tests:**
  - `cards show sales by method with percentages on one line`
  - `CAJERO never sees debe haber; ADMIN does`
  - `movement requires amount, reason and document type`
  - `double tap records one movement`
  - `movement refreshes the summary`
- [ ] **Steps 2–4.**
- [ ] **Step 5:** commit `feat(mobile): active cash shift and movements`.

### Task 6: Blind count (arqueo) and close **[CRÍTICA]**

**Files:**
- Create: `mobile/src/features/cash/CountCloseScreen.tsx`, `DenominationColumn.tsx`
- Test: `*.test.tsx`

**Interfaces:**
- Produces: per spec §7.3.2b, with the blind rule applied.
  - **Header:** register, cashier, and the day's exchange rate (editable, pre-filled from settings).
  - **Two columns:**
    - Córdobas: NIO bills and coins.
    - Dólares: USD bills, with the US$ total and its C$ equivalent.
    - Tapping a denomination opens the keypad for its count.
  - **Right panel:** córdobas counted, dólares in C$, and **total contado**.
    - ADMIN also sees **debe haber** and **diferencia**.
    - CAJERO sees only the result label after "Validar" (`previewClose`): Cuadrado / Sobrante / Faltante, with no amount.
    - A note is required when the server says `requiresNote` or `exceedsTolerance`.
    - "Guardar arqueo" does a partial `count`. "Cerrar turno" closes.
    - `exceedsTolerance` as CAJERO: the close is blocked with "La diferencia excede la tolerancia. Llama a un supervisor."
    - `exceedsTolerance` as ADMIN: "Forzar cierre" with a mandatory note.
  - **Session fence:** the in-progress count lives in component state only. It is never persisted and is cleared on lock or user switch.
- [ ] **Step 1: Failing tests:**
  - `CAJERO sees no expected or difference before or after validar, only the result label`
  - `ADMIN sees debe haber and diferencia`
  - `note required blocks close until filled`
  - `exceeds tolerance blocks CAJERO and offers force close to ADMIN`
  - `close payload endAmount equals counted total to the cent`
  - `lost close response retry shows the report`
  - `lock clears the in-progress count`
- [ ] **Steps 2–4.**
- [ ] **Step 5:** commit `feat(mobile): blind cash count and shift close`.

### Task 7: Close report, history and 80 mm ticket

**Files:**
- Create: `mobile/src/features/cash/CloseReportScreen.tsx`, `ShiftHistoryScreen.tsx`, `mobile/src/features/print/closeTicket.ts` (pure, 48 columns), `mobile/src/features/print/printOut.ts` (output adapter)
- Modify: `mobile/package.json` (pin `@capacitor/share` and `@capacitor/filesystem` to exact 6.x versions)
- Test: `closeTicket.test.ts`, `*.test.tsx`

**Interfaces:**
- Produces:
  - **Report screen** (spec §7.3.2b, "Reporte de cierre v2"):
    - Header with the result tag.
    - Four key figures: Ventas, Debe haber, Contado, Diferencia.
    - Three cards: Ventas por método, Efectivo, Arqueo.
    - Footer: Denominaciones / Enviar / **Imprimir ticket**.
    - After the close, the report shows everything, including to CAJERO; blind applies only while counting.
  - **History:** "Caja › Historial de turnos" lists closed shifts, each opening its report.
  - **`closeTicket(report): string`:** exactly 48 columns per line, hyphen separators, the spec's section order, signature lines, and the footer "Impreso fecha hora · usuario".
  - **`printOut`:** the interface `print(text)` / `shareText(text)` / `sharePdf(blob,name)`. The shipped implementation is share-based. The ESC/POS Bluetooth driver is a documented stub that throws `PrinterUnavailable`; the UI then falls back to share. The real driver is chosen at the device gate with the actual printer.
- [ ] **Step 1: Failing tests:**
  - `every ticket line is at most 48 chars`
  - `ticket shows SOBRANTE or FALTANTE with amount and both currencies`
  - `ticket header has company RUC and branch`
  - `report hides nothing after close`
  - `print falls back to share when no printer`
- [ ] **Steps 2–4.**
- [ ] **Step 5:** commit `feat(mobile): cash close report, history and 80mm ticket`.

### Task 8: Invoice PDF share in payment

**Files:**
- Modify: `mobile/src/features/waiter/payment/PaymentDone.tsx`, `mobile/src/features/waiter/tables/TableActionsSheet.tsx` (restore the Factura tile), `mobile/src/data/waiterApi.ts` (`invoicePdf(orderId): Blob`)
- Test: `*.test.tsx`

**Interfaces:**
- Produces:
  - **PaymentDone:** "Imprimir" / "Enviar" now appear, using `GET /api/invoices/:orderId/pdf`. The id is the ORDER id; check the route's permission and gate on it. Both go through `printOut.sharePdf`.
  - **Factura tile:** restored in the table actions sheet, gated by `invoices.issue`. It opens the invoice PDF when the order is invoiced; otherwise it is hidden.
- [ ] **Step 1: Failing tests:**
  - `PaymentDone shows Imprimir and Enviar and shares the invoice PDF`
  - `Factura tile hidden without permission or invoice`
  - `pdf download failure shows a retry message`
- [ ] **Steps 2–4.**
- [ ] **Step 5:** commit `feat(mobile): share invoice PDF from payment and table actions`.

### Gate de Fase 2b

- [ ] Server: `tsc` and the full jest suite are green. Client: `tsc` is green.
- [ ] Mobile: vitest, `tsc` and `build` are green. Initial JS ≤ 250 KB gzip.
- [ ] Final review of the backend (Opus) and of the app (Opus, with Fable 5.2 as second opinion), then one fix wave.
- [ ] Deferred to the device gate (Android Studio):
  - a full shift on the real tablet: open, movements, count with USD, CAJERO close, ADMIN force close, ticket;
  - choosing and testing the Bluetooth/network ESC/POS printer.
- [ ] Rehearse migrations on MySQL. This task adds no migrations; the setting key needs no migration.
- [ ] Measure the % of weekly usage consumed.

## Out of scope

- WS events for cash: the tablet polls.
- Reversing payments from the tablet.
- An admin UI for `maxDiscountPercent`.
- Automatic promotions.
- Kitchen (Fase 3), Mi cuenta (Fase 4), NPS and inventory (Fase 5).
