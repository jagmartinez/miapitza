-- Snapshot the semantic method used at collection time. Historical reports and
-- reversal behavior must not change if a PaymentMethod is later reconfigured.
ALTER TABLE `Payment`
    ADD COLUMN `methodType` ENUM('CASH', 'CARD', 'BANK_TRANSFER', 'OTHER') NOT NULL DEFAULT 'OTHER',
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;

ALTER TABLE `CateringPayment`
    ADD COLUMN `methodType` ENUM('CASH', 'CARD', 'BANK_TRANSFER', 'OTHER') NOT NULL DEFAULT 'OTHER',
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
    ADD COLUMN `registeredById` INTEGER NULL;

UPDATE `Payment` p
INNER JOIN `PaymentMethod` pm ON pm.`id` = p.`paymentMethodId`
SET p.`methodType` = pm.`type`;

UPDATE `CateringPayment` cp
INNER JOIN `PaymentMethod` pm ON pm.`id` = cp.`paymentMethodId`
SET cp.`methodType` = pm.`type`;

CREATE INDEX `Payment_methodType_createdAt_idx` ON `Payment`(`methodType`, `createdAt`);
CREATE INDEX `Payment_registeredById_idx` ON `Payment`(`registeredById`);
CREATE INDEX `Payment_reversedById_idx` ON `Payment`(`reversedById`);
CREATE UNIQUE INDEX `Payment_orderId_idempotencyKey_key` ON `Payment`(`orderId`, `idempotencyKey`);

CREATE INDEX `CateringPayment_methodType_date_idx` ON `CateringPayment`(`methodType`, `date`);
CREATE INDEX `CateringPayment_registeredById_idx` ON `CateringPayment`(`registeredById`);
CREATE UNIQUE INDEX `CateringPayment_cateringEventId_idempotencyKey_key`
    ON `CateringPayment`(`cateringEventId`, `idempotencyKey`);

-- Fail closed if historical actor ids are orphaned. We intentionally do not
-- rewrite them to NULL: deployment must remediate an invalid audit trail first.
ALTER TABLE `Payment`
    ADD CONSTRAINT `Payment_registeredById_fkey`
        FOREIGN KEY (`registeredById`) REFERENCES `User`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `Payment_reversedById_fkey`
        FOREIGN KEY (`reversedById`) REFERENCES `User`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CateringPayment`
    ADD CONSTRAINT `CateringPayment_registeredById_fkey`
        FOREIGN KEY (`registeredById`) REFERENCES `User`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;
