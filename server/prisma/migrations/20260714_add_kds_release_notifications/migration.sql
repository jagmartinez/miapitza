-- Durable KDS lifecycle markers. Nullable columns keep the migration additive
-- for orders that predate this workflow.
ALTER TABLE `Order`
  ADD COLUMN `kitchenStartedAt` DATETIME(3) NULL,
  ADD COLUMN `kitchenStartedById` INTEGER NULL,
  ADD COLUMN `kitchenReleasedAt` DATETIME(3) NULL,
  ADD COLUMN `kitchenReleasedById` INTEGER NULL,
  ADD INDEX `Order_companyId_kitchenReleasedAt_status_idx` (`companyId`, `kitchenReleasedAt`, `status`),
  ADD INDEX `Order_kitchenStartedById_idx` (`kitchenStartedById`),
  ADD INDEX `Order_kitchenReleasedById_idx` (`kitchenReleasedById`),
  ADD CONSTRAINT `Order_kitchenStartedById_fkey` FOREIGN KEY (`kitchenStartedById`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `Order_kitchenReleasedById_fkey` FOREIGN KEY (`kitchenReleasedById`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `KitchenNotification` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `companyId` INTEGER NOT NULL,
  `branchId` INTEGER NOT NULL,
  `orderId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `eventType` ENUM('ORDER_ITEM_READY', 'ORDER_READY', 'ORDER_RELEASED') NOT NULL,
  `dedupKey` VARCHAR(191) NOT NULL,
  `status` ENUM('UNREAD', 'SEEN', 'ATTENDED') NOT NULL DEFAULT 'UNREAD',
  `tableNumber` VARCHAR(20) NULL,
  `message` VARCHAR(500) NOT NULL,
  `payload` JSON NULL,
  `seenAt` DATETIME(3) NULL,
  `attendedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `KitchenNotification_companyId_dedupKey_key` (`companyId`, `dedupKey`),
  INDEX `KitchenNotification_companyId_branchId_createdAt_idx` (`companyId`, `branchId`, `createdAt`),
  INDEX `KitchenNotification_userId_status_createdAt_idx` (`userId`, `status`, `createdAt`),
  INDEX `KitchenNotification_orderId_eventType_idx` (`orderId`, `eventType`),
  PRIMARY KEY (`id`),
  CONSTRAINT `KitchenNotification_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `KitchenNotification_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `KitchenNotification_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `KitchenNotification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Provision the configurable targets for every existing tenant without
-- overwriting tenant-specific values.
INSERT IGNORE INTO `Setting` (`companyId`, `name`, `value`, `createdAt`, `updatedAt`)
SELECT `id`, CONCAT(`id`, '_kds_warning_minutes'), '3', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `Company`;

INSERT IGNORE INTO `Setting` (`companyId`, `name`, `value`, `createdAt`, `updatedAt`)
SELECT `id`, CONCAT(`id`, '_kds_urgent_minutes'), '10', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `Company`;

INSERT IGNORE INTO `Permission` (`name`, `description`) VALUES
  ('kds.view', 'Ver cola, configuración e historial KDS'),
  ('kds.manage', 'Iniciar, finalizar, marcar lista y liberar órdenes KDS');

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r ON r.`name` IN ('SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF')
WHERE p.`name` IN ('kds.view', 'kds.manage');
