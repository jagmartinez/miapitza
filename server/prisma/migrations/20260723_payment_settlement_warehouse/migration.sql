ALTER TABLE `Payment`
  ADD COLUMN `settlementWarehouseId` INTEGER NULL,
  ADD INDEX `Payment_settlementWarehouseId_idx` (`settlementWarehouseId`),
  ADD CONSTRAINT `Payment_settlementWarehouseId_fkey`
    FOREIGN KEY (`settlementWarehouseId`) REFERENCES `Warehouse`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
