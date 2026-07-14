CREATE TABLE `TableFloorPlan` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `companyId` INTEGER NOT NULL,
  `branchId` INTEGER NOT NULL,
  `canvasWidth` INTEGER NOT NULL DEFAULT 1600,
  `canvasHeight` INTEGER NOT NULL DEFAULT 1000,
  `version` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `TableFloorPlan_branchId_key` (`branchId`),
  INDEX `TableFloorPlan_companyId_idx` (`companyId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TableFloorPlan_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `TableFloorPlan_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FloorArea` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `floorPlanId` INTEGER NOT NULL,
  `companyId` INTEGER NOT NULL,
  `branchId` INTEGER NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `kind` ENUM('DINING', 'TERRACE', 'BAR', 'PRIVATE', 'TAKEAWAY', 'OTHER') NOT NULL DEFAULT 'DINING',
  `mapX` INTEGER NOT NULL DEFAULT 24,
  `mapY` INTEGER NOT NULL DEFAULT 24,
  `mapWidth` INTEGER NOT NULL DEFAULT 720,
  `mapHeight` INTEGER NOT NULL DEFAULT 480,
  `mapShape` ENUM('RECTANGLE', 'ROUNDED', 'OVAL', 'L_SHAPE') NOT NULL DEFAULT 'RECTANGLE',
  `mapRotation` INTEGER NOT NULL DEFAULT 0,
  `color` VARCHAR(16) NULL,
  `mapVersion` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `FloorArea_floorPlanId_name_key` (`floorPlanId`, `name`),
  INDEX `FloorArea_floorPlanId_idx` (`floorPlanId`),
  INDEX `FloorArea_companyId_idx` (`companyId`),
  INDEX `FloorArea_branchId_idx` (`branchId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `FloorArea_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `FloorArea_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `FloorArea_floorPlanId_fkey` FOREIGN KEY (`floorPlanId`) REFERENCES `TableFloorPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Table` ADD COLUMN `floorAreaId` INTEGER NULL;
CREATE INDEX `Table_floorAreaId_idx` ON `Table`(`floorAreaId`);
ALTER TABLE `Table` ADD CONSTRAINT `Table_floorAreaId_fkey` FOREIGN KEY (`floorAreaId`) REFERENCES `FloorArea`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `TableFloorPlan` (`companyId`, `branchId`, `canvasWidth`, `canvasHeight`, `version`, `createdAt`, `updatedAt`)
SELECT `companyId`, `id`, 1600, 1000, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3) FROM `Branch`;
