-- Rollback for 20260618_add_production_module

ALTER TABLE `ProductionOrderItem` DROP FOREIGN KEY `ProductionOrderItem_productionOrderId_fkey`;
ALTER TABLE `ProductionOrderItem` DROP FOREIGN KEY `ProductionOrderItem_componentProductId_fkey`;
ALTER TABLE `ProductionOrderItem` DROP FOREIGN KEY `ProductionOrderItem_unitId_fkey`;

ALTER TABLE `ProductionOrder` DROP FOREIGN KEY `ProductionOrder_companyId_fkey`;
ALTER TABLE `ProductionOrder` DROP FOREIGN KEY `ProductionOrder_branchId_fkey`;
ALTER TABLE `ProductionOrder` DROP FOREIGN KEY `ProductionOrder_productId_fkey`;
ALTER TABLE `ProductionOrder` DROP FOREIGN KEY `ProductionOrder_recipeId_fkey`;
ALTER TABLE `ProductionOrder` DROP FOREIGN KEY `ProductionOrder_warehouseId_fkey`;
ALTER TABLE `ProductionOrder` DROP FOREIGN KEY `ProductionOrder_userId_fkey`;
ALTER TABLE `ProductionOrder` DROP FOREIGN KEY `ProductionOrder_cancelledById_fkey`;

ALTER TABLE `ProductionRecipeComponent` DROP FOREIGN KEY `ProductionRecipeComponent_recipeId_fkey`;
ALTER TABLE `ProductionRecipeComponent` DROP FOREIGN KEY `ProductionRecipeComponent_componentProductId_fkey`;
ALTER TABLE `ProductionRecipeComponent` DROP FOREIGN KEY `ProductionRecipeComponent_unitId_fkey`;

ALTER TABLE `ProductionRecipe` DROP FOREIGN KEY `ProductionRecipe_companyId_fkey`;
ALTER TABLE `ProductionRecipe` DROP FOREIGN KEY `ProductionRecipe_productId_fkey`;
ALTER TABLE `ProductionRecipe` DROP FOREIGN KEY `ProductionRecipe_yieldUnitId_fkey`;
ALTER TABLE `ProductionRecipe` DROP FOREIGN KEY `ProductionRecipe_createdById_fkey`;

DROP TABLE `ProductionOrderItem`;
DROP TABLE `ProductionOrder`;
DROP TABLE `ProductionRecipeComponent`;
DROP TABLE `ProductionRecipe`;

-- Revert ProductType enum (only safe if no rows use the new values)
ALTER TABLE `Product`
    MODIFY COLUMN `type` ENUM('INGREDIENT', 'PRODUCT_FOR_SALE', 'BOTH') NOT NULL DEFAULT 'INGREDIENT';
