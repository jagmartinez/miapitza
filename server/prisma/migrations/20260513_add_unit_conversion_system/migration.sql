-- Unit Conversion System Migration
-- Adds UnitOfMeasure, ProductUnit tables and conversion traceability fields
-- Compatible with existing data (all new columns are nullable or have defaults)

-- 1. Create MeasurementType enum (MySQL uses inline ENUM)
-- 2. Create UnitOfMeasure table
CREATE TABLE `UnitOfMeasure` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `abbreviation` VARCHAR(191) NOT NULL,
    `measurementType` ENUM('MASS', 'VOLUME', 'UNIT', 'PACKAGE') NOT NULL,
    `systemFactor` DECIMAL(18, 6) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `UnitOfMeasure_companyId_abbreviation_key`(`companyId`, `abbreviation`),
    INDEX `UnitOfMeasure_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3. Create ProductUnit table
CREATE TABLE `ProductUnit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `unitId` INTEGER NOT NULL,
    `conversionFactor` DECIMAL(18, 6) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `ProductUnit_productId_unitId_key`(`productId`, `unitId`),
    INDEX `ProductUnit_companyId_idx`(`companyId`),
    INDEX `ProductUnit_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4. Add baseUnitId to Product
ALTER TABLE `Product` ADD COLUMN `baseUnitId` INTEGER NULL;

-- 5. Increase decimal precision on Product cost fields
ALTER TABLE `Product`
    MODIFY `currentAverageCost` DECIMAL(10, 6) NOT NULL DEFAULT 0,
    MODIFY `lastPurchaseCost` DECIMAL(10, 6) NOT NULL DEFAULT 0;

-- 6. Add unitId to Recipe
ALTER TABLE `Recipe` ADD COLUMN `unitId` INTEGER NULL;

-- 7. Add traceability fields to InventoryMovement + increase precision
ALTER TABLE `InventoryMovement`
    ADD COLUMN `originalQuantity` DECIMAL(18, 6) NULL,
    ADD COLUMN `originalUnit` VARCHAR(191) NULL,
    ADD COLUMN `conversionFactor` DECIMAL(18, 6) NULL,
    MODIFY `quantity` DECIMAL(18, 6) NOT NULL,
    MODIFY `unitCost` DECIMAL(18, 6) NULL,
    MODIFY `totalCost` DECIMAL(18, 6) NULL,
    MODIFY `balanceQty` DECIMAL(18, 6) NULL,
    MODIFY `balanceCost` DECIMAL(18, 6) NULL;

-- 8. Add conversion fields to PurchaseOrderItem + increase precision
ALTER TABLE `PurchaseOrderItem`
    ADD COLUMN `purchaseUnit` VARCHAR(191) NULL,
    ADD COLUMN `conversionFactor` DECIMAL(18, 6) NULL,
    ADD COLUMN `baseQuantity` DECIMAL(18, 6) NULL,
    ADD COLUMN `baseCost` DECIMAL(18, 6) NULL,
    MODIFY `quantity` DECIMAL(18, 6) NOT NULL,
    MODIFY `cost` DECIMAL(18, 6) NOT NULL,
    MODIFY `subtotal` DECIMAL(18, 6) NOT NULL;

-- 9. Increase Stock quantity precision
ALTER TABLE `Stock` MODIFY `quantity` DECIMAL(18, 6) NOT NULL DEFAULT 0;

-- 10. Increase ProductCostHistory precision
ALTER TABLE `ProductCostHistory`
    MODIFY `previousCost` DECIMAL(18, 6) NOT NULL,
    MODIFY `newCost` DECIMAL(18, 6) NOT NULL,
    MODIFY `movementQty` DECIMAL(18, 6) NULL,
    MODIFY `movementUnitCost` DECIMAL(18, 6) NULL,
    MODIFY `previousStockQty` DECIMAL(18, 6) NULL,
    MODIFY `newStockQty` DECIMAL(18, 6) NULL;

-- 11. Add foreign keys
ALTER TABLE `UnitOfMeasure` ADD CONSTRAINT `UnitOfMeasure_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ProductUnit` ADD CONSTRAINT `ProductUnit_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ProductUnit` ADD CONSTRAINT `ProductUnit_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ProductUnit` ADD CONSTRAINT `ProductUnit_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `UnitOfMeasure`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Product` ADD CONSTRAINT `Product_baseUnitId_fkey` FOREIGN KEY (`baseUnitId`) REFERENCES `UnitOfMeasure`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Recipe` ADD CONSTRAINT `Recipe_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `UnitOfMeasure`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
