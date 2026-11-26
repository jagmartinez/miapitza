CREATE TABLE `StorageIdentity` (
    `singletonKey` VARCHAR(32) NOT NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StorageIdentity_fingerprint_key`(`fingerprint`),
    CONSTRAINT `StorageIdentity_singleton_check` CHECK (`singletonKey` = 'PRIMARY'),
    PRIMARY KEY (`singletonKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
