-- Purchase-order payments form an immutable ledger. Reversing an erroneous
-- payment preserves the original row and records who reversed it, when and why.
ALTER TABLE `PurchaseOrderPayment`
    ADD COLUMN `status` ENUM('ACTIVE', 'REVERSED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `reversedAt` DATETIME(3) NULL,
    ADD COLUMN `reversedById` INTEGER NULL,
    ADD COLUMN `reversalReason` VARCHAR(191) NULL;

CREATE INDEX `PurchaseOrderPayment_status_idx` ON `PurchaseOrderPayment`(`status`);
CREATE INDEX `PurchaseOrderPayment_reversedById_idx` ON `PurchaseOrderPayment`(`reversedById`);

ALTER TABLE `PurchaseOrderPayment`
    ADD CONSTRAINT `PurchaseOrderPayment_reversedById_fkey`
    FOREIGN KEY (`reversedById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
