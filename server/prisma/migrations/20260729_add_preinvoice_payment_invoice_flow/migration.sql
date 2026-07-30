-- A pre-invoice is an immutable payable snapshot, not a fiscal document.
-- It enables collection while reserving the fiscal sequence for full payment.
ALTER TABLE `Order`
  ADD COLUMN `preInvoicedAt` DATETIME(3) NULL,
  ADD COLUMN `preInvoiceSnapshot` JSON NULL,
  ADD INDEX `Order_companyId_preInvoicedAt_idx` (`companyId`, `preInvoicedAt`);

-- Existing issued invoices remain valid and payable. Copying their timestamp
-- and snapshot makes the new collection prerequisite backward compatible
-- without renumbering or reconstructing any historical fiscal document.
UPDATE `Order`
SET
  `preInvoicedAt` = COALESCE(`preInvoicedAt`, `invoicedAt`),
  `preInvoiceSnapshot` = COALESCE(`preInvoiceSnapshot`, `invoiceSnapshot`)
WHERE `invoiceNumber` IS NOT NULL;
