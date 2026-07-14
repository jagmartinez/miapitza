-- A reservation check-in creates its POS order in the same transaction.
-- The unique link makes the operation replay-safe and auditable.
ALTER TABLE `Order`
    ADD COLUMN `reservationId` INTEGER NULL;

CREATE UNIQUE INDEX `Order_reservationId_key` ON `Order`(`reservationId`);

ALTER TABLE `Order`
    ADD CONSTRAINT `Order_reservationId_fkey`
    FOREIGN KEY (`reservationId`) REFERENCES `Reservation`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
