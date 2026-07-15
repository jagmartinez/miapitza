-- RH Fase 5: nómina regular y aguinaldo. Migración aditiva; no calcula ni
-- presume fórmulas legales. La configuración legal se carga por proceso técnico.

CREATE TABLE `PayrollRuleVersion` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `name` VARCHAR(120) NOT NULL,
  `version` INTEGER NOT NULL, `status` ENUM('DRAFT','ACTIVE','RETIRED') NOT NULL DEFAULT 'DRAFT',
  `effectiveFrom` DATE NOT NULL, `effectiveTo` DATE NULL, `sourceReference` VARCHAR(500) NOT NULL,
  `description` TEXT NULL, `configurationSummary` VARCHAR(500) NULL,
  `revision` INTEGER NOT NULL DEFAULT 0, `createdById` INTEGER NOT NULL, `validatedById` INTEGER NULL,
  `validatedAt` DATETIME(3) NULL, `activatedAt` DATETIME(3) NULL, `retiredAt` DATETIME(3) NULL,
  `activeConfigurationRevisionId` INTEGER NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `PayrollRuleVersion_companyId_name_version_key` (`companyId`,`name`,`version`),
  INDEX `PayrollRuleVersion_companyId_status_effectiveFrom_effectiveTo_idx` (`companyId`,`status`,`effectiveFrom`,`effectiveTo`),
  CONSTRAINT `PayrollRuleVersion_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRuleVersion_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRuleVersion_validatedById_fkey` FOREIGN KEY (`validatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollRuleConfigurationRevision` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `ruleVersionId` INTEGER NOT NULL, `revision` INTEGER NOT NULL,
  `configuration` JSON NOT NULL, `configurationHash` CHAR(64) NOT NULL, `sourceReference` VARCHAR(500) NOT NULL,
  `evidenceReference` VARCHAR(500) NOT NULL, `uploadReason` TEXT NOT NULL, `uploadedById` INTEGER NOT NULL,
  `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `PayrollRuleConfigurationRevision_ruleVersionId_revision_key` (`ruleVersionId`,`revision`),
  UNIQUE INDEX `PayrollRuleConfigurationRevision_ruleVersionId_configurationHash_key` (`ruleVersionId`,`configurationHash`),
  INDEX `PayrollRuleConfigurationRevision_companyId_uploadedAt_idx` (`companyId`,`uploadedAt`),
  CONSTRAINT `PayrollRuleConfigurationRevision_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRuleConfigurationRevision_ruleVersionId_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `PayrollRuleVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRuleConfigurationRevision_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollRuleConfigurationReview` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `configurationRevisionId` INTEGER NOT NULL,
  `decision` ENUM('VALIDATED','REJECTED') NOT NULL, `reason` TEXT NOT NULL, `reviewerId` INTEGER NOT NULL,
  `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `PayrollRuleConfigurationReview_configurationRevisionId_key` (`configurationRevisionId`),
  INDEX `PayrollRuleConfigurationReview_companyId_reviewedAt_idx` (`companyId`,`reviewedAt`),
  CONSTRAINT `PayrollRuleConfigurationReview_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRuleConfigurationReview_configurationRevisionId_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `PayrollRuleConfigurationRevision`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRuleConfigurationReview_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PayrollRuleVersion` ADD UNIQUE INDEX `PayrollRuleVersion_activeConfigurationRevisionId_key` (`activeConfigurationRevisionId`);
ALTER TABLE `PayrollRuleVersion` ADD CONSTRAINT `PayrollRuleVersion_activeConfigurationRevisionId_fkey` FOREIGN KEY (`activeConfigurationRevisionId`) REFERENCES `PayrollRuleConfigurationRevision`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `PayrollPeriod` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `code` VARCHAR(64) NOT NULL,
  `dateFrom` DATE NOT NULL, `dateTo` DATE NOT NULL, `payDate` DATE NOT NULL, `timezone` VARCHAR(64) NOT NULL,
  `status` ENUM('DRAFT','OPEN','CLOSED','VOID') NOT NULL DEFAULT 'DRAFT', `revision` INTEGER NOT NULL DEFAULT 0,
  `reason` TEXT NOT NULL, `createdById` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `PayrollPeriod_companyId_code_key` (`companyId`,`code`),
  UNIQUE INDEX `PayrollPeriod_companyId_dateFrom_dateTo_key` (`companyId`,`dateFrom`,`dateTo`),
  INDEX `PayrollPeriod_companyId_status_payDate_idx` (`companyId`,`status`,`payDate`),
  CONSTRAINT `PayrollPeriod_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollPeriod_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollRun` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `kind` ENUM('REGULAR','AGUINALDO') NOT NULL,
  `code` VARCHAR(80) NOT NULL, `status` ENUM('DRAFT','CALCULATED','REVIEW','APPROVED','PAID','VOID') NOT NULL DEFAULT 'DRAFT',
  `periodId` INTEGER NULL, `ruleVersionId` INTEGER NOT NULL, `configurationRevisionId` INTEGER NULL, `year` INTEGER NULL, `cutoffDate` DATE NULL,
  `branchIds` JSON NULL, `employeeIds` JSON NULL, `revision` INTEGER NOT NULL DEFAULT 0, `calculationRevision` INTEGER NULL, `currency` VARCHAR(3) NOT NULL DEFAULT 'NIO',
  `grossIncome` DECIMAL(18,2) NOT NULL DEFAULT 0, `totalDeductions` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `employerContributions` DECIMAL(18,2) NOT NULL DEFAULT 0, `netPay` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `employeeCount` INTEGER NOT NULL DEFAULT 0, `lastReason` TEXT NULL, `createdById` INTEGER NOT NULL,
  `calculatedById` INTEGER NULL, `reviewSubmittedById` INTEGER NULL, `approvedById` INTEGER NULL,
  `paidById` INTEGER NULL, `voidedById` INTEGER NULL, `calculatedAt` DATETIME(3) NULL,
  `reviewSubmittedAt` DATETIME(3) NULL, `approvedAt` DATETIME(3) NULL, `paidAt` DATETIME(3) NULL, `voidedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `PayrollRun_companyId_code_key` (`companyId`,`code`),
  INDEX `PayrollRun_companyId_kind_status_createdAt_idx` (`companyId`,`kind`,`status`,`createdAt`), INDEX `PayrollRun_periodId_idx` (`periodId`), INDEX `PayrollRun_ruleVersionId_idx` (`ruleVersionId`), INDEX `PayrollRun_configurationRevisionId_idx` (`configurationRevisionId`),
  CONSTRAINT `PayrollRun_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRun_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `PayrollPeriod`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRun_ruleVersionId_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `PayrollRuleVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRun_configurationRevisionId_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `PayrollRuleConfigurationRevision`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRun_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRun_calculatedById_fkey` FOREIGN KEY (`calculatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRun_reviewSubmittedById_fkey` FOREIGN KEY (`reviewSubmittedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRun_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRun_paidById_fkey` FOREIGN KEY (`paidById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRun_voidedById_fkey` FOREIGN KEY (`voidedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRun_shape_ck` CHECK ((`kind`='REGULAR' AND `periodId` IS NOT NULL AND `year` IS NULL AND `cutoffDate` IS NULL) OR (`kind`='AGUINALDO' AND `periodId` IS NULL AND `year` IS NOT NULL AND `cutoffDate` IS NOT NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollSnapshotLine` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `runId` INTEGER NOT NULL, `userId` INTEGER NOT NULL,
  `employeeId` INTEGER NOT NULL, `branchId` INTEGER NULL, `attendancePeriodId` INTEGER NULL, `compensationHistoryId` INTEGER NULL,
  `ordinaryMinutes` INTEGER NOT NULL DEFAULT 0, `approvedOvertimeMinutes` INTEGER NOT NULL DEFAULT 0,
  `paidLeaveAmount` DECIMAL(18,2) NOT NULL DEFAULT 0, `unpaidLeaveAmount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `compensationAmount` DECIMAL(18,2) NULL, `compensationType` VARCHAR(32) NULL, `payFrequency` VARCHAR(32) NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'NIO', `sourceRevision` INTEGER NULL, `sourceTrace` JSON NOT NULL,
  `coverageFrom` DATE NOT NULL, `coverageTo` DATE NOT NULL, `attendancePeriodRevision` INTEGER NULL, `attendancePeriodStatus` VARCHAR(32) NULL,
  `summaryRevisions` JSON NOT NULL, `contractSegments` JSON NOT NULL, `compensationSegments` JSON NOT NULL, `aguinaldoIncomeSegments` JSON NOT NULL,
  `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `PayrollSnapshotLine_runId_userId_key` (`runId`,`userId`), INDEX `PayrollSnapshotLine_companyId_runId_idx` (`companyId`,`runId`), INDEX `PayrollSnapshotLine_attendancePeriodId_idx` (`attendancePeriodId`),
  CONSTRAINT `PayrollSnapshotLine_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollSnapshotLine_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollSnapshotLine_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollSnapshotLine_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollSnapshotLine_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollSnapshotLine_attendancePeriodId_fkey` FOREIGN KEY (`attendancePeriodId`) REFERENCES `AttendancePeriod`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollSnapshotLine_compensationHistoryId_fkey` FOREIGN KEY (`compensationHistoryId`) REFERENCES `CompensationHistory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollAnomaly` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `runId` INTEGER NOT NULL, `employeeId` INTEGER NULL, `userId` INTEGER NULL,
  `code` VARCHAR(64) NOT NULL, `severity` ENUM('INFO','WARNING','BLOCKING') NOT NULL, `message` TEXT NOT NULL,
  `blocking` BOOLEAN NOT NULL DEFAULT false, `resolvedAt` DATETIME(3) NULL, `resolutionReason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`), INDEX `PayrollAnomaly_companyId_runId_severity_idx` (`companyId`,`runId`,`severity`),
  CONSTRAINT `PayrollAnomaly_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollAnomaly_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollAnomaly_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollAnomaly_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollReceipt` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `runId` INTEGER NOT NULL, `userId` INTEGER NOT NULL, `employeeId` INTEGER NOT NULL,
  `runKind` ENUM('REGULAR','AGUINALDO') NOT NULL, `runCode` VARCHAR(80) NOT NULL, `periodLabel` VARCHAR(160) NOT NULL, `payDate` DATE NOT NULL,
  `currency` VARCHAR(3) NOT NULL, `grossIncome` DECIMAL(18,2) NOT NULL, `totalDeductions` DECIMAL(18,2) NOT NULL, `netPay` DECIMAL(18,2) NOT NULL,
  `status` ENUM('PUBLISHED','VOID') NOT NULL DEFAULT 'PUBLISHED', `publishedAt` DATETIME(3) NULL, `voidedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`), UNIQUE INDEX `PayrollReceipt_runId_userId_key` (`runId`,`userId`),
  INDEX `PayrollReceipt_companyId_userId_status_payDate_idx` (`companyId`,`userId`,`status`,`payDate`),
  CONSTRAINT `PayrollReceipt_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollReceipt_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollReceipt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollReceipt_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollComponent` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `runId` INTEGER NOT NULL, `receiptId` INTEGER NULL, `userId` INTEGER NOT NULL,
  `code` VARCHAR(64) NOT NULL, `name` VARCHAR(160) NOT NULL, `type` ENUM('INCOME','DEDUCTION') NOT NULL, `source` VARCHAR(32) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL, `taxable` BOOLEAN NULL, `traceReference` VARCHAR(500) NULL, `reason` TEXT NULL, `createdById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`), INDEX `PayrollComponent_companyId_runId_userId_idx` (`companyId`,`runId`,`userId`), INDEX `PayrollComponent_receiptId_idx` (`receiptId`),
  CONSTRAINT `PayrollComponent_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollComponent_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollComponent_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `PayrollReceipt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollComponent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollComponent_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollComponent_nonnegative_ck` CHECK (`amount` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollAguinaldoSourceDependency` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `targetRunId` INTEGER NOT NULL, `calculationRevision` INTEGER NOT NULL,
  `sourceRunId` INTEGER NOT NULL, `sourceComponentId` INTEGER NOT NULL, `sourceReceiptId` INTEGER NOT NULL,
  `capturedRunRevision` INTEGER NOT NULL, `capturedRunStatus` ENUM('DRAFT','CALCULATED','REVIEW','APPROVED','PAID','VOID') NOT NULL,
  `capturedRunCurrency` VARCHAR(3) NOT NULL, `capturedComponentAmount` DECIMAL(18,2) NOT NULL,
  `capturedReceiptStatus` ENUM('PUBLISHED','VOID') NOT NULL, `capturedComponentReversed` BOOLEAN NOT NULL,
  `capturedRunReversed` BOOLEAN NOT NULL, `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `PayrollAguinaldoDependency_target_revision_component_key` (`targetRunId`,`calculationRevision`,`sourceComponentId`),
  INDEX `PayrollAguinaldoDependency_target_idx` (`companyId`,`targetRunId`,`calculationRevision`),
  INDEX `PayrollAguinaldoDependency_source_run_idx` (`companyId`,`sourceRunId`),
  INDEX `PayrollAguinaldoDependency_component_idx` (`sourceComponentId`), INDEX `PayrollAguinaldoDependency_receipt_idx` (`sourceReceiptId`),
  CONSTRAINT `PayrollAguinaldoDependency_company_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollAguinaldoDependency_target_run_fkey` FOREIGN KEY (`targetRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollAguinaldoDependency_source_run_fkey` FOREIGN KEY (`sourceRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollAguinaldoDependency_component_fkey` FOREIGN KEY (`sourceComponentId`) REFERENCES `PayrollComponent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollAguinaldoDependency_receipt_fkey` FOREIGN KEY (`sourceReceiptId`) REFERENCES `PayrollReceipt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollTrace` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `runId` INTEGER NOT NULL, `event` VARCHAR(64) NOT NULL,
  `actorId` INTEGER NULL, `reason` TEXT NULL, `fromStatus` VARCHAR(32) NULL, `toStatus` VARCHAR(32) NULL, `revision` INTEGER NOT NULL,
  `metadata` JSON NULL, `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`), INDEX `PayrollTrace_companyId_runId_occurredAt_idx` (`companyId`,`runId`,`occurredAt`),
  CONSTRAINT `PayrollTrace_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollTrace_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollTrace_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollRunReversal` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `runId` INTEGER NOT NULL, `actorId` INTEGER NOT NULL,
  `reason` TEXT NOT NULL, `reversedGrossIncome` DECIMAL(18,2) NOT NULL, `reversedDeductions` DECIMAL(18,2) NOT NULL,
  `reversedNetPay` DECIMAL(18,2) NOT NULL, `originalStatus` VARCHAR(32) NOT NULL,
  `reversalReference` VARCHAR(160) NULL, `reversalDate` DATE NULL, `reversalMethod` VARCHAR(80) NULL, `evidenceReference` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`), UNIQUE INDEX `PayrollRunReversal_runId_key` (`runId`),
  UNIQUE INDEX `PayrollRunReversal_company_reference_key` (`companyId`,`reversalReference`),
  INDEX `PayrollRunReversal_companyId_createdAt_idx` (`companyId`,`createdAt`),
  CONSTRAINT `PayrollRunReversal_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRunReversal_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRunReversal_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollIdempotencyRecord` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `key` VARCHAR(128) NOT NULL, `operation` VARCHAR(80) NOT NULL,
  `requestHash` VARCHAR(64) NOT NULL, `response` JSON NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `PayrollIdempotencyRecord_companyId_key_key` (`companyId`,`key`), INDEX `PayrollIdempotencyRecord_companyId_operation_createdAt_idx` (`companyId`,`operation`,`createdAt`),
  CONSTRAINT `PayrollIdempotencyRecord_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollAttendanceDependency` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `runId` INTEGER NOT NULL, `attendancePeriodId` INTEGER NOT NULL,
  `capturedPeriodRevision` INTEGER NOT NULL, `capturedPeriodStatus` VARCHAR(32) NOT NULL, `capturedPayrollEligible` BOOLEAN NOT NULL,
  `summaryFingerprint` CHAR(64) NOT NULL, `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `PayrollAttendanceDependency_runId_attendancePeriodId_key` (`runId`,`attendancePeriodId`), INDEX `PayrollAttendanceDependency_companyId_attendancePeriodId_idx` (`companyId`,`attendancePeriodId`),
  CONSTRAINT `PayrollAttendanceDependency_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollAttendanceDependency_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollAttendanceDependency_attendancePeriodId_fkey` FOREIGN KEY (`attendancePeriodId`) REFERENCES `AttendancePeriod`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollCoverageClaim` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `runId` INTEGER NOT NULL, `userId` INTEGER NOT NULL,
  `kind` ENUM('REGULAR','AGUINALDO') NOT NULL, `coverageFrom` DATE NOT NULL, `coverageTo` DATE NOT NULL, `coverageKey` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `PayrollCoverageClaim_runId_userId_kind_coverageKey_key` (`runId`,`userId`,`kind`,`coverageKey`),
  INDEX `PayrollCoverageClaim_companyId_userId_kind_coverageFrom_coverageTo_idx` (`companyId`,`userId`,`kind`,`coverageFrom`,`coverageTo`),
  CONSTRAINT `PayrollCoverageClaim_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollCoverageClaim_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollCoverageClaim_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollCoverageRelease` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `claimId` INTEGER NOT NULL, `runId` INTEGER NOT NULL,
  `actorId` INTEGER NOT NULL, `reason` TEXT NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `PayrollCoverageRelease_claimId_key` (`claimId`), INDEX `PayrollCoverageRelease_companyId_runId_idx` (`companyId`,`runId`),
  CONSTRAINT `PayrollCoverageRelease_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollCoverageRelease_claimId_fkey` FOREIGN KEY (`claimId`) REFERENCES `PayrollCoverageClaim`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollCoverageRelease_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollCoverageRelease_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollComponentReversal` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `componentId` INTEGER NOT NULL, `runId` INTEGER NOT NULL,
  `actorId` INTEGER NOT NULL, `amount` DECIMAL(18,2) NOT NULL, `reason` TEXT NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `PayrollComponentReversal_componentId_key` (`componentId`), INDEX `PayrollComponentReversal_companyId_runId_idx` (`companyId`,`runId`),
  CONSTRAINT `PayrollComponentReversal_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollComponentReversal_componentId_fkey` FOREIGN KEY (`componentId`) REFERENCES `PayrollComponent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollComponentReversal_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollComponentReversal_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollPaymentRecord` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `runId` INTEGER NOT NULL, `paymentReference` VARCHAR(160) NOT NULL,
  `paymentDate` DATE NOT NULL, `paymentMethod` VARCHAR(80) NOT NULL, `batchReference` VARCHAR(160) NULL, `evidenceReference` VARCHAR(500) NOT NULL,
  `actorId` INTEGER NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `PayrollPaymentRecord_runId_key` (`runId`), UNIQUE INDEX `PayrollPaymentRecord_companyId_paymentReference_key` (`companyId`,`paymentReference`),
  INDEX `PayrollPaymentRecord_companyId_paymentDate_idx` (`companyId`,`paymentDate`),
  CONSTRAINT `PayrollPaymentRecord_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollPaymentRecord_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollPaymentRecord_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TRIGGER `PayrollTrace_no_update`
BEFORE UPDATE ON `PayrollTrace`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollTrace is append-only';

CREATE TRIGGER `PayrollTrace_no_delete`
BEFORE DELETE ON `PayrollTrace`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollTrace is append-only';

CREATE TRIGGER `PayrollRuleConfigurationRevision_no_update` BEFORE UPDATE ON `PayrollRuleConfigurationRevision` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollRuleConfigurationRevision is append-only';
CREATE TRIGGER `PayrollRuleConfigurationRevision_no_delete` BEFORE DELETE ON `PayrollRuleConfigurationRevision` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollRuleConfigurationRevision is append-only';
CREATE TRIGGER `PayrollRuleConfigurationReview_no_update` BEFORE UPDATE ON `PayrollRuleConfigurationReview` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollRuleConfigurationReview is append-only';
CREATE TRIGGER `PayrollRuleConfigurationReview_no_delete` BEFORE DELETE ON `PayrollRuleConfigurationReview` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollRuleConfigurationReview is append-only';
CREATE TRIGGER `PayrollRunReversal_no_update` BEFORE UPDATE ON `PayrollRunReversal` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollRunReversal is append-only';
CREATE TRIGGER `PayrollRunReversal_no_delete` BEFORE DELETE ON `PayrollRunReversal` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollRunReversal is append-only';
CREATE TRIGGER `PayrollComponentReversal_no_update` BEFORE UPDATE ON `PayrollComponentReversal` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollComponentReversal is append-only';
CREATE TRIGGER `PayrollComponentReversal_no_delete` BEFORE DELETE ON `PayrollComponentReversal` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollComponentReversal is append-only';
CREATE TRIGGER `PayrollCoverageClaim_no_update` BEFORE UPDATE ON `PayrollCoverageClaim` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollCoverageClaim is append-only';
CREATE TRIGGER `PayrollCoverageClaim_no_delete` BEFORE DELETE ON `PayrollCoverageClaim` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollCoverageClaim is append-only';
CREATE TRIGGER `PayrollCoverageRelease_no_update` BEFORE UPDATE ON `PayrollCoverageRelease` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollCoverageRelease is append-only';
CREATE TRIGGER `PayrollCoverageRelease_no_delete` BEFORE DELETE ON `PayrollCoverageRelease` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollCoverageRelease is append-only';
CREATE TRIGGER `PayrollAguinaldoDependency_no_update` BEFORE UPDATE ON `PayrollAguinaldoSourceDependency` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollAguinaldoSourceDependency is append-only';
CREATE TRIGGER `PayrollAguinaldoDependency_no_delete` BEFORE DELETE ON `PayrollAguinaldoSourceDependency` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollAguinaldoSourceDependency is append-only';

INSERT IGNORE INTO `Permission` (`name`) VALUES ('hr.payroll.read'),('hr.payroll.manage'),('hr.payroll.approve'),('hr.payroll.self');
INSERT IGNORE INTO `_PermissionToRole` (`A`,`B`) SELECT p.`id`,r.`id` FROM `Permission` p JOIN `Role` r WHERE r.`name`='SUPERADMIN' AND p.`name` IN ('hr.payroll.read','hr.payroll.manage','hr.payroll.approve','hr.payroll.self');
INSERT IGNORE INTO `_PermissionToRole` (`A`,`B`) SELECT p.`id`,r.`id` FROM `Permission` p JOIN `Role` r WHERE r.`name` IN ('ADMIN','CAJERO','MESERO','COCINA','CHEF','BODEGA','HOST') AND p.`name`='hr.payroll.self';
