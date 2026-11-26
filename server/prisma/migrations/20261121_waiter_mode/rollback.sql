DELETE FROM `Permission` WHERE `name` IN ('orders.discount.apply', 'orders.discount.authorize');

ALTER TABLE `Role`
  DROP COLUMN `maxDiscountPercent`;

ALTER TABLE `OrderItem`
  DROP FOREIGN KEY `OrderItem_deliveredById_fkey`,
  DROP INDEX `OrderItem_deliveredById_idx`,
  DROP COLUMN `deliveredAt`,
  DROP COLUMN `deliveredById`;

ALTER TABLE `Order`
  DROP FOREIGN KEY `Order_discountAuthorizedById_fkey`,
  DROP INDEX `Order_discountAuthorizedById_idx`,
  DROP COLUMN `guests`,
  DROP COLUMN `discountReason`,
  DROP COLUMN `discountAuthorizedById`;
