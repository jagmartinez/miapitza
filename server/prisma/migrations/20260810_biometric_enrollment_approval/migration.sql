-- HR approval of the first facial (biometric) enrollment.
--
-- Business rule: the first enrollment of an employee is approved by HR; after
-- that the employee re-enrolls and punches without approval. A profile whose
-- `approvedAt` is NULL and status PENDING cannot be used to punch.
-- `approvedAt`/`approvedByUserId` are cleared when HR revokes or rejects the
-- profile, so the next enrollment needs a new approval. Self-revocation and
-- retention expiry keep the approval.
ALTER TABLE `BiometricProfile`
    ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedByUserId` INTEGER NULL;

-- Backfill: every profile enrolled before this rule was self-approved. Keep
-- current ACTIVE profiles working (nobody is locked out) and let employees who
-- revoked their own profile, or whose retention expired, re-enroll without
-- approval. Owner revocations and terminations require a new HR approval.
UPDATE `BiometricProfile`
SET `approvedAt` = COALESCE(`enrolledAt`, `consentedAt`)
WHERE `approvedAt` IS NULL
  AND (
    `status` = 'ACTIVE'
    OR (`status` = 'REVOKED' AND `revocationReason` IN ('SELF_REVOKED', 'RETENTION_EXPIRED'))
  );
