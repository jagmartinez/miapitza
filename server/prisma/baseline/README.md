# Prisma schema baseline

`20260712_schema.sql` is a generated, schema-only bootstrap for a brand-new
empty MySQL database. It is intentionally outside `prisma/migrations`: adding it
to the historical migration chain would make existing installations try to
recreate tables they already have.

## Preferred disaster recovery

Restore the latest verified logical backup with
`scripts/mysql-logical-restore.ts`. That artifact contains schema, data and the
exact `_prisma_migrations` history, so normal `prisma migrate deploy` can resume
after restoration.

## Brand-new installation without data

1. Apply `20260712_schema.sql` to an empty database.
2. Mark the 18 migration directories present at this baseline as applied with
   `prisma migrate resolve --applied <migration-name>` in directory order.
3. Run `prisma migrate deploy`; it must report no pending baseline migrations.
4. Run the normal seed/bootstrap procedure for required roles, permissions,
   payment methods, company and branch data.

Never apply this SQL to an existing database. Never use it as a replacement for
a data backup.

## Regeneration

From `C:\restaurant\server`:

```powershell
npm.cmd exec ts-node -- --transpile-only scripts/generate-prisma-baseline.ts --out prisma/baseline/<date>_schema.sql
```

Generation fails when the destination already exists so a reviewed baseline is
not overwritten silently.
