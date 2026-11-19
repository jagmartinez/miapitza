-- Per-ingredient warehouse routing for sale consumption.
--
-- A branch can route the consumption of an inventory product (or of every
-- product of a category) to one of its own BRANCH warehouses, e.g. drinks from
-- "Bodega Barra" and food from "Cocina". Lines without a rule keep consuming
-- from the order's sale warehouse. A product rule wins over a category rule.
-- Exactly one of categoryId/productId is set (enforced by the service).
CREATE TABLE `InventoryWarehouseRoute` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `warehouseId` INTEGER NOT NULL,
    `categoryId` INTEGER NULL,
    `productId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InvWarehouseRoute_branch_category_key`(`branchId`, `categoryId`),
    UNIQUE INDEX `InvWarehouseRoute_branch_product_key`(`branchId`, `productId`),
    INDEX `InvWarehouseRoute_company_branch_idx`(`companyId`, `branchId`),
    INDEX `InvWarehouseRoute_warehouse_idx`(`warehouseId`),
    INDEX `InvWarehouseRoute_category_idx`(`categoryId`),
    INDEX `InvWarehouseRoute_product_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `InventoryWarehouseRoute` ADD CONSTRAINT `InventoryWarehouseRoute_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InventoryWarehouseRoute` ADD CONSTRAINT `InventoryWarehouseRoute_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InventoryWarehouseRoute` ADD CONSTRAINT `InventoryWarehouseRoute_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InventoryWarehouseRoute` ADD CONSTRAINT `InventoryWarehouseRoute_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
