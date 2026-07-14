-- Keep the Prisma Branch model aligned with databases created before tenant
-- timezone support was introduced.
ALTER TABLE `Branch`
    ADD COLUMN `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/Managua';
