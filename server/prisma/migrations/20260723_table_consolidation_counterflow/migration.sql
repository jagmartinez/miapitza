-- Durable snapshots for reversible table-account consolidations.
-- Existing historical consolidations remain represented only by Order and
-- AuditLog provenance and are deliberately not backfilled speculatively.
CREATE TABLE `TableConsolidation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `primaryOrderId` INTEGER NOT NULL,
    `destinationTableId` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'REVERSED') NOT NULL DEFAULT 'ACTIVE',
    `version` INTEGER NOT NULL DEFAULT 0,
    `reason` VARCHAR(500) NULL,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reversedById` INTEGER NULL,
    `reversedAt` DATETIME(3) NULL,
    `reversalReason` VARCHAR(500) NULL,
    `reversalKey` VARCHAR(191) NULL,

    UNIQUE INDEX `TableConsolidation_companyId_reversalKey_key`(`companyId`, `reversalKey`),
    INDEX `TableConsolidation_companyId_primaryOrderId_status_idx`(`companyId`, `primaryOrderId`, `status`),
    INDEX `TableConsolidation_branchId_status_idx`(`branchId`, `status`),
    INDEX `TableConsolidation_destinationTableId_idx`(`destinationTableId`),
    INDEX `TableConsolidation_createdById_idx`(`createdById`),
    INDEX `TableConsolidation_reversedById_idx`(`reversedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TableConsolidationOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tableConsolidationId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `originalTableId` INTEGER NOT NULL,
    `isPrimary` BOOLEAN NOT NULL,
    `originalStatus` ENUM('OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'CANCELLED', 'DELIVERED') NOT NULL,
    `originalFinancialStatus` ENUM('UNPAID', 'PARTIAL', 'PAID') NOT NULL,
    `originalTotal` DECIMAL(10, 2) NOT NULL,
    `originalDiscount` DECIMAL(10, 2) NOT NULL,
    `originalTax` DECIMAL(10, 2) NOT NULL,
    `originalTipAmount` DECIMAL(10, 2) NOT NULL,
    `originalChannelCommission` DECIMAL(10, 2) NOT NULL,
    `originalChannelMarkup` DECIMAL(10, 2) NOT NULL,
    `originalConsolidatedIntoId` INTEGER NULL,
    `originalCancelledById` INTEGER NULL,
    `originalCancelledAt` DATETIME(3) NULL,
    `originalClosedAt` DATETIME(3) NULL,
    `originalCancelReason` VARCHAR(191) NULL,
    `postConsolidationUpdatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TableConsolidationOrder_tableConsolidationId_orderId_key`(`tableConsolidationId`, `orderId`),
    INDEX `TableConsolidationOrder_orderId_idx`(`orderId`),
    INDEX `TableConsolidationOrder_originalTableId_idx`(`originalTableId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TableConsolidationItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tableConsolidationId` INTEGER NOT NULL,
    `orderItemId` INTEGER NOT NULL,
    `sourceOrderId` INTEGER NOT NULL,
    `previousOriginOrderId` INTEGER NULL,
    `previousOriginTableId` INTEGER NULL,
    `itemFingerprint` CHAR(64) NOT NULL,

    UNIQUE INDEX `TableConsolidationItem_tableConsolidationId_orderItemId_key`(`tableConsolidationId`, `orderItemId`),
    INDEX `TableConsolidationItem_orderItemId_idx`(`orderItemId`),
    INDEX `TableConsolidationItem_sourceOrderId_idx`(`sourceOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TableConsolidation`
    ADD CONSTRAINT `TableConsolidation_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `TableConsolidation_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `TableConsolidation_primaryOrderId_fkey` FOREIGN KEY (`primaryOrderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `TableConsolidation_destinationTableId_fkey` FOREIGN KEY (`destinationTableId`) REFERENCES `Table`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `TableConsolidation_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `TableConsolidation_reversedById_fkey` FOREIGN KEY (`reversedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TableConsolidationOrder`
    ADD CONSTRAINT `TableConsolidationOrder_tableConsolidationId_fkey` FOREIGN KEY (`tableConsolidationId`) REFERENCES `TableConsolidation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `TableConsolidationOrder_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `TableConsolidationOrder_originalTableId_fkey` FOREIGN KEY (`originalTableId`) REFERENCES `Table`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TableConsolidationItem`
    ADD CONSTRAINT `TableConsolidationItem_tableConsolidationId_fkey` FOREIGN KEY (`tableConsolidationId`) REFERENCES `TableConsolidation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `TableConsolidationItem_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `TableConsolidationItem_sourceOrderId_fkey` FOREIGN KEY (`sourceOrderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
