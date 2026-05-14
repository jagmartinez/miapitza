-- Rollback: 002_2fa_encryption_and_recovery
-- Description: Removes recovery codes and enabledAt columns from User table.
--
-- WARNING: This will permanently delete all stored recovery codes.
-- Ensure users are notified before running.

ALTER TABLE `User` DROP COLUMN `twoFactorRecoveryCodes`;
ALTER TABLE `User` DROP COLUMN `twoFactorEnabledAt`;
