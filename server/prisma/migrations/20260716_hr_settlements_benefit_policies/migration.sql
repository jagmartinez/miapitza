CREATE TABLE `HrBenefitPolicyVersion` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `version` INTEGER NOT NULL,
  `status` ENUM('DRAFT','ACTIVE','RETIRED') NOT NULL DEFAULT 'DRAFT', `effectiveFrom` DATE NOT NULL,
  `effectiveTo` DATE NULL, `currency` VARCHAR(3) NOT NULL, `travelCategories` JSON NOT NULL,
  `travelMaxDays` INTEGER NOT NULL,
  `travelEvidenceRequired` BOOLEAN NOT NULL DEFAULT true, `loanMinTenureMonths` INTEGER NOT NULL,
  `loanMaxAmount` DECIMAL(18,2) NOT NULL, `loanMaxInstallments` INTEGER NOT NULL,
  `loanMaxPaymentPercent` DECIMAL(5,2) NOT NULL, `sourceReference` VARCHAR(300) NOT NULL,
  `reason` TEXT NOT NULL, `createdById` INTEGER NOT NULL, `activatedById` INTEGER NULL,
  `activatedAt` DATETIME(3) NULL, `revision` INTEGER NOT NULL DEFAULT 0, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE INDEX `HrBenefitPolicyVersion_companyId_version_key` (`companyId`,`version`),
  INDEX `HrBenefitPolicyVersion_companyId_status_effectiveFrom_idx` (`companyId`,`status`,`effectiveFrom`),
  CONSTRAINT `HrBenefitPolicy_dates_ck` CHECK (`effectiveTo` IS NULL OR `effectiveTo` >= `effectiveFrom`),
  CONSTRAINT `HrBenefitPolicy_limits_ck` CHECK (`travelMaxDays` > 0 AND `loanMaxAmount` > 0 AND `loanMaxInstallments` > 0 AND `loanMaxPaymentPercent` > 0 AND `loanMaxPaymentPercent` <= 100),
  CONSTRAINT `HrBenefitPolicyVersion_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrBenefitPolicyVersion_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrBenefitPolicyVersion_activatedById_fkey` FOREIGN KEY (`activatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `HrTravelRequest` ADD COLUMN `policyVersionId` INTEGER NULL;
ALTER TABLE `HrTravelExpense` ADD COLUMN `occurredTime` VARCHAR(5) NULL, ADD COLUMN `policyCategoryCode` VARCHAR(64) NULL;
ALTER TABLE `HrLoan` ADD COLUMN `policyVersionId` INTEGER NULL;
ALTER TABLE `HrTravelRequest` ADD CONSTRAINT `HrTravelRequest_policyVersionId_fkey` FOREIGN KEY (`policyVersionId`) REFERENCES `HrBenefitPolicyVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `HrLoan` ADD CONSTRAINT `HrLoan_policyVersionId_fkey` FOREIGN KEY (`policyVersionId`) REFERENCES `HrBenefitPolicyVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `HrEmploymentSettlement` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `code` VARCHAR(64) NOT NULL,
  `employeeId` INTEGER NOT NULL, `userId` INTEGER NOT NULL,
  `exitType` ENUM('RESIGNATION','DISMISSAL','MUTUAL_AGREEMENT','CONTRACT_END','OTHER') NOT NULL,
  `cause` VARCHAR(300) NOT NULL, `justification` TEXT NOT NULL, `terminationDate` DATE NOT NULL,
  `currency` VARCHAR(3) NOT NULL, `evidenceReferences` JSON NOT NULL, `grossEarnings` DECIMAL(18,2) NOT NULL,
  `totalDeductions` DECIMAL(18,2) NOT NULL, `netPay` DECIMAL(18,2) NOT NULL, `calculationHash` CHAR(64) NOT NULL,
  `status` ENUM('DRAFT','SUBMITTED','REVIEWED','APPROVED','REJECTED','PAID','VOID') NOT NULL DEFAULT 'DRAFT',
  `revision` INTEGER NOT NULL DEFAULT 0, `createdById` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `HrEmploymentSettlement_companyId_code_key` (`companyId`,`code`),
  INDEX `HrEmploymentSettlement_companyId_status_terminationDate_idx` (`companyId`,`status`,`terminationDate`),
  INDEX `HrEmploymentSettlement_companyId_employeeId_terminationDate_idx` (`companyId`,`employeeId`,`terminationDate`),
  CONSTRAINT `HrEmploymentSettlement_amounts_ck` CHECK (`grossEarnings` >= 0 AND `totalDeductions` >= 0 AND `netPay` >= 0 AND `netPay` = `grossEarnings` - `totalDeductions`),
  CONSTRAINT `HrEmploymentSettlement_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrEmploymentSettlement_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrEmploymentSettlement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrEmploymentSettlement_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HrEmploymentSettlementLine` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `settlementId` INTEGER NOT NULL,
  `type` ENUM('EARNED_SALARY','VACATION','AGUINALDO','INDEMNITY','OTHER_EARNING','DEDUCTION') NOT NULL,
  `concept` VARCHAR(160) NOT NULL, `formulaBasis` VARCHAR(600) NOT NULL, `sourceReference` VARCHAR(300) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `HrEmploymentSettlementLine_companyId_settlementId_type_idx` (`companyId`,`settlementId`,`type`),
  CONSTRAINT `HrEmploymentSettlementLine_amount_ck` CHECK (`amount` > 0),
  CONSTRAINT `HrEmploymentSettlementLine_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrEmploymentSettlementLine_settlementId_fkey` FOREIGN KEY (`settlementId`) REFERENCES `HrEmploymentSettlement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
