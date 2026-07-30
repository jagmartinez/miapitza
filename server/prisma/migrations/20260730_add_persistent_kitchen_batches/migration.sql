-- A commercial order may generate multiple independent kitchen waves.
-- Each wave owns its lifecycle and timestamps while the waiter keeps one bill.
CREATE TABLE `KitchenBatch` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `companyId` INTEGER NOT NULL,
  `branchId` INTEGER NOT NULL,
  `orderId` INTEGER NOT NULL,
  `sequence` INTEGER NOT NULL,
  `status` ENUM('PENDING', 'IN_PREPARATION', 'READY', 'RELEASED') NOT NULL DEFAULT 'PENDING',
  `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `startedAt` DATETIME(3) NULL,
  `readyAt` DATETIME(3) NULL,
  `releasedAt` DATETIME(3) NULL,
  `startedById` INTEGER NULL,
  `releasedById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `KitchenBatch_orderId_sequence_key` (`orderId`, `sequence`),
  INDEX `KitchenBatch_company_branch_status_sent_idx` (`companyId`, `branchId`, `status`, `sentAt`),
  INDEX `KitchenBatch_order_status_sent_idx` (`orderId`, `status`, `sentAt`),
  INDEX `KitchenBatch_startedById_idx` (`startedById`),
  INDEX `KitchenBatch_releasedById_idx` (`releasedById`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OrderItem`
  ADD COLUMN `kitchenBatchId` INTEGER NULL,
  ADD INDEX `OrderItem_kitchenBatchId_idx` (`kitchenBatchId`);

-- Preserve every historical sentAt wave. Only the newest unreleased wave can
-- remain active; older waves are historical even when the legacy order-level
-- release timestamp did not retain their individual handoff.
INSERT INTO `KitchenBatch` (
  `companyId`,
  `branchId`,
  `orderId`,
  `sequence`,
  `status`,
  `sentAt`,
  `startedAt`,
  `readyAt`,
  `releasedAt`,
  `createdAt`,
  `updatedAt`
)
SELECT
  grouped.`companyId`,
  grouped.`branchId`,
  grouped.`orderId`,
  ROW_NUMBER() OVER (
    PARTITION BY grouped.`orderId`
    ORDER BY grouped.`sentAt`, grouped.`orderId`
  ) AS `sequence`,
  CASE
    WHEN grouped.`sentAt` < grouped.`latestSentAt` THEN 'RELEASED'
    WHEN grouped.`legacyReleasedAt` IS NOT NULL THEN 'RELEASED'
    WHEN grouped.`inProgressCount` > 0 THEN 'IN_PREPARATION'
    WHEN grouped.`openItemCount` > 0 THEN 'PENDING'
    ELSE 'READY'
  END AS `status`,
  grouped.`sentAt`,
  grouped.`startedAt`,
  CASE WHEN grouped.`openItemCount` = 0 THEN grouped.`readyAt` ELSE NULL END,
  CASE
    WHEN grouped.`sentAt` < grouped.`latestSentAt` THEN COALESCE(grouped.`readyAt`, grouped.`sentAt`)
    WHEN grouped.`legacyReleasedAt` IS NOT NULL THEN grouped.`legacyReleasedAt`
    ELSE NULL
  END,
  grouped.`sentAt`,
  CURRENT_TIMESTAMP(3)
FROM (
  SELECT
    o.`companyId`,
    o.`branchId`,
    oi.`orderId`,
    oi.`sentAt`,
    MAX(oi.`sentAt`) OVER (PARTITION BY oi.`orderId`) AS `latestSentAt`,
    MIN(oi.`startedAt`) AS `startedAt`,
    MAX(oi.`finishedAt`) AS `readyAt`,
    SUM(CASE WHEN oi.`status` = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS `inProgressCount`,
    SUM(CASE WHEN oi.`status` <> 'DONE' THEN 1 ELSE 0 END) AS `openItemCount`,
    o.`kitchenReleasedAt` AS `legacyReleasedAt`
  FROM `OrderItem` oi
  INNER JOIN `Order` o ON o.`id` = oi.`orderId`
  WHERE oi.`sentAt` IS NOT NULL
  GROUP BY
    o.`companyId`,
    o.`branchId`,
    oi.`orderId`,
    oi.`sentAt`,
    o.`kitchenReleasedAt`
) grouped;

UPDATE `OrderItem` oi
INNER JOIN `KitchenBatch` kb
  ON kb.`orderId` = oi.`orderId`
 AND kb.`sentAt` = oi.`sentAt`
SET oi.`kitchenBatchId` = kb.`id`
WHERE oi.`sentAt` IS NOT NULL;

ALTER TABLE `KitchenBatch`
  ADD CONSTRAINT `KitchenBatch_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `KitchenBatch_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `KitchenBatch_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `KitchenBatch_startedById_fkey`
    FOREIGN KEY (`startedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `KitchenBatch_releasedById_fkey`
    FOREIGN KEY (`releasedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `OrderItem`
  ADD CONSTRAINT `OrderItem_kitchenBatchId_fkey`
    FOREIGN KEY (`kitchenBatchId`) REFERENCES `KitchenBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
