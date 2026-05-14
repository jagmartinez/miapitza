-- Rollback: Unit Conversion System
-- Run this to revert the migration

-- 1. Drop foreign keys
ALTER TABLE `Recipe` DROP FOREIGN KEY `Recipe_unitId_fkey`;
ALTER TABLE `Product` DROP FOREIGN KEY `Product_baseUnitId_fkey`;
ALTER TABLE `ProductUnit` DROP FOREIGN KEY `ProductUnit_unitId_fkey`;
ALTER TABLE `ProductUnit` DROP FOREIGN KEY `ProductUnit_productId_fkey`;
ALTER TABLE `ProductUnit` DROP FOREIGN KEY `ProductUnit_companyId_fkey`;
ALTER TABLE `UnitOfMeasure` DROP FOREIGN KEY `UnitOfMeasure_companyId_fkey`;

-- 2. Remove added columns
ALTER TABLE `Recipe` DROP COLUMN `unitId`;
ALTER TABLE `Product` DROP COLUMN `baseUnitId`;

ALTER TABLE `InventoryMovement`
    DROP COLUMN `originalQuantity`,
    DROP COLUMN `originalUnit`,
    DROP COLUMN `conversionFactor`,
    MODIFY `quantity` DECIMAL(10, 3) NOT NULL,
    MODIFY `unitCost` DECIMAL(10, 2) NULL,
    MODIFY `totalCost` DECIMAL(10, 2) NULL,
    MODIFY `balanceQty` DECIMAL(10, 3) NULL,
    MODIFY `balanceCost` DECIMAL(10, 2) NULL;

ALTER TABLE `PurchaseOrderItem`
    DROP COLUMN `purchaseUnit`,
    DROP COLUMN `conversionFactor`,
    DROP COLUMN `baseQuantity`,
    DROP COLUMN `baseCost`,
    MODIFY `quantity` DECIMAL(10, 3) NOT NULL,
    MODIFY `cost` DECIMAL(10, 2) NOT NULL,
    MODIFY `subtotal` DECIMAL(10, 2) NOT NULL;

ALTER TABLE `Stock` MODIFY `quantity` DECIMAL(10, 3) NOT NULL DEFAULT 0;

ALTER TABLE `Product`
    MODIFY `currentAverageCost` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    MODIFY `lastPurchaseCost` DECIMAL(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE `ProductCostHistory`
    MODIFY `previousCost` DECIMAL(10, 2) NOT NULL,
    MODIFY `newCost` DECIMAL(10, 2) NOT NULL,
    MODIFY `movementQty` DECIMAL(10, 3) NULL,
    MODIFY `movementUnitCost` DECIMAL(10, 2) NULL,
    MODIFY `previousStockQty` DECIMAL(10, 3) NULL,
    MODIFY `newStockQty` DECIMAL(10, 3) NULL;

-- 3. Drop new tables
DROP TABLE `ProductUnit`;
DROP TABLE `UnitOfMeasure`;
