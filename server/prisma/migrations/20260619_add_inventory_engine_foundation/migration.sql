-- ============================================================================
-- Inventory engine foundation (additive only — no existing data is modified):
--   1. ProductCostHistory.productionOrderId  -> enables exact cost reversal when
--      a finished production order is cancelled (#1).
--   2. Modifier inventory link (productId/consumeQuantity/unitId) -> lets a
--      selected modifier consume ingredients at sale time (#2).
--   3. InventoryBatch -> FIFO cost layers per (warehouse, product) (#3).
--   4. Stock.warehouseId index (#4).
-- ============================================================================

-- 1. ProductCostHistory -> ProductionOrder link
ALTER TABLE `ProductCostHistory` ADD COLUMN `productionOrderId` INTEGER NULL;
CREATE INDEX `ProductCostHistory_productionOrderId_idx` ON `ProductCostHistory`(`productionOrderId`);
ALTER TABLE `ProductCostHistory`
    ADD CONSTRAINT `ProductCostHistory_productionOrderId_fkey` FOREIGN KEY (`productionOrderId`) REFERENCES `ProductionOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Modifier inventory consumption link
ALTER TABLE `Modifier` ADD COLUMN `productId` INTEGER NULL;
ALTER TABLE `Modifier` ADD COLUMN `consumeQuantity` DECIMAL(10, 3) NULL;
ALTER TABLE `Modifier` ADD COLUMN `unitId` INTEGER NULL;
CREATE INDEX `Modifier_productId_idx` ON `Modifier`(`productId`);
CREATE INDEX `Modifier_unitId_idx` ON `Modifier`(`unitId`);
ALTER TABLE `Modifier`
    ADD CONSTRAINT `Modifier_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `Modifier_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `UnitOfMeasure`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. InventoryBatch (FIFO cost layers)
CREATE TABLE `InventoryBatch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `warehouseId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `unitCost` DECIMAL(18, 6) NOT NULL,
    `originalQty` DECIMAL(18, 6) NOT NULL,
    `remainingQty` DECIMAL(18, 6) NOT NULL,
    `sourceType` VARCHAR(191) NOT NULL,
    `sourceRef` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InventoryBatch_companyId_productId_warehouseId_createdAt_idx`(`companyId`, `productId`, `warehouseId`, `createdAt`),
    INDEX `InventoryBatch_warehouseId_productId_idx`(`warehouseId`, `productId`),
    INDEX `InventoryBatch_remainingQty_idx`(`remainingQty`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `InventoryBatch`
    ADD CONSTRAINT `InventoryBatch_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryBatch_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryBatch_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Stock per-warehouse index
CREATE INDEX `Stock_warehouseId_idx` ON `Stock`(`warehouseId`);
