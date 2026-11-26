-- Blind inventory count (Android app, phase 5b): count sheet + lines and the
-- `inventory.count` permission. Additive only. One open (DRAFT/SUBMITTED) sheet
-- per warehouse is enforced by the UNIQUE index on `openWarehouseId`, which the
-- application sets to the warehouse id while open and NULLs when closed.
CREATE TABLE `InventoryCountSheet` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `companyId` INTEGER NOT NULL,
  `branchId` INTEGER NULL,
  `warehouseId` INTEGER NOT NULL,
  `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
  `scopeCategoryIds` JSON NULL,
  `openWarehouseId` INTEGER NULL,
  `startedById` INTEGER NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `submittedById` INTEGER NULL,
  `submittedAt` DATETIME(3) NULL,
  `returnedAt` DATETIME(3) NULL,
  `returnNote` VARCHAR(500) NULL,
  `approvedById` INTEGER NULL,
  `approvedAt` DATETIME(3) NULL,
  `rejectedById` INTEGER NULL,
  `rejectedAt` DATETIME(3) NULL,
  `rejectReason` VARCHAR(500) NULL,

  UNIQUE INDEX `InventoryCountSheet_openWarehouseId_key` (`openWarehouseId`),
  INDEX `InventoryCountSheet_companyId_branchId_status_idx` (`companyId`, `branchId`, `status`),
  INDEX `InventoryCountSheet_warehouseId_status_idx` (`warehouseId`, `status`),
  INDEX `InventoryCountSheet_startedById_idx` (`startedById`),
  INDEX `InventoryCountSheet_submittedById_idx` (`submittedById`),
  INDEX `InventoryCountSheet_approvedById_idx` (`approvedById`),
  INDEX `InventoryCountSheet_rejectedById_idx` (`rejectedById`),
  INDEX `InventoryCountSheet_branchId_idx` (`branchId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `InventoryCountSheet_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `InventoryCountSheet_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `InventoryCountSheet_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `InventoryCountSheet_startedById_fkey` FOREIGN KEY (`startedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `InventoryCountSheet_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `InventoryCountSheet_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `InventoryCountSheet_rejectedById_fkey` FOREIGN KEY (`rejectedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InventoryCountLine` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `sheetId` INTEGER NOT NULL,
  `productId` INTEGER NOT NULL,
  `categoryId` INTEGER NULL,
  `unit` VARCHAR(20) NULL,
  `countedQuantity` DECIMAL(18, 6) NULL,
  `countedBaseQuantity` DECIMAL(18, 6) NULL,
  `expectedAtCount` DECIMAL(18, 6) NULL,
  `clientCountedAt` DATETIME(3) NULL,
  `countedById` INTEGER NULL,
  `countedAt` DATETIME(3) NULL,
  `notCounted` BOOLEAN NOT NULL DEFAULT false,
  `recountRequested` BOOLEAN NOT NULL DEFAULT false,
  `previousCountedBase` DECIMAL(18, 6) NULL,
  `movementId` INTEGER NULL,
  `adjustmentValue` DECIMAL(18, 2) NULL,

  UNIQUE INDEX `InventoryCountLine_sheetId_productId_key` (`sheetId`, `productId`),
  INDEX `InventoryCountLine_productId_idx` (`productId`),
  INDEX `InventoryCountLine_categoryId_idx` (`categoryId`),
  INDEX `InventoryCountLine_countedById_idx` (`countedById`),
  INDEX `InventoryCountLine_movementId_idx` (`movementId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `InventoryCountLine_sheetId_fkey` FOREIGN KEY (`sheetId`) REFERENCES `InventoryCountSheet` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `InventoryCountLine_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `InventoryCountLine_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `InventoryCountLine_countedById_fkey` FOREIGN KEY (`countedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `InventoryCountLine_movementId_fkey` FOREIGN KEY (`movementId`) REFERENCES `InventoryMovement` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `Permission` (`name`, `description`) VALUES
  ('inventory.count', 'Realizar conteos ciegos de inventario');

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r ON r.`name` IN ('SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF')
WHERE p.`name` = 'inventory.count';
