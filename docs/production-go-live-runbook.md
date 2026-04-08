# Production Go-Live Runbook

## Scope

This runbook defines a repeatable release process for `client` and `server`, including pre-flight checks, deployment, smoke tests, and rollback.

## 1) Pre-Flight (Required)

- Confirm critical environment variables are present and valid:
  - `server`: `DATABASE_URL`, `JWT_SECRET`, `CLIENT_URL`, `MYSQLDUMP_PATH` (prod), `NODE_ENV=production`
  - `client`: `VITE_API_URL`, `VITE_WS_URL`
- Confirm migration/seed policy:
  - Never run non-production seeds with demo credentials in production.
  - If seed is required, provide `SEED_SUPERADMIN_PASSWORD` explicitly and rotate after first login.
- Confirm infrastructure readiness:
  - DB backup available and restorable.
  - TLS certificates valid.
  - Reverse proxy routes `/api` and static app correctly.
- Confirm branch and build provenance:
  - Release commit is tagged and immutable.
  - CI passed on the exact commit.

## 2) Release Gates (Local + CI)

Run from repo root (or corresponding package directories):

### Server gates

```bash
cd server
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

### Client gates

```bash
cd client
npm ci
npm run lint
npm run typecheck
npm test -- --run
npm run test:e2e
npm run build
```

## 3) Deployment Steps

1. Deploy backend artifact.
2. Run DB migration strategy approved by DBA/owner.
3. Restart backend and verify startup logs are clean.
4. Deploy frontend artifact.
5. Purge CDN/cache if applicable.
6. Validate health endpoint and key routes.

## 4) Post-Deploy Smoke Tests

- Auth:
  - Login succeeds and sets secure cookie (`auth_token`).
  - Session revocation invalidates API and websocket access.
- Operations:
  - Create order, send to kitchen, deliver, pay.
  - Payment rejects insufficient stock condition when applicable.
  - Backup endpoints restricted to authorized roles only.
- Reporting:
  - Kardex page loads and export works.
- Integrations:
  - Delivery webhook rejects invalid signature.
  - Delivery webhook rejects missing tenant headers.

## 5) Monitoring (First 60 Minutes)

- Track 401/403/500 error rates.
- Track websocket connection/auth failures.
- Track DB connection saturation and slow queries.
- Validate no spike in failed payments or order status errors.

## 6) Rollback Plan

Rollback is mandatory if any of these occur:

- Authentication regression (systemic login/session failures).
- Data integrity risk (order totals, inventory mismatches).
- Persistent 5xx increase beyond agreed threshold.
- Critical integration failure impacting operations.

Rollback steps:

1. Route traffic to previous stable frontend.
2. Deploy previous stable backend artifact.
3. If migration is backward-incompatible, execute DB rollback strategy.
4. Re-run smoke tests on rolled-back version.
5. Publish incident note with impact window and root cause.

## 7) Security Checklist

- No default credentials active.
- No secrets in repo or deployment logs.
- Cookie flags in production:
  - `HttpOnly=true`
  - `Secure=true`
  - `SameSite=Lax` (or stricter by policy)
- CORS origin restricted to production frontend.
- Backup access and download paths validated.

## 8) Sign-Off

Release cannot be marked complete until all items are checked by:

- Engineering owner
- QA/validation owner
- Operations owner
