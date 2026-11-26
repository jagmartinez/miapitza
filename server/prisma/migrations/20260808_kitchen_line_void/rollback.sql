-- Rollback for 20260808_kitchen_line_void.
-- WARNING: voided rows (quantity 0) stay on their orders; void metadata is lost.
DELETE pr FROM `_PermissionToRole` pr
JOIN `Permission` p ON p.`id` = pr.`A`
WHERE p.`name` = 'orders.items.void';
DELETE FROM `Permission` WHERE `name` = 'orders.items.void';

DROP INDEX `OrderItem_voidedFromItemId_idx` ON `OrderItem`;
DROP INDEX `OrderItem_orderId_voidIdempotencyKey_key` ON `OrderItem`;

ALTER TABLE `OrderItem`
    DROP COLUMN `voidIdempotencyKey`,
    DROP COLUMN `voidWasteWarehouseId`,
    DROP COLUMN `voidWasteReference`,
    DROP COLUMN `voidedFromItemId`,
    DROP COLUMN `voidReason`,
    DROP COLUMN `voidedById`,
    DROP COLUMN `voidedAt`,
    DROP COLUMN `voidedQuantity`;
