-- Rollback for 20260810_biometric_enrollment_approval.
-- Run only after deploying code that no longer reads approvedAt. PENDING
-- profiles awaiting HR approval stay PENDING (they cannot punch); approve them
-- first or have the employees re-enroll after the rollback.
ALTER TABLE `BiometricProfile`
    DROP COLUMN `approvedByUserId`,
    DROP COLUMN `approvedAt`;
