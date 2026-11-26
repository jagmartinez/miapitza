-- Rollback for 20260811_promotion_rules.
-- Promotions created with the new rules cannot be represented by the legacy
-- schema: they are deactivated and converted to a 0-value FIXED_AMOUNT order
-- promotion (codes and usage history kept) before the enum is narrowed. Orders
-- that carry one of those codes must be repriced/settled before rolling back.
-- Per-line promotion attribution is dropped: credit notes fall back to the
-- proportional allocation of the order discount.
UPDATE `Promotion`
SET `active` = false, `type` = 'FIXED_AMOUNT', `value` = 0
WHERE `type` IN ('BUY_X_GET_Y', 'COMBO');

UPDATE `Promotion`
SET `active` = false
WHERE `scope` <> 'ORDER'
   OR `allBranches` = false
   OR `weekdays` IS NOT NULL
   OR `dailyStartTime` IS NOT NULL
   OR `dailyEndTime` IS NOT NULL;

DROP TABLE IF EXISTS `PromotionComboItem`;
DROP TABLE IF EXISTS `PromotionTarget`;
DROP TABLE IF EXISTS `PromotionBranch`;

ALTER TABLE `OrderItem`
    DROP COLUMN `createdAt`,
    DROP COLUMN `promotionDiscount`;

ALTER TABLE `Promotion`
    DROP COLUMN `payQuantity`,
    DROP COLUMN `buyQuantity`,
    DROP COLUMN `allBranches`,
    DROP COLUMN `dailyEndTime`,
    DROP COLUMN `dailyStartTime`,
    DROP COLUMN `weekdays`,
    DROP COLUMN `scope`,
    MODIFY `type` ENUM('PERCENTAGE', 'FIXED_AMOUNT') NOT NULL DEFAULT 'PERCENTAGE';
