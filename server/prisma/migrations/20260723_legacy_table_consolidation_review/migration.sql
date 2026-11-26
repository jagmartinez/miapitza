-- Administrative review ledger for pre-snapshot table consolidations.
-- It records evidence and disposition only; it never backfills or mutates
-- historical Order or OrderItem state.
CREATE TABLE `LegacyTableConsolidationReview` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NULL,
    `candidateKey` CHAR(64) NOT NULL,
    `evidenceHash` CHAR(64) NOT NULL,
    `revision` INTEGER NOT NULL,
    `classification` ENUM('NOT_REVERSIBLE', 'AMBIGUOUS') NOT NULL,
    `outcome` ENUM('ACKNOWLEDGED_NO_AUTOMATIC_REVERSAL', 'EXTERNAL_EVIDENCE_REQUIRED') NOT NULL,
    `note` VARCHAR(1000) NOT NULL,
    `resolutionKey` VARCHAR(191) NOT NULL,
    `evidenceSnapshot` JSON NOT NULL,
    `reviewedById` INTEGER NOT NULL,
    `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LegacyTableConsolidationReview_company_candidate_evidence_key`(`companyId`, `candidateKey`, `evidenceHash`),
    UNIQUE INDEX `LegacyTableConsolidationReview_company_candidate_revision_key`(`companyId`, `candidateKey`, `revision`),
    UNIQUE INDEX `LegacyTableConsolidationReview_company_resolution_key`(`companyId`, `resolutionKey`),
    INDEX `LegacyTableConsolidationReview_company_branch_class_idx`(`companyId`, `branchId`, `classification`),
    INDEX `LegacyTableConsolidationReview_reviewedById_idx`(`reviewedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `LegacyTableConsolidationReview`
    ADD CONSTRAINT `LegacyTableConsolidationReview_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `LegacyTableConsolidationReview_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `LegacyTableConsolidationReview_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
