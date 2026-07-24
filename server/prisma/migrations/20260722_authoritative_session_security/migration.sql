-- Enforce the tenant-configured idle timeout on the authoritative server
-- session record. Existing sessions receive a conservative 30-minute timeout.
ALTER TABLE `UserSession`
    ADD COLUMN `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `idleTimeoutMinutes` INTEGER NOT NULL DEFAULT 30;
