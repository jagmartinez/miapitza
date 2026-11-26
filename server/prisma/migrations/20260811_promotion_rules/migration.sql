-- Promotion rules: happy hour, per-item promotions (incl. "N x M"), combos and
-- branch-specific promotions.
--
-- Existing promotions keep their behavior: scope defaults to ORDER (discount
-- over the order subtotal), no weekday/time window and allBranches = true.
--
-- * scope ITEMS: the discount is computed per eligible line (PromotionTarget =
--   menu items and/or categories; exactly one of menuItemId/categoryId is set,
--   enforced by the service).
-- * type BUY_X_GET_Y: every buyQuantity eligible units pay payQuantity (the
--   cheapest units are free).
-- * type COMBO: value is the combo price for one complete set of
--   PromotionComboItem; the order line prices stay intact (inventory is still
--   consumed per real item) and the difference is discounted per set.
-- * weekdays / dailyStartTime / dailyEndTime: happy hour in the company time
--   zone; a window with start > end crosses midnight.
-- * PromotionBranch: branches a promotion is limited to when allBranches = 0.
-- * OrderItem.promotionDiscount: part of Order.discount attributed to the line,
--   so partial credit notes and split bills return/charge the exact amount.
-- * OrderItem.createdAt: happy-hour promotions only discount lines ordered
--   inside the window. Existing rows receive the migration timestamp.
ALTER TABLE `Promotion`
    MODIFY `type` ENUM('PERCENTAGE', 'FIXED_AMOUNT', 'BUY_X_GET_Y', 'COMBO') NOT NULL DEFAULT 'PERCENTAGE',
    ADD COLUMN `scope` ENUM('ORDER', 'ITEMS') NOT NULL DEFAULT 'ORDER',
    ADD COLUMN `weekdays` VARCHAR(20) NULL,
    ADD COLUMN `dailyStartTime` VARCHAR(5) NULL,
    ADD COLUMN `dailyEndTime` VARCHAR(5) NULL,
    ADD COLUMN `allBranches` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `buyQuantity` INTEGER NULL,
    ADD COLUMN `payQuantity` INTEGER NULL;

ALTER TABLE `OrderItem`
    ADD COLUMN `promotionDiscount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE TABLE `PromotionBranch` (
    `promotionId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,

    INDEX `PromotionBranch_branchId_idx`(`branchId`),
    PRIMARY KEY (`promotionId`, `branchId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PromotionTarget` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `promotionId` INTEGER NOT NULL,
    `menuItemId` INTEGER NULL,
    `categoryId` INTEGER NULL,

    UNIQUE INDEX `PromotionTarget_promotionId_menuItemId_key`(`promotionId`, `menuItemId`),
    UNIQUE INDEX `PromotionTarget_promotionId_categoryId_key`(`promotionId`, `categoryId`),
    INDEX `PromotionTarget_menuItemId_idx`(`menuItemId`),
    INDEX `PromotionTarget_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PromotionComboItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `promotionId` INTEGER NOT NULL,
    `menuItemId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `PromotionComboItem_promotionId_menuItemId_key`(`promotionId`, `menuItemId`),
    INDEX `PromotionComboItem_menuItemId_idx`(`menuItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PromotionBranch` ADD CONSTRAINT `PromotionBranch_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PromotionBranch` ADD CONSTRAINT `PromotionBranch_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PromotionTarget` ADD CONSTRAINT `PromotionTarget_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PromotionTarget` ADD CONSTRAINT `PromotionTarget_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `MenuItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PromotionTarget` ADD CONSTRAINT `PromotionTarget_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PromotionComboItem` ADD CONSTRAINT `PromotionComboItem_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PromotionComboItem` ADD CONSTRAINT `PromotionComboItem_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `MenuItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
