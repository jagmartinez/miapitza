-- Add invoice/payment fields to PurchaseOrder
ALTER TABLE `PurchaseOrder` ADD COLUMN `invoiceDate` DATETIME(3) NULL;
ALTER TABLE `PurchaseOrder` ADD COLUMN `invoiceType` ENUM('CASH', 'CREDIT') NOT NULL DEFAULT 'CASH';
ALTER TABLE `PurchaseOrder` ADD COLUMN `paymentDueDate` DATETIME(3) NULL;
ALTER TABLE `PurchaseOrder` ADD COLUMN `bank` VARCHAR(191) NULL;
ALTER TABLE `PurchaseOrder` ADD COLUMN `transferNumber` VARCHAR(191) NULL;
ALTER TABLE `PurchaseOrder` ADD COLUMN `paidAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE `PurchaseOrder` ADD COLUMN `paymentStatus` ENUM('PENDING', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'PENDING';

-- Create PurchaseOrderPayment table for tracking partial payments
CREATE TABLE `PurchaseOrderPayment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchaseOrderId` INTEGER NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `bank` VARCHAR(191) NULL,
    `referenceNumber` VARCHAR(191) NULL,
    `observations` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PurchaseOrderPayment_purchaseOrderId_idx`(`purchaseOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add foreign key
ALTER TABLE `PurchaseOrderPayment` ADD CONSTRAINT `PurchaseOrderPayment_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
