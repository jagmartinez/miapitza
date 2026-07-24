-- Shared login lockout state: every replica observes and updates the same row.
CREATE TABLE `LoginAttempt` (
    `userId` INTEGER NOT NULL,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LoginAttempt_lockedUntil_idx`(`lockedUntil`),
    INDEX `LoginAttempt_lastAttemptAt_idx`(`lastAttemptAt`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Durable filesystem cleanup/reservation outbox. The unique business key makes
-- retries idempotent and prevents duplicate cleanup work across replicas.
CREATE TABLE `FileCleanupTask` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` INTEGER NOT NULL,
    `area` ENUM('INVOICE', 'LOGO', 'HR_DOCUMENT') NOT NULL,
    `storageKey` VARCHAR(500) NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'FAILED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `reason` VARCHAR(100) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `claimToken` VARCHAR(36) NULL,
    `lastError` VARCHAR(1000) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FileCleanupTask_companyId_area_storageKey_key`(`companyId`, `area`, `storageKey`),
    INDEX `FileCleanupTask_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `FileCleanupTask_leaseUntil_idx`(`leaseUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `LoginAttempt`
    ADD CONSTRAINT `LoginAttempt_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `FileCleanupTask`
    ADD CONSTRAINT `FileCleanupTask_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
