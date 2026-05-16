-- CreateTable
CREATE TABLE `PedidosYaConfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NULL,
    `clientId` VARCHAR(191) NULL,
    `clientSecret` VARCHAR(191) NULL,
    `restaurantId` VARCHAR(191) NULL,
    `webhookSecret` VARCHAR(191) NULL,
    `environment` VARCHAR(191) NOT NULL DEFAULT 'sandbox',
    `autoAcceptOrders` BOOLEAN NOT NULL DEFAULT false,
    `autoSyncStatus` BOOLEAN NOT NULL DEFAULT true,
    `defaultWarehouseId` INTEGER NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `accessToken` TEXT NULL,
    `refreshToken` TEXT NULL,
    `tokenExpiresAt` DATETIME(3) NULL,
    `lastSyncAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PedidosYaConfig_companyId_idx`(`companyId`),
    UNIQUE INDEX `PedidosYaConfig_companyId_branchId_key`(`companyId`, `branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PedidosYaProductMapping` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `externalName` VARCHAR(191) NOT NULL,
    `menuItemId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastSyncAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PedidosYaProductMapping_companyId_idx`(`companyId`),
    INDEX `PedidosYaProductMapping_menuItemId_idx`(`menuItemId`),
    UNIQUE INDEX `PedidosYaProductMapping_companyId_externalId_key`(`companyId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PedidosYaWebhookLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'RECEIVED',
    `errorMessage` TEXT NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PedidosYaWebhookLog_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `PedidosYaWebhookLog_externalId_idx`(`externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PedidosYaOrderSync` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `externalStatus` VARCHAR(191) NULL,
    `internalStatus` VARCHAR(191) NULL,
    `lastSyncAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `syncDirection` VARCHAR(191) NOT NULL DEFAULT 'INBOUND',
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PedidosYaOrderSync_companyId_orderId_idx`(`companyId`, `orderId`),
    UNIQUE INDEX `PedidosYaOrderSync_companyId_externalId_key`(`companyId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PedidosYaConfig` ADD CONSTRAINT `PedidosYaConfig_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidosYaConfig` ADD CONSTRAINT `PedidosYaConfig_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidosYaConfig` ADD CONSTRAINT `PedidosYaConfig_defaultWarehouseId_fkey` FOREIGN KEY (`defaultWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidosYaProductMapping` ADD CONSTRAINT `PedidosYaProductMapping_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidosYaProductMapping` ADD CONSTRAINT `PedidosYaProductMapping_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `MenuItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidosYaWebhookLog` ADD CONSTRAINT `PedidosYaWebhookLog_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidosYaOrderSync` ADD CONSTRAINT `PedidosYaOrderSync_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PedidosYaOrderSync` ADD CONSTRAINT `PedidosYaOrderSync_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
