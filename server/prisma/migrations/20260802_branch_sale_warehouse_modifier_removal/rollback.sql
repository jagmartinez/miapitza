-- Rollback of 20260802_branch_sale_warehouse_modifier_removal.
-- Without the column every modifier is ADD: unlink REMOVE ("sin X") modifiers
-- first so they do not start consuming the ingredient they used to remove.
UPDATE `Modifier`
    SET `productId` = NULL, `consumeQuantity` = NULL, `unitId` = NULL
    WHERE `inventoryEffect` = 'REMOVE';

ALTER TABLE `Modifier` DROP COLUMN `inventoryEffect`;

ALTER TABLE `Branch` DROP FOREIGN KEY `Branch_defaultSaleWarehouseId_fkey`;
DROP INDEX `Branch_defaultSaleWarehouseId_idx` ON `Branch`;
ALTER TABLE `Branch` DROP COLUMN `defaultSaleWarehouseId`;
