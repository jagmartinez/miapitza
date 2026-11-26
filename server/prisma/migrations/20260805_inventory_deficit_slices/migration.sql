-- Explicit deficit-slice ledger for negative stock (inventory audit, round 3).
--
-- Each OUT that drives a (warehouse, product) below zero appends a slice with
-- its uncovered quantity and provisional unit cost. Covering inbounds consume
-- open slices FIFO and record the real value on them; inbound reversals
-- re-open the slices they covered; sale returns revalue from their own slices
-- (the returned part of a covered slice is split off with returnMovementId).
-- Stock.negativeBalanceCost stays the sum of the open slices' provisional value.
CREATE TABLE `InventoryDeficitSlice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `warehouseId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `saleMovementId` INTEGER NULL,
    `quantity` DECIMAL(18, 6) NOT NULL,
    `provisionalUnitCost` DECIMAL(18, 6) NOT NULL,
    `coveringMovementId` INTEGER NULL,
    `coveredValue` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `returnMovementId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    -- Composite (warehouseId, productId, ...) indexes: locking reads are always
    -- scoped to one stock row, so gap locks never block other scopes' inserts.
    INDEX `InvDeficitSlice_scope_idx`(`warehouseId`, `productId`, `id`),
    INDEX `InvDeficitSlice_sale_idx`(`warehouseId`, `productId`, `saleMovementId`),
    INDEX `InvDeficitSlice_covering_idx`(`warehouseId`, `productId`, `coveringMovementId`),
    INDEX `InvDeficitSlice_company_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill: one synthetic open slice per existing negative balance, carrying
-- the provisional value already booked (saleMovementId unknown -> NULL).
INSERT INTO `InventoryDeficitSlice`
    (`companyId`, `warehouseId`, `productId`, `saleMovementId`, `quantity`, `provisionalUnitCost`, `coveringMovementId`, `coveredValue`)
SELECT s.`companyId`, s.`warehouseId`, s.`productId`, NULL, -s.`quantity`,
       s.`negativeBalanceCost` / (-s.`quantity`), NULL, 0
FROM `Stock` s
WHERE s.`quantity` < 0;
