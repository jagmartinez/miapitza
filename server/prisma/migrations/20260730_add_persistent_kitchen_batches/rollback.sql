ALTER TABLE `OrderItem`
  DROP FOREIGN KEY `OrderItem_kitchenBatchId_fkey`,
  DROP INDEX `OrderItem_kitchenBatchId_idx`,
  DROP COLUMN `kitchenBatchId`;

DROP TABLE `KitchenBatch`;
