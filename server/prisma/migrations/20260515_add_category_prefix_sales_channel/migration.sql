-- Phase 2: Add codePrefix to Category for auto-generating product SKU
ALTER TABLE `Category` ADD COLUMN `codePrefix` VARCHAR(10) NULL;
ALTER TABLE `Category` ADD UNIQUE INDEX `Category_companyId_codePrefix_key`(`companyId`, `codePrefix`);

-- Phase 11: Add SalesChannel enum and fields to Order
-- MySQL doesn't support ALTER TYPE, so we add the column directly
ALTER TABLE `Order` ADD COLUMN `salesChannel` ENUM('RESTAURANT', 'DELIVERY', 'PEDIDOSYA') NOT NULL DEFAULT 'RESTAURANT';
ALTER TABLE `Order` ADD COLUMN `channelCommission` DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE `Order` ADD COLUMN `channelMarkup` DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Backfill: set existing DELIVERY orders to DELIVERY channel
UPDATE `Order` SET `salesChannel` = 'DELIVERY' WHERE `orderType` = 'DELIVERY';

-- Backfill: detect PedidosYa orders from customerName tag
UPDATE `Order` SET `salesChannel` = 'PEDIDOSYA' WHERE `customerName` LIKE '%[PEDIDOSYA]%';

-- Phase 11: SalesChannelConfig table for configurable commission/markup
CREATE TABLE `SalesChannelConfig` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `companyId` INT NOT NULL,
    `channel` ENUM('RESTAURANT', 'DELIVERY', 'PEDIDOSYA') NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `priceMarkupPct` DECIMAL(5,2) NOT NULL DEFAULT 0,
    `commissionPct` DECIMAL(5,2) NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SalesChannelConfig_companyId_channel_key`(`companyId`, `channel`),
    INDEX `SalesChannelConfig_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `SalesChannelConfig_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
