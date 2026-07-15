-- Motor estatutario de nómina V2: clasificación de bases, aportes patronales
-- y traza reproducible de INSS, INATEC e IR por colaborador.
ALTER TABLE `PayrollComponent`
  ADD COLUMN `incomeTaxDeductible` BOOLEAN NULL,
  ADD COLUMN `socialSecurityApplicable` BOOLEAN NULL,
  ADD COLUMN `trainingContributionApplicable` BOOLEAN NULL;

ALTER TABLE `PayrollRunReversal`
  ADD COLUMN `reversedEmployerContributions` DECIMAL(18, 2) NOT NULL DEFAULT 0;

CREATE TABLE `PayrollEmployerContribution` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `companyId` INTEGER NOT NULL,
  `runId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `calculationRevision` INTEGER NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `baseAmount` DECIMAL(18, 2) NOT NULL,
  `rate` DECIMAL(10, 6) NOT NULL,
  `amount` DECIMAL(18, 2) NOT NULL,
  `traceReference` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PayrollEmployerContribution_run_rev_user_code_key` (`runId`, `calculationRevision`, `userId`, `code`),
  INDEX `PayrollEmployerContribution_company_run_user_idx` (`companyId`, `runId`, `userId`),
  CONSTRAINT `PayrollEmployerContribution_company_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollEmployerContribution_run_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollEmployerContribution_user_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PayrollStatutoryCalculation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `companyId` INTEGER NOT NULL,
  `runId` INTEGER NOT NULL,
  `userId` INTEGER NOT NULL,
  `calculationRevision` INTEGER NOT NULL,
  `configurationRevisionId` INTEGER NOT NULL,
  `companyTaxRegime` VARCHAR(40) NOT NULL,
  `payFrequency` VARCHAR(32) NOT NULL,
  `employerHeadcount` INTEGER NOT NULL,
  `inssBase` DECIMAL(18, 2) NOT NULL,
  `employeeInss` DECIMAL(18, 2) NOT NULL,
  `employerInssRate` DECIMAL(10, 6) NOT NULL,
  `employerInss` DECIMAL(18, 2) NOT NULL,
  `inatecBase` DECIMAL(18, 2) NOT NULL,
  `employerInatec` DECIMAL(18, 2) NOT NULL,
  `currentIncomeTaxNet` DECIMAL(18, 2) NOT NULL,
  `otherIncomeTaxDeductions` DECIMAL(18, 2) NOT NULL,
  `priorIncomeTaxNet` DECIMAL(18, 2) NOT NULL,
  `accumulatedIncomeTaxNet` DECIMAL(18, 2) NOT NULL,
  `elapsedPeriods` INTEGER NOT NULL,
  `annualPeriods` INTEGER NOT NULL,
  `annualProjection` DECIMAL(18, 2) NOT NULL,
  `annualIncomeTax` DECIMAL(18, 2) NOT NULL,
  `priorIncomeTaxWithheld` DECIMAL(18, 2) NOT NULL,
  `currentIncomeTaxWithheld` DECIMAL(18, 2) NOT NULL,
  `incomeTaxRefund` DECIMAL(18, 2) NOT NULL,
  `bracketSnapshot` JSON NULL,
  `historyFingerprint` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PayrollStatutoryCalculation_run_rev_user_key` (`runId`, `calculationRevision`, `userId`),
  INDEX `PayrollStatutoryCalculation_company_user_idx` (`companyId`, `userId`, `createdAt`),
  INDEX `PayrollStatutoryCalculation_config_idx` (`configurationRevisionId`),
  CONSTRAINT `PayrollStatutoryCalculation_company_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollStatutoryCalculation_run_fkey` FOREIGN KEY (`runId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollStatutoryCalculation_user_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollStatutoryCalculation_config_fkey` FOREIGN KEY (`configurationRevisionId`) REFERENCES `PayrollRuleConfigurationRevision`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

DELIMITER $$
CREATE TRIGGER `PayrollEmployerContribution_no_update`
BEFORE UPDATE ON `PayrollEmployerContribution`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollEmployerContribution is append-only';
END$$

CREATE TRIGGER `PayrollEmployerContribution_no_delete`
BEFORE DELETE ON `PayrollEmployerContribution`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollEmployerContribution is append-only';
END$$

CREATE TRIGGER `PayrollStatutoryCalculation_no_update`
BEFORE UPDATE ON `PayrollStatutoryCalculation`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollStatutoryCalculation is append-only';
END$$

CREATE TRIGGER `PayrollStatutoryCalculation_no_delete`
BEFORE DELETE ON `PayrollStatutoryCalculation`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PayrollStatutoryCalculation is append-only';
END$$
DELIMITER ;
