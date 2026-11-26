-- Waiter mode final review (I1): the percentage a supervisor actually authorized,
-- so later line shrinks re-cap to min(authorizer limit, authorized percent).
-- Additive, nullable, no default (metadata-only on MySQL 8 INSTANT).
-- Rollback: ALTER TABLE `Order` DROP COLUMN `discountAuthorizedPercent`;
ALTER TABLE `Order`
  ADD COLUMN `discountAuthorizedPercent` DECIMAL(5, 2) NULL;
