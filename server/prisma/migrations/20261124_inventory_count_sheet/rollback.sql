-- Rollback of 20261124_inventory_count_sheet.
DELETE FROM `Permission` WHERE `name` = 'inventory.count';
DROP TABLE `InventoryCountLine`;
DROP TABLE `InventoryCountSheet`;
