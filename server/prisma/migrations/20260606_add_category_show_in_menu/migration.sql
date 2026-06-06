-- AlterTable: add showInMenu to Category (defaults true for backward compatibility)
ALTER TABLE `Category` ADD COLUMN `showInMenu` BOOLEAN NOT NULL DEFAULT true;
