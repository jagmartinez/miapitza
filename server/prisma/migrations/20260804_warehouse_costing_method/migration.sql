-- Per-warehouse copy of the company costing method (inventory audit #11).
--
-- The inventory engine read Company.costingMethod with a plain (snapshot)
-- read to avoid a Company lock-order inversion with production. Under
-- REPEATABLE READ a movement could then see WEIGHTED_AVERAGE after a
-- concurrent WA -> FIFO switch had committed, leaving layers != stock.
-- The switch now updates every Warehouse row while holding it FOR UPDATE and
-- the engine reads this column from its own Warehouse locking read.
ALTER TABLE `Warehouse`
    ADD COLUMN `costingMethod` ENUM('WEIGHTED_AVERAGE', 'FIFO') NOT NULL DEFAULT 'WEIGHTED_AVERAGE';

UPDATE `Warehouse` w
    JOIN `Company` c ON c.`id` = w.`companyId`
SET w.`costingMethod` = c.`costingMethod`;
