-- Multi-brand support: a "marca" groups menu items by business line within a
-- single company/location (e.g. two product lines under one RUC).

CREATE TABLE `MenuBrand` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `companyId` INT NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NULL,
    `sortOrder` INT NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MenuBrand_companyId_name_key`(`companyId`, `name`),
    INDEX `MenuBrand_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MenuBrand`
    ADD CONSTRAINT `MenuBrand_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Optional brand link on menu items (NULL = shared across all brands).
ALTER TABLE `MenuItem` ADD COLUMN `brandId` INT NULL;
ALTER TABLE `MenuItem` ADD INDEX `MenuItem_brandId_idx`(`brandId`);
ALTER TABLE `MenuItem`
    ADD CONSTRAINT `MenuItem_brandId_fkey`
    FOREIGN KEY (`brandId`) REFERENCES `MenuBrand`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
