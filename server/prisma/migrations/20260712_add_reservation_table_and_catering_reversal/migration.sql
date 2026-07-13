-- Bind each new reservation to a concrete physical table. Existing rows remain
-- nullable and are handled conservatively by the allocation service.
ALTER TABLE `Reservation`
    ADD COLUMN `tableId` INTEGER NULL;

CREATE INDEX `Reservation_tableId_idx` ON `Reservation`(`tableId`);

ALTER TABLE `Reservation`
    ADD CONSTRAINT `Reservation_tableId_fkey`
    FOREIGN KEY (`tableId`) REFERENCES `Table`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Catering payments are never deleted. A reversal preserves the original
-- ledger entry and records who reversed it, when and why.
ALTER TABLE `CateringPayment`
    ADD COLUMN `status` ENUM('ACTIVE', 'REVERSED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `reversedAt` DATETIME(3) NULL,
    ADD COLUMN `reversedById` INTEGER NULL,
    ADD COLUMN `reversalReason` VARCHAR(191) NULL;

CREATE INDEX `CateringPayment_status_idx` ON `CateringPayment`(`status`);
CREATE INDEX `CateringPayment_reversedById_idx` ON `CateringPayment`(`reversedById`);

ALTER TABLE `CateringPayment`
    ADD CONSTRAINT `CateringPayment_reversedById_fkey`
    FOREIGN KEY (`reversedById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
