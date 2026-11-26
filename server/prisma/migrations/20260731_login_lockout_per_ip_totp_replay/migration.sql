-- Persist the last accepted TOTP time step so a code cannot be replayed
-- against a different application replica within its validity window.
ALTER TABLE `User` ADD COLUMN `twoFactorLastTimeStep` INTEGER NULL;

-- Login lockout moves from one row per user to one row per (user, client IP)
-- plus a per-user global row (ipKey = '*') that only applies a short backoff.
-- The FK needs an index on userId, so drop it while the primary key changes.
ALTER TABLE `LoginAttempt` DROP FOREIGN KEY `LoginAttempt_userId_fkey`;

-- Existing per-user counters become the global '*' row for that user. Any
-- active lock on them expires naturally at its stored lockedUntil.
ALTER TABLE `LoginAttempt`
    DROP PRIMARY KEY,
    ADD COLUMN `id` INTEGER NOT NULL AUTO_INCREMENT FIRST,
    ADD COLUMN `ipKey` VARCHAR(64) NOT NULL DEFAULT '*' AFTER `userId`,
    ADD PRIMARY KEY (`id`);

ALTER TABLE `LoginAttempt` ALTER COLUMN `ipKey` DROP DEFAULT;

CREATE UNIQUE INDEX `LoginAttempt_userId_ipKey_key` ON `LoginAttempt`(`userId`, `ipKey`);

ALTER TABLE `LoginAttempt`
    ADD CONSTRAINT `LoginAttempt_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
