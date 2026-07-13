CREATE TABLE `BankDeposit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `bankAccount` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'REVERSED') NOT NULL DEFAULT 'ACTIVE',
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reversedAt` DATETIME(3) NULL,
    `reversedById` INTEGER NULL,
    `reversalReason` VARCHAR(191) NULL,

    UNIQUE INDEX `BankDeposit_companyId_reference_key`(`companyId`, `reference`),
    INDEX `BankDeposit_companyId_date_idx`(`companyId`, `date`),
    INDEX `BankDeposit_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BankDepositShift` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `depositId` INTEGER NOT NULL,
    `shiftId` INTEGER NOT NULL,

    UNIQUE INDEX `BankDepositShift_depositId_shiftId_key`(`depositId`, `shiftId`),
    INDEX `BankDepositShift_shiftId_idx`(`shiftId`),
    INDEX `BankDepositShift_depositId_idx`(`depositId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BankDeposit` ADD CONSTRAINT `BankDeposit_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BankDeposit` ADD CONSTRAINT `BankDeposit_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BankDeposit` ADD CONSTRAINT `BankDeposit_reversedById_fkey` FOREIGN KEY (`reversedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `BankDepositShift` ADD CONSTRAINT `BankDepositShift_depositId_fkey` FOREIGN KEY (`depositId`) REFERENCES `BankDeposit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BankDepositShift` ADD CONSTRAINT `BankDepositShift_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `CashShift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
