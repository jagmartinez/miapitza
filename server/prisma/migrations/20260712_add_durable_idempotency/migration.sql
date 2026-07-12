CREATE TABLE `IdempotencyRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `namespace` VARCHAR(64) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `httpStatus` INTEGER NULL,
    `response` JSON NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IdempotencyRecord_namespace_scope_key_key`(`namespace`, `scope`, `key`),
    INDEX `IdempotencyRecord_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
