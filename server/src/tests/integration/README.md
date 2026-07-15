# Integration database lifecycle

`npm run test:integration` never runs against the long-lived database named in
`.env.test`. The harness creates a unique database ending in `_test`, loads the
reviewed `20260713_schema.sql` baseline, marks its materialized migrations as
baselined, and applies every absent migration with `prisma migrate deploy`.
Weekly scheduling is intentionally not marked: its tables are absent from that
baseline and the real migration must create them before attendance biometrics.
The later-sorted order-financial-status migration is marked because its column
and backfill state are already materialized in the reviewed baseline. The same
applies to the Branch timezone compatibility migration: the baseline already
contains that non-null column and default.

Jest verifies that both statutory payroll migrations and all four append-only
triggers are present before executing any test. The HR Art. 19 suite therefore
does not delete immutable calculation traces in `afterAll`; the harness drops
the complete disposable database after Jest exits, including on test failure.

This preserves the production invariants during testing. Do not replace this
lifecycle with `db push` for release evidence, and do not disable or drop the
append-only triggers to make fixture cleanup pass.
