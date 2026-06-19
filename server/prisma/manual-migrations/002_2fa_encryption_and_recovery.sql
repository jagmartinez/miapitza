-- Migration: 002_2fa_encryption_and_recovery
-- Description: Adds recovery codes for 2FA and prepares for secret encryption.
--
-- Changes:
--   User table:
--     - twoFactorRecoveryCodes: JSON field storing hashed recovery codes
--     - twoFactorEnabledAt: tracks when 2FA was enabled
--
--   AuditLog: already exists in schema for tracking 2FA events
--
-- IMPORTANT: After running this migration, run the encryption script
-- (server/src/scripts/encrypt-2fa-secrets.ts) to encrypt existing
-- twoFactorSecret values. The application code must be updated to
-- decrypt secrets before TOTP validation.
--
-- Rollback: See 002_2fa_encryption_and_recovery_rollback.sql

-- Add recovery codes column (stores JSON array of bcrypt-hashed codes)
ALTER TABLE `User`
  ADD COLUMN `twoFactorRecoveryCodes` JSON NULL AFTER `twoFactorEnabled`;

-- Track when 2FA was enabled for audit purposes
ALTER TABLE `User`
  ADD COLUMN `twoFactorEnabledAt` DATETIME(3) NULL AFTER `twoFactorRecoveryCodes`;

-- Backfill twoFactorEnabledAt for users who already have 2FA enabled
UPDATE `User`
  SET `twoFactorEnabledAt` = `updatedAt`
  WHERE `twoFactorEnabled` = true AND `twoFactorEnabledAt` IS NULL;
