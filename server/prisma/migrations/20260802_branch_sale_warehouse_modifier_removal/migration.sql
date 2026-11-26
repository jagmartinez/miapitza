-- 1. Default sale warehouse per branch (auto-delivery + POS availability).
--    Nullable: null keeps the legacy "single BRANCH warehouse" rule. The
--    application validates that it is a BRANCH warehouse of the same branch
--    and company; deleting the warehouse clears the default.
ALTER TABLE `Branch`
    ADD COLUMN `defaultSaleWarehouseId` INTEGER NULL;

CREATE INDEX `Branch_defaultSaleWarehouseId_idx` ON `Branch`(`defaultSaleWarehouseId`);

ALTER TABLE `Branch`
    ADD CONSTRAINT `Branch_defaultSaleWarehouseId_fkey`
    FOREIGN KEY (`defaultSaleWarehouseId`) REFERENCES `Warehouse`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. "Sin X" modifiers: REMOVE reduces/drops the dish's recipe line of the
--    linked product instead of consuming extra stock. Existing rows keep ADD.
ALTER TABLE `Modifier`
    ADD COLUMN `inventoryEffect` ENUM('ADD', 'REMOVE') NOT NULL DEFAULT 'ADD';
