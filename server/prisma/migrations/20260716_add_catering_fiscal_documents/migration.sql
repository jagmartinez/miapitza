-- Additive fiscal document model for Catering. Existing events remain valid;
-- they simply have no fiscal document until explicitly issued.
ALTER TABLE `CateringEvent`
    ADD COLUMN `fiscalSubtotal` DECIMAL(10, 2) NULL,
    ADD COLUMN `fiscalTax` DECIMAL(10, 2) NULL,
    ADD COLUMN `fiscalTaxRatePercent` DECIMAL(7, 4) NULL,
    ADD COLUMN `pricingSnapshotCapturedAt` DATETIME(3) NULL;

CREATE TABLE IF NOT EXISTS `CateringFiscalInvoice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `cateringEventId` INTEGER NOT NULL,
    `number` VARCHAR(80) NOT NULL,
    `status` ENUM('NOT_ISSUED', 'ISSUED', 'CREDITED', 'CANCELLED') NOT NULL DEFAULT 'ISSUED',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `subtotal` DECIMAL(10, 2) NOT NULL,
    `tax` DECIMAL(10, 2) NOT NULL,
    `total` DECIMAL(10, 2) NOT NULL,
    `snapshot` JSON NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `issuedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CateringFiscalInvoice_cateringEventId_key`(`cateringEventId`),
    UNIQUE INDEX `CateringFiscalInvoice_number_key`(`number`),
    UNIQUE INDEX `CateringFiscalInvoice_companyId_idempotencyKey_key`(`companyId`, `idempotencyKey`),
    INDEX `CateringFiscalInvoice_companyId_branchId_issuedAt_idx`(`companyId`, `branchId`, `issuedAt`),
    INDEX `CateringFiscalInvoice_issuedById_idx`(`issuedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `CateringFiscalCreditNote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `cateringEventId` INTEGER NOT NULL,
    `cateringFiscalInvoiceId` INTEGER NOT NULL,
    `number` VARCHAR(80) NOT NULL,
    `series` VARCHAR(20) NOT NULL,
    `sequenceNumber` INTEGER NOT NULL,
    `status` ENUM('ISSUED') NOT NULL DEFAULT 'ISSUED',
    `originalInvoiceNumber` VARCHAR(80) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `jurisdiction` VARCHAR(32) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `subtotal` DECIMAL(10, 2) NOT NULL,
    `tax` DECIMAL(10, 2) NOT NULL,
    `total` DECIMAL(10, 2) NOT NULL,
    `inventoryDisposition` ENUM('NOT_CONSUMED', 'NOT_RETURNED', 'RETURNED_TO_ORIGINAL_STOCK') NOT NULL,
    `snapshot` JSON NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `issuedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CateringFiscalCreditNote_cateringEventId_key`(`cateringEventId`),
    UNIQUE INDEX `CateringFiscalCreditNote_cateringFiscalInvoiceId_key`(`cateringFiscalInvoiceId`),
    UNIQUE INDEX `CateringFiscalCreditNote_number_key`(`number`),
    UNIQUE INDEX `CateringFiscalCreditNote_companyId_idempotencyKey_key`(`companyId`, `idempotencyKey`),
    UNIQUE INDEX `CateringFiscalCreditNote_company_branch_series_seq_key`(`companyId`, `branchId`, `series`, `sequenceNumber`),
    INDEX `CateringFiscalCreditNote_companyId_branchId_issuedAt_idx`(`companyId`, `branchId`, `issuedAt`),
    INDEX `CateringFiscalCreditNote_originalInvoiceNumber_idx`(`originalInvoiceNumber`),
    INDEX `CateringFiscalCreditNote_issuedById_idx`(`issuedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CateringFiscalInvoice`
    ADD CONSTRAINT `CateringFiscalInvoice_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `CateringFiscalInvoice_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `CateringFiscalInvoice_eventId_fkey` FOREIGN KEY (`cateringEventId`) REFERENCES `CateringEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `CateringFiscalInvoice_issuedById_fkey` FOREIGN KEY (`issuedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CateringFiscalCreditNote`
    ADD CONSTRAINT `CateringFiscalCreditNote_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `CateringFiscalCreditNote_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `CateringFiscalCreditNote_eventId_fkey` FOREIGN KEY (`cateringEventId`) REFERENCES `CateringEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `CateringFiscalCreditNote_invoiceId_fkey` FOREIGN KEY (`cateringFiscalInvoiceId`) REFERENCES `CateringFiscalInvoice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `CateringFiscalCreditNote_issuedById_fkey` FOREIGN KEY (`issuedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
