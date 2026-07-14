-- Payment method behavior must not depend on a mutable/localized display name.
-- Backfill only the exact legacy labels explicitly supported by the old code;
-- every custom method remains OTHER and requires an administrator decision.
ALTER TABLE `PaymentMethod`
    ADD COLUMN `type` ENUM('CASH', 'CARD', 'BANK_TRANSFER', 'OTHER') NOT NULL DEFAULT 'OTHER';

UPDATE `PaymentMethod`
SET `type` = CASE
    WHEN UPPER(TRIM(`name`)) IN ('EFECTIVO', 'CASH') THEN 'CASH'
    WHEN UPPER(TRIM(`name`)) IN ('TARJETA', 'CARD', 'POS') THEN 'CARD'
    WHEN UPPER(TRIM(`name`)) IN ('TRANSFERENCIA', 'BANK TRANSFER') THEN 'BANK_TRANSFER'
    ELSE 'OTHER'
END;

CREATE INDEX `PaymentMethod_companyId_type_idx` ON `PaymentMethod`(`companyId`, `type`);
