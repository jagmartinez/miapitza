DROP TABLE IF EXISTS `KitchenNotification`;

ALTER TABLE `Order`
  DROP FOREIGN KEY `Order_kitchenStartedById_fkey`,
  DROP FOREIGN KEY `Order_kitchenReleasedById_fkey`,
  DROP INDEX `Order_companyId_kitchenReleasedAt_status_idx`,
  DROP INDEX `Order_kitchenStartedById_idx`,
  DROP INDEX `Order_kitchenReleasedById_idx`,
  DROP COLUMN `kitchenStartedAt`,
  DROP COLUMN `kitchenStartedById`,
  DROP COLUMN `kitchenReleasedAt`,
  DROP COLUMN `kitchenReleasedById`;

DELETE FROM `Setting`
WHERE `name` IN (
  CONCAT(`companyId`, '_kds_warning_minutes'),
  CONCAT(`companyId`, '_kds_urgent_minutes')
);

DELETE FROM `Permission` WHERE `name` IN ('kds.view', 'kds.manage');
