-- Partial receipts for purchase orders.
--  * PurchaseOrderItem.receivedQuantity tracks what was received per line (in
--    the line's purchase unit).
--  * PurchaseOrder.receivedTotal is the received value; payables and the
--    implicit CASH settlement follow it instead of the ordered total.
--  * PARTIALLY_RECEIVED status, and "cerrar saldo" audit columns.
--  * PurchaseOrderReceipt / PurchaseOrderReceiptLine record each physical
--    receipt (unique reference + idempotency key per order).

ALTER TABLE `PurchaseOrder`
    MODIFY `status` ENUM('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN `receivedTotal` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `receivingClosedAt` DATETIME(3) NULL,
    ADD COLUMN `receivingClosedById` INTEGER NULL,
    ADD COLUMN `receivingCloseReason` VARCHAR(500) NULL;

ALTER TABLE `PurchaseOrderItem`
    ADD COLUMN `receivedQuantity` DECIMAL(18, 6) NOT NULL DEFAULT 0;

-- Historical receipts were always complete: every line was received in full
-- and the received value equals the order total. Legacy receipts keep their
-- `PO-{id}` movement reference; the reversal path still recognises it.
UPDATE `PurchaseOrderItem` poi
    INNER JOIN `PurchaseOrder` po ON po.`id` = poi.`purchaseOrderId`
    SET poi.`receivedQuantity` = poi.`quantity`
    WHERE po.`status` = 'RECEIVED';

UPDATE `PurchaseOrder`
    SET `receivedTotal` = `total`
    WHERE `status` = 'RECEIVED';

CREATE TABLE `PurchaseOrderReceipt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `purchaseOrderId` INTEGER NOT NULL,
    `warehouseId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `sequence` INTEGER NOT NULL,
    `reference` VARCHAR(64) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `totalValue` DECIMAL(18, 6) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reversedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PurchaseOrderReceipt_companyId_reference_key`(`companyId`, `reference`),
    UNIQUE INDEX `PurchaseOrderReceipt_purchaseOrderId_idempotencyKey_key`(`purchaseOrderId`, `idempotencyKey`),
    UNIQUE INDEX `PurchaseOrderReceipt_purchaseOrderId_sequence_key`(`purchaseOrderId`, `sequence`),
    INDEX `PurchaseOrderReceipt_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseOrderReceiptLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptId` INTEGER NOT NULL,
    `purchaseOrderItemId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `quantity` DECIMAL(18, 6) NOT NULL,
    `baseQuantity` DECIMAL(18, 6) NOT NULL,
    `baseUnitCost` DECIMAL(18, 6) NOT NULL,
    `totalCost` DECIMAL(18, 6) NOT NULL,
    `inventoryMovementId` INTEGER NULL,

    INDEX `PurchaseOrderReceiptLine_receiptId_idx`(`receiptId`),
    INDEX `PurchaseOrderReceiptLine_purchaseOrderItemId_idx`(`purchaseOrderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PurchaseOrderReceipt`
    ADD CONSTRAINT `PurchaseOrderReceipt_purchaseOrderId_fkey`
    FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PurchaseOrderReceiptLine`
    ADD CONSTRAINT `PurchaseOrderReceiptLine_receiptId_fkey`
    FOREIGN KEY (`receiptId`) REFERENCES `PurchaseOrderReceipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PurchaseOrderReceiptLine`
    ADD CONSTRAINT `PurchaseOrderReceiptLine_purchaseOrderItemId_fkey`
    FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `PurchaseOrderItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
