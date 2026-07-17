-- Additive inventory counterflow provenance and explicit cost-quality signals.
-- Existing positive costs are known. Legacy zeroes remain unknown until a user
-- or a valued operational entry explicitly confirms them.
ALTER TABLE `Product`
    ADD COLUMN `referenceCostKnown` BOOLEAN NOT NULL DEFAULT FALSE AFTER `cost`,
    ADD COLUMN `averageCostKnown` BOOLEAN NOT NULL DEFAULT FALSE AFTER `currentAverageCost`,
    ADD COLUMN `lastPurchaseCostKnown` BOOLEAN NOT NULL DEFAULT FALSE AFTER `lastPurchaseCost`;

UPDATE `Product`
SET
    `referenceCostKnown` = (`cost` > 0),
    `averageCostKnown` = (`currentAverageCost` > 0),
    `lastPurchaseCostKnown` = (`lastPurchaseCost` > 0);

ALTER TABLE `InventoryMovement`
    ADD COLUMN `direction` VARCHAR(3) NULL AFTER `transferGroupId`,
    ADD COLUMN `origin` VARCHAR(32) NULL AFTER `direction`,
    ADD COLUMN `reversalOfId` INTEGER NULL AFTER `consumedLayers`,
    ADD COLUMN `reversalGroupId` VARCHAR(191) NULL AFTER `reversalOfId`,
    ADD COLUMN `reversalKey` VARCHAR(191) NULL AFTER `reversalGroupId`;

UPDATE `InventoryMovement`
SET `direction` = CASE
    WHEN `type` = 'IN' THEN 'IN'
    WHEN `type` = 'OUT' THEN 'OUT'
    WHEN `type` = 'ADJUSTMENT' THEN 'IN'
    WHEN `type` = 'TRANSFER' AND LOWER(COALESCE(`reason`, '')) LIKE 'transfer in%' THEN 'IN'
    ELSE 'OUT'
END;

UPDATE `InventoryMovement`
SET `origin` = CASE
    WHEN `type` = 'TRANSFER' AND `transferGroupId` IS NOT NULL THEN 'TRANSFER'
    WHEN `reason` LIKE 'WASTE:%' THEN 'WASTE'
    ELSE NULL
END;

CREATE UNIQUE INDEX `InvMove_reversalOf_key` ON `InventoryMovement`(`reversalOfId`);
CREATE INDEX `InvMove_company_reversalKey_idx` ON `InventoryMovement`(`companyId`, `reversalKey`);
CREATE INDEX `InvMove_reversalGroup_idx` ON `InventoryMovement`(`reversalGroupId`);
ALTER TABLE `InventoryMovement`
    ADD CONSTRAINT `InvMove_reversalOf_fkey`
    FOREIGN KEY (`reversalOfId`) REFERENCES `InventoryMovement`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `InventoryBatch`
    ADD COLUMN `sourceMovementId` INTEGER NULL AFTER `sourceRef`;
CREATE INDEX `InvBatch_sourceMovement_idx` ON `InventoryBatch`(`sourceMovementId`);
ALTER TABLE `InventoryBatch`
    ADD CONSTRAINT `InvBatch_sourceMovement_fkey`
    FOREIGN KEY (`sourceMovementId`) REFERENCES `InventoryMovement`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProductCostHistory`
    ADD COLUMN `inventoryMovementId` INTEGER NULL AFTER `productionOrderId`,
    ADD COLUMN `reversalMovementId` INTEGER NULL AFTER `inventoryMovementId`,
    ADD COLUMN `previousAvgCostKnown` BOOLEAN NOT NULL DEFAULT FALSE AFTER `previousAvgCost`,
    ADD COLUMN `newAvgCostKnown` BOOLEAN NOT NULL DEFAULT TRUE AFTER `newAvgCost`,
    ADD COLUMN `reversedAt` DATETIME(3) NULL AFTER `newStock`;

UPDATE `ProductCostHistory`
SET
    `previousAvgCostKnown` = (`previousAvgCost` > 0),
    `newAvgCostKnown` = (`newAvgCost` > 0);

CREATE UNIQUE INDEX `ProdCostHist_inventoryMove_key` ON `ProductCostHistory`(`inventoryMovementId`);
CREATE UNIQUE INDEX `ProdCostHist_reversalMove_key` ON `ProductCostHistory`(`reversalMovementId`);
ALTER TABLE `ProductCostHistory`
    ADD CONSTRAINT `ProdCostHist_inventoryMove_fkey`
    FOREIGN KEY (`inventoryMovementId`) REFERENCES `InventoryMovement`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ProductCostHistory`
    ADD CONSTRAINT `ProdCostHist_reversalMove_fkey`
    FOREIGN KEY (`reversalMovementId`) REFERENCES `InventoryMovement`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
