-- Reusable shift-template colors and immutable schedule presentation snapshots.
-- This migration is additive. Existing templates receive a deterministic color;
-- existing shifts linked to a template are backfilled without changing times,
-- assignments, status, or published schedule revisions.

ALTER TABLE `ShiftTemplate`
    ADD COLUMN `color` VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
    ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `ScheduledShift`
    ADD COLUMN `templateNameSnapshot` VARCHAR(191) NULL,
    ADD COLUMN `templateColorSnapshot` VARCHAR(7) NULL;

UPDATE `ScheduledShift` AS `shift`
INNER JOIN `ShiftTemplate` AS `template`
    ON `template`.`id` = `shift`.`shiftTemplateId`
    AND `template`.`companyId` = `shift`.`companyId`
SET
    `shift`.`templateNameSnapshot` = `template`.`name`,
    `shift`.`templateColorSnapshot` = `template`.`color`
WHERE `shift`.`shiftTemplateId` IS NOT NULL;

ALTER TABLE `ShiftTemplate`
    ADD CONSTRAINT `ShiftTemplate_color_chk`
    CHECK (`color` REGEXP '^#[0-9A-Fa-f]{6}$'),
    ADD CONSTRAINT `ShiftTemplate_revision_chk`
    CHECK (`revision` >= 0);

ALTER TABLE `ScheduledShift`
    ADD CONSTRAINT `ScheduledShift_templateColorSnapshot_chk`
    CHECK (`templateColorSnapshot` IS NULL OR `templateColorSnapshot` REGEXP '^#[0-9A-Fa-f]{6}$');

-- Operational rollback (only if the application version using these columns has
-- first been rolled back):
-- ALTER TABLE `ScheduledShift`
--   DROP CHECK `ScheduledShift_templateColorSnapshot_chk`,
--   DROP COLUMN `templateColorSnapshot`,
--   DROP COLUMN `templateNameSnapshot`;
-- ALTER TABLE `ShiftTemplate`
--   DROP CHECK `ShiftTemplate_revision_chk`,
--   DROP CHECK `ShiftTemplate_color_chk`,
--   DROP COLUMN `revision`,
--   DROP COLUMN `color`;
