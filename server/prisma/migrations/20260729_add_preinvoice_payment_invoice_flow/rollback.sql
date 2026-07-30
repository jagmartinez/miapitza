ALTER TABLE `Order`
  DROP INDEX `Order_companyId_preInvoicedAt_idx`,
  DROP COLUMN `preInvoiceSnapshot`,
  DROP COLUMN `preInvoicedAt`;
