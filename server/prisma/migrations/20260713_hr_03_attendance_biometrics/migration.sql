-- HR attendance and biometric verification foundation. Additive only.

CREATE TABLE `AttendancePolicy` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NULL,
    `scopeKey` VARCHAR(64) NOT NULL,
    `currentKey` VARCHAR(64) NULL,
    `version` INTEGER NOT NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `requireBiometric` BOOLEAN NOT NULL DEFAULT true,
    `requireLiveness` BOOLEAN NOT NULL DEFAULT true,
    `requireGeolocation` BOOLEAN NOT NULL DEFAULT true,
    `maxLocationAccuracyM` INTEGER NOT NULL DEFAULT 50,
    `earlyCheckInMinutes` INTEGER NOT NULL DEFAULT 60,
    `lateCheckInToleranceM` INTEGER NOT NULL DEFAULT 10,
    `earlyCheckOutToleranceM` INTEGER NOT NULL DEFAULT 15,
    `lateCheckOutMinutes` INTEGER NOT NULL DEFAULT 240,
    `scheduleViolationMode` ENUM('BLOCK','REVIEW','WARN') NOT NULL DEFAULT 'REVIEW',
    `geofenceViolationMode` ENUM('BLOCK','REVIEW','WARN') NOT NULL DEFAULT 'BLOCK',
    `biometricViolationMode` ENUM('BLOCK','REVIEW','WARN') NOT NULL DEFAULT 'BLOCK',
    `allowUnscheduledPunch` BOOLEAN NOT NULL DEFAULT false,
    `unscheduledViolationMode` ENUM('BLOCK','REVIEW','WARN') NOT NULL DEFAULT 'REVIEW',
    `allowManualFallback` BOOLEAN NOT NULL DEFAULT true,
    `biometricConsentVersion` VARCHAR(64) NOT NULL,
    `biometricRetentionDays` INTEGER NOT NULL DEFAULT 365,
    `biometricRetentionNotice` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `supersededAt` DATETIME(3) NULL,
    UNIQUE INDEX `AttendancePolicy_companyId_scopeKey_version_key`(`companyId`,`scopeKey`,`version`),
    UNIQUE INDEX `AttendancePolicy_companyId_currentKey_key`(`companyId`,`currentKey`),
    INDEX `AttendancePolicy_companyId_branchId_active_idx`(`companyId`,`branchId`,`active`),
    INDEX `AttendancePolicy_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BiometricProfile` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `status` ENUM('PENDING','ACTIVE','REVOKED') NOT NULL DEFAULT 'PENDING',
    `consentVersion` VARCHAR(64) NOT NULL,
    `consentedAt` DATETIME(3) NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `model` VARCHAR(128) NOT NULL,
    `templateRef` TEXT NOT NULL,
    `enrolledAt` DATETIME(3) NULL,
    `retentionExpiresAt` DATETIME(3) NULL,
    `purgeRequestedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `revocationReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `BiometricProfile_userId_key`(`userId`),
    INDEX `BiometricProfile_companyId_status_idx`(`companyId`,`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BiometricPurgeRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `biometricProfileId` INTEGER NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `encryptedTemplateRef` TEXT NOT NULL,
    `reason` VARCHAR(64) NOT NULL,
    `status` ENUM('PENDING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    INDEX `BiometricPurgeRequest_companyId_status_nextAttemptAt_idx`(`companyId`,`status`,`nextAttemptAt`),
    INDEX `BiometricPurgeRequest_biometricProfileId_createdAt_idx`(`biometricProfileId`,`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BiometricChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `purpose` ENUM('ATTENDANCE_PUNCH','BIOMETRIC_ENROLLMENT') NOT NULL,
    `action` ENUM('CHECK_IN','BREAK_START','BREAK_END','CHECK_OUT') NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `nonce` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `usedByKey` VARCHAR(128) NULL,
    `usedRequestHash` VARCHAR(64) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `BiometricChallenge_companyId_userId_purpose_expiresAt_idx`(`companyId`,`userId`,`purpose`,`expiresAt`),
    INDEX `BiometricChallenge_expiresAt_usedAt_idx`(`expiresAt`,`usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AttendanceDevice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `keyHash` VARCHAR(64) NOT NULL,
    `status` ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `createdById` INTEGER NOT NULL,
    `revokedById` INTEGER NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `AttendanceDevice_companyId_code_key`(`companyId`,`code`),
    INDEX `AttendanceDevice_companyId_branchId_status_idx`(`companyId`,`branchId`,`status`),
    INDEX `AttendanceDevice_createdById_idx`(`createdById`),
    INDEX `AttendanceDevice_revokedById_idx`(`revokedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AttendanceEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `actorUserId` INTEGER NULL,
    `branchId` INTEGER NULL,
    `scheduledShiftId` INTEGER NULL,
    `geofenceVersionId` INTEGER NULL,
    `policyId` INTEGER NULL,
    `policyVersion` INTEGER NULL,
    `biometricProfileId` INTEGER NULL,
    `challengeId` VARCHAR(191) NULL,
    `deviceId` INTEGER NULL,
    `adjustsEventId` INTEGER NULL,
    `idempotencyKey` VARCHAR(128) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `sessionKey` VARCHAR(191) NULL,
    `sequenceKey` VARCHAR(191) NULL,
    `action` ENUM('CHECK_IN','BREAK_START','BREAK_END','CHECK_OUT') NOT NULL,
    `source` ENUM('SELF','KIOSK','MANUAL') NOT NULL,
    `serverAt` DATETIME(3) NOT NULL,
    `clientAt` DATETIME(3) NULL,
    `latitude` DECIMAL(10,7) NULL,
    `longitude` DECIMAL(10,7) NULL,
    `locationAccuracyM` DECIMAL(10,2) NULL,
    `distanceM` DECIMAL(10,2) NULL,
    `faceStatus` ENUM('PASSED','FAILED','REVIEW','NOT_REQUIRED','ERROR') NOT NULL DEFAULT 'NOT_REQUIRED',
    `livenessStatus` ENUM('PASSED','FAILED','REVIEW','NOT_REQUIRED','ERROR') NOT NULL DEFAULT 'NOT_REQUIRED',
    `providerStatus` VARCHAR(64) NULL,
    `providerScore` DECIMAL(6,5) NULL,
    `decision` ENUM('ACCEPTED','REVIEW','REJECTED') NOT NULL,
    `reasonCode` VARCHAR(64) NULL,
    `reasonCodes` JSON NOT NULL,
    `message` TEXT NULL,
    `checks` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `AttendanceEvent_challengeId_key`(`challengeId`),
    UNIQUE INDEX `AttendanceEvent_companyId_idempotencyKey_key`(`companyId`,`idempotencyKey`),
    UNIQUE INDEX `AttendanceEvent_companyId_sequenceKey_key`(`companyId`,`sequenceKey`),
    INDEX `AttendanceEvent_companyId_userId_serverAt_idx`(`companyId`,`userId`,`serverAt`),
    INDEX `AttendanceEvent_companyId_branchId_serverAt_idx`(`companyId`,`branchId`,`serverAt`),
    INDEX `AttendanceEvent_companyId_userId_sessionKey_serverAt_idx`(`companyId`,`userId`,`sessionKey`,`serverAt`),
    INDEX `AttendanceEvent_scheduledShiftId_idx`(`scheduledShiftId`),
    INDEX `AttendanceEvent_geofenceVersionId_idx`(`geofenceVersionId`),
    INDEX `AttendanceEvent_decision_serverAt_idx`(`decision`,`serverAt`),
    INDEX `AttendanceEvent_actorUserId_idx`(`actorUserId`),
    INDEX `AttendanceEvent_deviceId_idx`(`deviceId`),
    INDEX `AttendanceEvent_adjustsEventId_idx`(`adjustsEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AttendancePunchRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `idempotencyKey` VARCHAR(128) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `challengeId` VARCHAR(191) NOT NULL,
    `status` ENUM('PROCESSING','COMPLETED') NOT NULL DEFAULT 'PROCESSING',
    `leaseExpiresAt` DATETIME(3) NOT NULL,
    `eventId` INTEGER NULL,
    `attempts` INTEGER NOT NULL DEFAULT 1,
    `lastError` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `AttendancePunchRequest_eventId_key`(`eventId`),
    UNIQUE INDEX `AttendancePunchRequest_companyId_idempotencyKey_key`(`companyId`,`idempotencyKey`),
    INDEX `AttendancePunchRequest_companyId_status_leaseExpiresAt_idx`(`companyId`,`status`,`leaseExpiresAt`),
    INDEX `AttendancePunchRequest_userId_createdAt_idx`(`userId`,`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AttendanceReview` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `attendanceEventId` INTEGER NOT NULL,
    `reviewerId` INTEGER NOT NULL,
    `decision` ENUM('APPROVED','REJECTED') NOT NULL,
    `reason` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `AttendanceReview_attendanceEventId_key`(`attendanceEventId`),
    INDEX `AttendanceReview_companyId_createdAt_idx`(`companyId`,`createdAt`),
    INDEX `AttendanceReview_reviewerId_idx`(`reviewerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AttendancePolicy` ADD CONSTRAINT `AttendancePolicy_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendancePolicy` ADD CONSTRAINT `AttendancePolicy_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendancePolicy` ADD CONSTRAINT `AttendancePolicy_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BiometricProfile` ADD CONSTRAINT `BiometricProfile_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BiometricProfile` ADD CONSTRAINT `BiometricProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BiometricPurgeRequest` ADD CONSTRAINT `BiometricPurgeRequest_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BiometricPurgeRequest` ADD CONSTRAINT `BiometricPurgeRequest_biometricProfileId_fkey` FOREIGN KEY (`biometricProfileId`) REFERENCES `BiometricProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BiometricChallenge` ADD CONSTRAINT `BiometricChallenge_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BiometricChallenge` ADD CONSTRAINT `BiometricChallenge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceDevice` ADD CONSTRAINT `AttendanceDevice_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceDevice` ADD CONSTRAINT `AttendanceDevice_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceDevice` ADD CONSTRAINT `AttendanceDevice_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceDevice` ADD CONSTRAINT `AttendanceDevice_revokedById_fkey` FOREIGN KEY (`revokedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceEvent` ADD CONSTRAINT `AttendanceEvent_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceEvent` ADD CONSTRAINT `AttendanceEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceEvent` ADD CONSTRAINT `AttendanceEvent_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceEvent` ADD CONSTRAINT `AttendanceEvent_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceEvent` ADD CONSTRAINT `AttendanceEvent_scheduledShiftId_fkey` FOREIGN KEY (`scheduledShiftId`) REFERENCES `ScheduledShift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceEvent` ADD CONSTRAINT `AttendanceEvent_geofenceVersionId_fkey` FOREIGN KEY (`geofenceVersionId`) REFERENCES `BranchGeofenceVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceEvent` ADD CONSTRAINT `AttendanceEvent_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `AttendancePolicy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceEvent` ADD CONSTRAINT `AttendanceEvent_biometricProfileId_fkey` FOREIGN KEY (`biometricProfileId`) REFERENCES `BiometricProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceEvent` ADD CONSTRAINT `AttendanceEvent_challengeId_fkey` FOREIGN KEY (`challengeId`) REFERENCES `BiometricChallenge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceEvent` ADD CONSTRAINT `AttendanceEvent_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `AttendanceDevice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceEvent` ADD CONSTRAINT `AttendanceEvent_adjustsEventId_fkey` FOREIGN KEY (`adjustsEventId`) REFERENCES `AttendanceEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendancePunchRequest` ADD CONSTRAINT `AttendancePunchRequest_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendancePunchRequest` ADD CONSTRAINT `AttendancePunchRequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendancePunchRequest` ADD CONSTRAINT `AttendancePunchRequest_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `AttendanceEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceReview` ADD CONSTRAINT `AttendanceReview_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceReview` ADD CONSTRAINT `AttendanceReview_attendanceEventId_fkey` FOREIGN KEY (`attendanceEventId`) REFERENCES `AttendanceEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceReview` ADD CONSTRAINT `AttendanceReview_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER `AttendanceEvent_prevent_update`
BEFORE UPDATE ON `AttendanceEvent`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AttendanceEvent is immutable';

CREATE TRIGGER `AttendanceEvent_prevent_delete`
BEFORE DELETE ON `AttendanceEvent`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AttendanceEvent is immutable';
