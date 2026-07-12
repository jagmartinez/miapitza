ALTER TABLE `Payment`
    ADD COLUMN `status` ENUM('ACTIVE', 'REVERSED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `reversedAt` DATETIME(3) NULL,
    ADD COLUMN `reversedById` INTEGER NULL,
    ADD COLUMN `reversalReason` VARCHAR(191) NULL;

CREATE INDEX `Payment_status_createdAt_idx` ON `Payment`(`status`, `createdAt`);
