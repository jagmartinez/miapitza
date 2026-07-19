-- Physical table groups are deliberately separate from financial account
-- consolidation. This keeps every joined table occupied until the seating
-- arrangement is explicitly separated or its operational orders are closed.
CREATE TABLE `TableGroup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `primaryTableId` INTEGER NULL,
    `memberTableIds` JSON NOT NULL,
    `status` ENUM('ACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `reason` VARCHAR(500) NULL,
    `closeReason` VARCHAR(500) NULL,
    `createdById` INTEGER NOT NULL,
    `closedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `closedAt` DATETIME(3) NULL,

    INDEX `TableGroup_companyId_branchId_status_idx`(`companyId`, `branchId`, `status`),
    INDEX `TableGroup_primaryTableId_idx`(`primaryTableId`),
    INDEX `TableGroup_createdById_idx`(`createdById`),
    INDEX `TableGroup_closedById_idx`(`closedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Table`
    ADD COLUMN `activeTableGroupId` INTEGER NULL,
    ADD INDEX `Table_activeTableGroupId_idx`(`activeTableGroupId`);

ALTER TABLE `TableGroup`
    ADD CONSTRAINT `TableGroup_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `TableGroup_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `TableGroup_primaryTableId_fkey` FOREIGN KEY (`primaryTableId`) REFERENCES `Table`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `TableGroup_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `TableGroup_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Table`
    ADD CONSTRAINT `Table_activeTableGroupId_fkey` FOREIGN KEY (`activeTableGroupId`) REFERENCES `TableGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT IGNORE INTO `Permission` (`name`, `description`) VALUES
    ('tables.group.manage', 'Unir y separar mesas físicamente');

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE p.`name` = 'tables.group.manage'
  AND r.`name` IN ('SUPERADMIN', 'ADMIN', 'HOST', 'MESERO');
