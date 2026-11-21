-- Customer NPS survey (Android app, phase 5a): one anonymous response per
-- order, attributed to the order's waiter, plus the `surveys.view` permission.
-- Additive only.
CREATE TABLE `SurveyResponse` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `companyId` INTEGER NOT NULL,
  `branchId` INTEGER NOT NULL,
  `orderId` INTEGER NOT NULL,
  `waiterUserId` INTEGER NOT NULL,
  `operationalDeviceId` INTEGER NOT NULL,
  `nps` INTEGER NOT NULL,
  `waiterRating` INTEGER NULL,
  `serviceRating` INTEGER NULL,
  `foodRating` INTEGER NULL,
  `comment` VARCHAR(500) NULL,
  `contactPhone` VARCHAR(30) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `SurveyResponse_orderId_key` (`orderId`),
  INDEX `SurveyResponse_companyId_branchId_createdAt_idx` (`companyId`, `branchId`, `createdAt`),
  INDEX `SurveyResponse_waiterUserId_createdAt_idx` (`waiterUserId`, `createdAt`),
  INDEX `SurveyResponse_operationalDeviceId_idx` (`operationalDeviceId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `SurveyResponse_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SurveyResponse_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SurveyResponse_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SurveyResponse_waiterUserId_fkey` FOREIGN KEY (`waiterUserId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SurveyResponse_operationalDeviceId_fkey` FOREIGN KEY (`operationalDeviceId`) REFERENCES `OperationalDevice` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `Permission` (`name`, `description`) VALUES
  ('surveys.view', 'Ver el reporte de encuestas de satisfaccion de clientes');

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r ON r.`name` IN ('SUPERADMIN', 'ADMIN')
WHERE p.`name` = 'surveys.view';
