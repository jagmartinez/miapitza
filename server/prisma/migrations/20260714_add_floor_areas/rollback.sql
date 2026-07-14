ALTER TABLE `Table` DROP FOREIGN KEY `Table_floorAreaId_fkey`;
DROP INDEX `Table_floorAreaId_idx` ON `Table`;
ALTER TABLE `Table` DROP COLUMN `floorAreaId`;
DROP TABLE `FloorArea`;
DROP TABLE `TableFloorPlan`;
