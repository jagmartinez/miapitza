-- Operational device registry (shared service / kitchen tablets) and the
-- bcrypt PIN fields used for shared-tablet login. Additive only.
ALTER TABLE `User`
  ADD COLUMN `pinHash` VARCHAR(100) NULL,
  ADD COLUMN `pinUpdatedAt` DATETIME(3) NULL;

CREATE TABLE `OperationalDevice` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `companyId` INTEGER NOT NULL,
  `branchId` INTEGER NOT NULL,
  `type` ENUM('SERVICE_TABLET', 'KITCHEN_TABLET') NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `tokenHash` VARCHAR(64) NOT NULL,
  `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
  `kitchenUserId` INTEGER NULL,
  `createdById` INTEGER NOT NULL,
  `revokedById` INTEGER NULL,
  `revokedAt` DATETIME(3) NULL,
  `lastSeenAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `OperationalDevice_tokenHash_key` (`tokenHash`),
  INDEX `OperationalDevice_companyId_branchId_status_idx` (`companyId`, `branchId`, `status`),
  INDEX `OperationalDevice_kitchenUserId_idx` (`kitchenUserId`),
  INDEX `OperationalDevice_createdById_idx` (`createdById`),
  INDEX `OperationalDevice_revokedById_idx` (`revokedById`),
  INDEX `OperationalDevice_branchId_idx` (`branchId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `OperationalDevice_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `OperationalDevice_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `OperationalDevice_kitchenUserId_fkey` FOREIGN KEY (`kitchenUserId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `OperationalDevice_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `OperationalDevice_revokedById_fkey` FOREIGN KEY (`revokedById`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Sweeps of sessions by device tag (revoke) must not scan the whole table.
CREATE INDEX `UserSession_device_idx` ON `UserSession`(`device`);

INSERT IGNORE INTO `Permission` (`name`, `description`) VALUES
  ('devices.manage', 'Registrar, listar y revocar dispositivos operativos (tablets)');

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r ON r.`name` IN ('SUPERADMIN', 'ADMIN')
WHERE p.`name` = 'devices.manage';
