-- Rollback for 20260809_ingredient_warehouse_routing.
-- Consumption falls back to the order's sale warehouse for every line.
DROP TABLE IF EXISTS `InventoryWarehouseRoute`;
