-- Permit a fiscal invoice to carry several immutable credit notes while
-- preserving the original one-note rows. New line/refund ledgers make every
-- partial amount traceable to the invoice line and original payment.
ALTER TABLE `Order`
    MODIFY `invoiceFiscalStatus` ENUM(
        'NOT_ISSUED',
        'ISSUED',
        'PARTIALLY_CREDITED',
        'CREDITED',
        'CANCELLED'
    ) NOT NULL DEFAULT 'NOT_ISSUED';

ALTER TABLE `FiscalCreditNote`
    DROP INDEX `FiscalCreditNote_orderId_key`,
    ADD INDEX `FiscalCreditNote_orderId_issuedAt_idx` (`orderId`, `issuedAt`);

-- Older full-credit code cleared closedAt, which erased the gross fiscal sale
-- from every historical period while leaving the credit note as a negative.
-- Restore the durable settlement instant before reports adopt the
-- gross-event + counterdocument-event model. Do not manufacture a sale date
-- from the later invoice/credit-note timestamps when the payment evidence is
-- absent: those exceptional legacy rows remain fail-closed for remediation.
UPDATE `Order` AS `o`
INNER JOIN (
    SELECT `orderId`, MAX(`createdAt`) AS `paidAt`
    FROM `Payment`
    GROUP BY `orderId`
) AS `p` ON `p`.`orderId` = `o`.`id`
SET `o`.`closedAt` = `p`.`paidAt`
WHERE `o`.`status` = 'CANCELLED'
  AND `o`.`invoiceFiscalStatus` = 'CREDITED'
  AND `o`.`closedAt` IS NULL;

CREATE TABLE `FiscalCreditNoteLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fiscalCreditNoteId` INTEGER NOT NULL,
    `orderItemId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `grossSubtotal` DECIMAL(10,2) NOT NULL,
    `discount` DECIMAL(10,2) NOT NULL,
    `subtotal` DECIMAL(10,2) NOT NULL,
    `tax` DECIMAL(10,2) NOT NULL,
    `tipAmount` DECIMAL(10,2) NOT NULL,
    `total` DECIMAL(10,2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FiscalCreditNoteLine_credit_item_key` (`fiscalCreditNoteId`, `orderItemId`),
    INDEX `FiscalCreditNoteLine_orderItemId_idx` (`orderItemId`),
    CONSTRAINT `FiscalCreditNoteLine_credit_fkey`
        FOREIGN KEY (`fiscalCreditNoteId`) REFERENCES `FiscalCreditNote` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalCreditNoteLine_item_fkey`
        FOREIGN KEY (`orderItemId`) REFERENCES `OrderItem` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalCreditNoteLine_positive_qty` CHECK (`quantity` > 0),
    CONSTRAINT `FiscalCreditNoteLine_nonnegative_money` CHECK (
        `grossSubtotal` >= 0 AND `discount` >= 0 AND `subtotal` >= 0
        AND `tax` >= 0 AND `tipAmount` >= 0 AND `total` > 0
    ),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FiscalCreditNotePaymentRefund` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fiscalCreditNoteId` INTEGER NOT NULL,
    `paymentId` INTEGER NOT NULL,
    `amount` DECIMAL(10,2) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FiscalCNRefund_credit_payment_key` (`fiscalCreditNoteId`, `paymentId`),
    INDEX `FiscalCNRefund_payment_created_idx` (`paymentId`, `createdAt`),
    INDEX `FiscalCNRefund_reference_idx` (`reference`),
    CONSTRAINT `FiscalCNRefund_credit_fkey`
        FOREIGN KEY (`fiscalCreditNoteId`) REFERENCES `FiscalCreditNote` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalCNRefund_payment_fkey`
        FOREIGN KEY (`paymentId`) REFERENCES `Payment` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `FiscalCNRefund_positive_amount` CHECK (`amount` > 0),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
