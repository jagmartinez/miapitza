-- Preserve the actor and reconciliation inputs used for a cash closing.
-- Existing closed shifts remain nullable because their actor/rate cannot be
-- reconstructed safely from historical data.
ALTER TABLE `CashShift`
    ADD COLUMN `closedById` INTEGER NULL,
    ADD COLUMN `forceClosed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `closingExchangeRate` DECIMAL(18, 6) NULL,
    ADD INDEX `CashShift_closedById_idx`(`closedById`);

ALTER TABLE `CashShift`
    ADD CONSTRAINT `CashShift_closedById_fkey`
    FOREIGN KEY (`closedById`) REFERENCES `User`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The responsible/creator user is not necessarily the user who executes the
-- final inventory transformation. Keep that actor on the domain row so the
-- trace survives independently from reporting projections.
ALTER TABLE `ProductionOrder`
    ADD COLUMN `finishedById` INTEGER NULL,
    ADD INDEX `ProductionOrder_finishedById_idx`(`finishedById`);

ALTER TABLE `ProductionOrder`
    ADD CONSTRAINT `ProductionOrder_finishedById_fkey`
    FOREIGN KEY (`finishedById`) REFERENCES `User`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
