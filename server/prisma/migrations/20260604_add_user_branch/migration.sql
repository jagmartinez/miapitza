-- Branch rotation: a user can be permitted to work in several branches.
-- `User.branchId` remains the currently active branch (set by a SUPERADMIN);
-- it must be one of the permitted branches recorded here.

CREATE TABLE `UserBranch` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `userId` INT NOT NULL,
    `branchId` INT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `UserBranch_userId_branchId_key`(`userId`, `branchId`),
    INDEX `UserBranch_branchId_idx`(`branchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UserBranch`
    ADD CONSTRAINT `UserBranch_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `UserBranch`
    ADD CONSTRAINT `UserBranch_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every user with an active branch is allowed in that branch.
INSERT INTO `UserBranch` (`userId`, `branchId`)
SELECT `id`, `branchId` FROM `User` WHERE `branchId` IS NOT NULL;
