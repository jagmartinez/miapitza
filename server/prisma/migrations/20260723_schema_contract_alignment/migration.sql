-- Align the deployed schema with the fail-closed Prisma contracts.
-- Payment method snapshots must always be supplied explicitly; a database
-- default could silently classify an incomplete insert as OTHER.
ALTER TABLE `Payment`
    ALTER COLUMN `methodType` DROP DEFAULT;

ALTER TABLE `CateringPayment`
    ALTER COLUMN `methodType` DROP DEFAULT;

-- Catering uses the shared fiscal status enum and supports partial credit
-- notes just like point-of-sale invoices.
ALTER TABLE `CateringFiscalInvoice`
    MODIFY `status` ENUM(
        'NOT_ISSUED',
        'ISSUED',
        'PARTIALLY_CREDITED',
        'CREDITED',
        'CANCELLED'
    ) NOT NULL DEFAULT 'ISSUED';
