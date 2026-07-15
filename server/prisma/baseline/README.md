# Prisma schema baseline

> **Estado del corte 2026-07-13:** este baseline fue verificado con 23
> migraciones. El árbol actual contiene una migración adicional de horarios RH
> aún en desarrollo y fuera de la certificación transaccional; por ello este SQL
> está obsoleto y no debe usarse para liberar hasta regenerarlo después del freeze.

`20260713_schema.sql` is a generated, schema-only bootstrap for a brand-new
empty MySQL database. It is intentionally outside `prisma/migrations`: adding it
to the historical migration chain would make existing installations try to
recreate tables they already have.

## Preferred disaster recovery

Restore the latest verified logical backup with
`scripts/mysql-logical-restore.ts`. That artifact contains schema, data and the
exact `_prisma_migrations` history, so normal `prisma migrate deploy` can resume
after restoration.

## Brand-new installation without data

1. Apply `20260713_schema.sql` to an empty database.
2. Mark the 23 migration directories present at this baseline as applied with
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
