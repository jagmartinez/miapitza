-- AlterTable: independent inventory visibility for categories
ALTER TABLE `Category` ADD COLUMN `showInInventory` BOOLEAN NOT NULL DEFAULT true;
