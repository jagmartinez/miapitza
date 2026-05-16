-- Rollback: Remove SalesChannelConfig table
DROP TABLE IF EXISTS `SalesChannelConfig`;

-- Rollback: Remove salesChannel fields from Order
ALTER TABLE `Order` DROP COLUMN `channelMarkup`;
ALTER TABLE `Order` DROP COLUMN `channelCommission`;
ALTER TABLE `Order` DROP COLUMN `salesChannel`;

-- Rollback: Remove codePrefix from Category
ALTER TABLE `Category` DROP INDEX `Category_companyId_codePrefix_key`;
ALTER TABLE `Category` DROP COLUMN `codePrefix`;
