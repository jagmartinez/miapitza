-- ============================================================================
-- Production module: extends ProductType, adds production recipes (multi-level
-- BOM), production orders and their consumed/produced line items.
-- Additive only: no existing data is modified.
-- ============================================================================

-- 1. Extend ProductType enum with INTERMEDIATE (semielaborado) and PACKAGING (empaque)
ALTER TABLE `Product`
    MODIFY COLUMN `type` ENUM('INGREDIENT', 'PRODUCT_FOR_SALE', 'BOTH', 'INTERMEDIATE', 'PACKAGING') NOT NULL DEFAULT 'INGREDIENT';

-- 2. ProductionRecipe (cabecera de receta de producción, ligada a producto de salida)
CREATE TABLE `ProductionRecipe` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'DRAFT',
    `yieldQuantity` DECIMAL(18, 6) NOT NULL,
    `yieldUnitId` INTEGER NULL,
    `notes` TEXT NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductionRecipe_companyId_productId_version_key`(`companyId`, `productId`, `version`),
    INDEX `ProductionRecipe_companyId_idx`(`companyId`),
    INDEX `ProductionRecipe_productId_idx`(`productId`),
    INDEX `ProductionRecipe_companyId_status_idx`(`companyId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3. ProductionRecipeComponent (componentes/insumos de la receta)
CREATE TABLE `ProductionRecipeComponent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recipeId` INTEGER NOT NULL,
    `componentProductId` INTEGER NOT NULL,
    `quantity` DECIMAL(18, 6) NOT NULL,
    `unitId` INTEGER NULL,
    `unit` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,

    UNIQUE INDEX `ProductionRecipeComponent_recipeId_componentProductId_key`(`recipeId`, `componentProductId`),
    INDEX `ProductionRecipeComponent_recipeId_idx`(`recipeId`),
    INDEX `ProductionRecipeComponent_componentProductId_idx`(`componentProductId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4. ProductionOrder (orden de producción)
CREATE TABLE `ProductionOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `productId` INTEGER NOT NULL,
    `recipeId` INTEGER NULL,
    `warehouseId` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'PENDING', 'IN_PROGRESS', 'FINISHED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `plannedQuantity` DECIMAL(18, 6) NOT NULL,
    `producedQuantity` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `estimatedCost` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `estimatedUnitCost` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `realCost` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `realUnitCost` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `userId` INTEGER NOT NULL,
    `notes` TEXT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` INTEGER NULL,
    `cancelReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductionOrder_companyId_code_key`(`companyId`, `code`),
    INDEX `ProductionOrder_companyId_branchId_idx`(`companyId`, `branchId`),
    INDEX `ProductionOrder_companyId_status_idx`(`companyId`, `status`),
    INDEX `ProductionOrder_productId_idx`(`productId`),
    INDEX `ProductionOrder_recipeId_idx`(`recipeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 5. ProductionOrderItem (insumos requeridos y consumidos reales)
CREATE TABLE `ProductionOrderItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productionOrderId` INTEGER NOT NULL,
    `componentProductId` INTEGER NOT NULL,
    `requiredQuantity` DECIMAL(18, 6) NOT NULL,
    `consumedQuantity` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `unitId` INTEGER NULL,
    `unit` VARCHAR(191) NULL,
    `unitCost` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `totalCost` DECIMAL(18, 6) NOT NULL DEFAULT 0,

    INDEX `ProductionOrderItem_productionOrderId_idx`(`productionOrderId`),
    INDEX `ProductionOrderItem_componentProductId_idx`(`componentProductId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================================================
-- Foreign keys
-- ============================================================================

ALTER TABLE `ProductionRecipe`
    ADD CONSTRAINT `ProductionRecipe_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionRecipe_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionRecipe_yieldUnitId_fkey` FOREIGN KEY (`yieldUnitId`) REFERENCES `UnitOfMeasure`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionRecipe_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ProductionRecipeComponent`
    ADD CONSTRAINT `ProductionRecipeComponent_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `ProductionRecipe`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionRecipeComponent_componentProductId_fkey` FOREIGN KEY (`componentProductId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionRecipeComponent_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `UnitOfMeasure`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ProductionOrder`
    ADD CONSTRAINT `ProductionOrder_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionOrder_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionOrder_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionOrder_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `ProductionRecipe`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionOrder_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionOrder_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionOrder_cancelledById_fkey` FOREIGN KEY (`cancelledById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ProductionOrderItem`
    ADD CONSTRAINT `ProductionOrderItem_productionOrderId_fkey` FOREIGN KEY (`productionOrderId`) REFERENCES `ProductionOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionOrderItem_componentProductId_fkey` FOREIGN KEY (`componentProductId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ProductionOrderItem_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `UnitOfMeasure`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
