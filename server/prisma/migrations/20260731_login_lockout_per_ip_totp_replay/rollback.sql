-- Per-IP counters cannot be represented by the per-user schema; keep only the
-- per-user global row for each user.
ALTER TABLE `LoginAttempt` DROP FOREIGN KEY `LoginAttempt_userId_fkey`;

DELETE FROM `LoginAttempt` WHERE `ipKey` <> '*';

ALTER TABLE `LoginAttempt`
    DROP INDEX `LoginAttempt_userId_ipKey_key`,
    DROP PRIMARY KEY,
    DROP COLUMN `id`,
    DROP COLUMN `ipKey`,
    ADD PRIMARY KEY (`userId`);

ALTER TABLE `LoginAttempt`
    ADD CONSTRAINT `LoginAttempt_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `User` DROP COLUMN `twoFactorLastTimeStep`;
