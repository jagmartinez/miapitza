DROP TABLE IF EXISTS `OperationalDevice`;

ALTER TABLE `User`
  DROP COLUMN `pinHash`,
  DROP COLUMN `pinUpdatedAt`;

DELETE FROM `Permission` WHERE `name` = 'devices.manage';
