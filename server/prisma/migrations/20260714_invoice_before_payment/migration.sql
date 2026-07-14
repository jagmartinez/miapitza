-- Persist fiscal issuance independently from financial settlement.
ALTER TABLE `Order`
    ADD COLUMN `invoicedAt` DATETIME(3) NULL;

CREATE INDEX `Order_companyId_invoicedAt_idx`
    ON `Order`(`companyId`, `invoicedAt`);
