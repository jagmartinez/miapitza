-- Per-line kitchen void (anulación de una línea ya enviada a cocina).
--
-- A voided OrderItem row keeps quantity = 0 / subtotal = 0 so order totals,
-- delivery consumption (ORD-{id}) and fiscal documents ignore it, while the
-- KDS and audit still show what was voided. The physical waste is posted once
-- under WASTE-ORD-{orderId}-L{itemId}. A partial void splits the voided units
-- into a new row that points at the original line (voidedFromItemId).
-- (orderId, voidIdempotencyKey) makes retried void requests idempotent.
ALTER TABLE `OrderItem`
    ADD COLUMN `voidedQuantity` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `voidedAt` DATETIME(3) NULL,
    ADD COLUMN `voidedById` INTEGER NULL,
    ADD COLUMN `voidReason` VARCHAR(500) NULL,
    ADD COLUMN `voidedFromItemId` INTEGER NULL,
    ADD COLUMN `voidWasteReference` VARCHAR(191) NULL,
    ADD COLUMN `voidWasteWarehouseId` INTEGER NULL,
    ADD COLUMN `voidIdempotencyKey` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `OrderItem_orderId_voidIdempotencyKey_key` ON `OrderItem`(`orderId`, `voidIdempotencyKey`);
CREATE INDEX `OrderItem_voidedFromItemId_idx` ON `OrderItem`(`voidedFromItemId`);

-- Voiding prepared food is a supervisor action. Configurable per role; only
-- SUPERADMIN and ADMIN receive it by default.
INSERT IGNORE INTO `Permission` (`name`, `description`) VALUES
    ('orders.items.void', 'Anular líneas ya enviadas a cocina (registra merma)');

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r ON r.`name` IN ('SUPERADMIN', 'ADMIN')
WHERE p.`name` = 'orders.items.void';
