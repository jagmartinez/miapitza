-- Waiter mode (Android app, phase 2): party size, per-line delivery, manual
-- discount reason/authorizer, per-role discount cap and the two discount
-- permissions. Additive only.
ALTER TABLE `Order`
  ADD COLUMN `guests` INTEGER NULL,
  ADD COLUMN `discountReason` VARCHAR(120) NULL,
  ADD COLUMN `discountAuthorizedById` INTEGER NULL,
  ADD INDEX `Order_discountAuthorizedById_idx` (`discountAuthorizedById`),
  ADD CONSTRAINT `Order_discountAuthorizedById_fkey` FOREIGN KEY (`discountAuthorizedById`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `OrderItem`
  ADD COLUMN `deliveredAt` DATETIME(3) NULL,
  ADD COLUMN `deliveredById` INTEGER NULL,
  ADD INDEX `OrderItem_deliveredById_idx` (`deliveredById`),
  ADD CONSTRAINT `OrderItem_deliveredById_fkey` FOREIGN KEY (`deliveredById`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Role`
  ADD COLUMN `maxDiscountPercent` INTEGER NULL;

INSERT IGNORE INTO `Permission` (`name`, `description`) VALUES
  ('orders.discount.apply', 'Aplicar descuentos manuales a una cuenta'),
  ('orders.discount.authorize', 'Autorizar descuentos manuales por encima del tope del rol');

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r ON r.`name` IN ('SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO')
WHERE p.`name` = 'orders.discount.apply';

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r ON r.`name` IN ('SUPERADMIN', 'ADMIN')
WHERE p.`name` = 'orders.discount.authorize';
