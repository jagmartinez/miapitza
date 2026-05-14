-- Migration: 001_api_keys
-- Description: Creates the ApiKey table for external API key authentication.
--
-- Model: ApiKey
--   id          Int       @id @default(autoincrement())
--   companyId   Int       (FK -> Company.id, CASCADE)
--   name        String    @db.VarChar(100)
--   keyHash     String    @db.VarChar(64) @unique
--   keyPrefix   String    @db.VarChar(8)
--   scopes      Json      @default("[]")
--   active      Boolean   @default(true)
--   expiresAt   DateTime? @db.DateTime(3)
--   lastUsedAt  DateTime? @db.DateTime(3)
--   createdAt   DateTime  @default(now()) @db.DateTime(3)
--   createdBy   Int?      (FK -> User.id, SET NULL)

CREATE TABLE `ApiKey` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `companyId` INT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `keyHash` VARCHAR(64) NOT NULL,
  `keyPrefix` VARCHAR(8) NOT NULL,
  `scopes` JSON NOT NULL DEFAULT ('[]'),
  `active` BOOLEAN NOT NULL DEFAULT true,
  `expiresAt` DATETIME(3) NULL,
  `lastUsedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdBy` INT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ApiKey_keyHash_key`(`keyHash`),
  INDEX `ApiKey_companyId_idx`(`companyId`),
  INDEX `ApiKey_keyPrefix_idx`(`keyPrefix`),
  CONSTRAINT `ApiKey_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE,
  CONSTRAINT `ApiKey_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE SET NULL
);
