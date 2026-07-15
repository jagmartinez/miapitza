-- Additive fiscal credit-note foundation. No jurisdiction, legal series or
-- numbering format is guessed here: issuance remains blocked until each tenant
-- explicitly configures `<companyId>_fiscal_jurisdiction` and
-- `<companyId>_credit_note_series`.

ALTER TABLE `Order`
    ADD COLUMN `customerTaxId` VARCHAR(100) NULL,
    ADD COLUMN `customerTaxIdType` VARCHAR(50) NULL,
    ADD COLUMN `customerFiscalAddress` TEXT NULL,
    ADD COLUMN `customerEmail` VARCHAR(191) NULL,
    ADD COLUMN `customerPhone` VARCHAR(50) NULL,
    ADD COLUMN `invoiceFiscalStatus` ENUM('NOT_ISSUED', 'ISSUED', 'CREDITED', 'CANCELLED') NOT NULL DEFAULT 'NOT_ISSUED';

UPDATE `Order`
SET `invoiceFiscalStatus` = 'ISSUED'
WHERE `invoiceNumber` IS NOT NULL;

ALTER TABLE `Payment`
    ADD COLUMN `refundReference` VARCHAR(191) NULL;

CREATE TABLE `CreditNoteSequence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `series` VARCHAR(20) NOT NULL,
    `lastNumber` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `CreditNoteSequence_companyId_series_key` (`companyId`, `series`),
    INDEX `CreditNoteSequence_companyId_idx` (`companyId`),
    CONSTRAINT `CreditNoteSequence_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FiscalCreditNote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `number` VARCHAR(80) NOT NULL,
    `series` VARCHAR(20) NOT NULL,
    `sequenceNumber` INTEGER NOT NULL,
    `status` ENUM('ISSUED') NOT NULL DEFAULT 'ISSUED',
    `originalInvoiceNumber` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `jurisdiction` VARCHAR(32) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `subtotal` DECIMAL(10, 2) NOT NULL,
    `tax` DECIMAL(10, 2) NOT NULL,
    `tipAmount` DECIMAL(10, 2) NOT NULL,
    `total` DECIMAL(10, 2) NOT NULL,
    `inventoryDisposition` ENUM('NOT_CONSUMED', 'NOT_RETURNED', 'RETURNED_TO_ORIGINAL_STOCK') NOT NULL,
    `wasteWarehouseId` INTEGER NULL,
    `snapshot` JSON NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `issuedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `FiscalCreditNote_orderId_key` (`orderId`),
    UNIQUE INDEX `FiscalCreditNote_number_key` (`number`),
    UNIQUE INDEX `FiscalCreditNote_companyId_idempotencyKey_key` (`companyId`, `idempotencyKey`),
    UNIQUE INDEX `FiscalCreditNote_companyId_branchId_series_sequenceNumber_key` (`companyId`, `branchId`, `series`, `sequenceNumber`),
    INDEX `FiscalCreditNote_companyId_branchId_issuedAt_idx` (`companyId`, `branchId`, `issuedAt`),
    INDEX `FiscalCreditNote_originalInvoiceNumber_idx` (`originalInvoiceNumber`),
    INDEX `FiscalCreditNote_issuedById_idx` (`issuedById`),
    CONSTRAINT `FiscalCreditNote_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalCreditNote_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalCreditNote_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalCreditNote_wasteWarehouseId_fkey` FOREIGN KEY (`wasteWarehouseId`) REFERENCES `Warehouse` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalCreditNote_issuedById_fkey` FOREIGN KEY (`issuedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalCreditNote_positive_sequence` CHECK (`sequenceNumber` > 0),
    CONSTRAINT `FiscalCreditNote_nonnegative_amounts` CHECK (`subtotal` >= 0 AND `tax` >= 0 AND `tipAmount` >= 0 AND `total` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FiscalInvoiceCancellation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `originalInvoiceNumber` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `jurisdiction` VARCHAR(32) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `wasteWarehouseId` INTEGER NULL,
    `snapshot` JSON NOT NULL,
    `cancelledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cancelledById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `FiscalInvoiceCancellation_orderId_key` (`orderId`),
    UNIQUE INDEX `FiscalInvoiceCancellation_companyId_idempotencyKey_key` (`companyId`, `idempotencyKey`),
    INDEX `FiscalInvoiceCancellation_companyId_branchId_cancelledAt_idx` (`companyId`, `branchId`, `cancelledAt`),
    INDEX `FiscalInvoiceCancellation_originalInvoiceNumber_idx` (`originalInvoiceNumber`),
    INDEX `FiscalInvoiceCancellation_cancelledById_idx` (`cancelledById`),
    CONSTRAINT `FiscalInvoiceCancellation_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalInvoiceCancellation_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalInvoiceCancellation_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalInvoiceCancellation_wasteWarehouseId_fkey` FOREIGN KEY (`wasteWarehouseId`) REFERENCES `Warehouse` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalInvoiceCancellation_cancelledById_fkey` FOREIGN KEY (`cancelledById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- This permission already exists in newer installations. Reassert it
-- idempotently and grant only administrators; cashiers never receive fiscal
-- cancellation authority by default.
INSERT IGNORE INTO `Permission` (`name`, `description`)
VALUES
    ('invoices.cancel', 'Anular una factura antes de su liquidacion y entrega'),
    ('invoices.credit', 'Emitir nota de credito sobre una venta entregada');

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE p.`name` IN ('invoices.cancel', 'invoices.credit')
  AND r.`name` IN ('SUPERADMIN', 'ADMIN');
