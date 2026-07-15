-- RH Fase 6: viaticos, prestamos y deducciones. Migracion aditiva.
-- Los movimientos financieros son append-only y las evidencias externas se
-- mantienen bloqueadas hasta contar con un repositorio seguro verificable.

CREATE TABLE `HrTravelRequest` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `code` VARCHAR(64) NOT NULL,
  `userId` INTEGER NOT NULL, `employeeId` INTEGER NOT NULL, `branchId` INTEGER NULL,
  `destination` VARCHAR(160) NOT NULL, `purpose` TEXT NOT NULL, `departureDate` DATE NOT NULL, `returnDate` DATE NOT NULL,
  `currency` VARCHAR(3) NOT NULL, `requestedAmount` DECIMAL(18,2) NOT NULL, `approvedAmount` DECIMAL(18,2) NULL,
  `advanceAmount` DECIMAL(18,2) NULL, `recognizedExpenseAmount` DECIMAL(18,2) NULL,
  `employeeReturnAmount` DECIMAL(18,2) NULL, `employeeReimbursementAmount` DECIMAL(18,2) NULL,
  `status` ENUM('DRAFT','SUBMITTED','APPROVED','REJECTED','ADVANCED','IN_SETTLEMENT','SETTLED','CANCELLED','REVERSED') NOT NULL DEFAULT 'DRAFT',
  `revision` INTEGER NOT NULL DEFAULT 0, `createdById` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `HrTravelRequest_companyId_code_key` (`companyId`,`code`),
  INDEX `HrTravelRequest_companyId_userId_status_departureDate_idx` (`companyId`,`userId`,`status`,`departureDate`),
  INDEX `HrTravelRequest_companyId_branchId_departureDate_idx` (`companyId`,`branchId`,`departureDate`),
  CONSTRAINT `HrTravelRequest_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrTravelRequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrTravelRequest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrTravelRequest_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrTravelRequest_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrTravelRequest_dates_ck` CHECK (`returnDate` >= `departureDate`),
  CONSTRAINT `HrTravelRequest_amount_ck` CHECK (`requestedAmount` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HrTravelExpense` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `travelRequestId` INTEGER NOT NULL,
  `category` VARCHAR(64) NOT NULL, `description` VARCHAR(600) NOT NULL, `occurredOn` DATE NOT NULL,
  `currency` VARCHAR(3) NOT NULL, `claimedAmount` DECIMAL(18,2) NOT NULL, `recognizedAmount` DECIMAL(18,2) NULL,
  `receiptReference` VARCHAR(160) NULL, `evidenceId` INTEGER NULL,
  `status` ENUM('PENDING','ACCEPTED','REJECTED','REVERSED') NOT NULL DEFAULT 'PENDING',
  `createdById` INTEGER NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  INDEX `HrTravelExpense_companyId_travelRequestId_status_idx` (`companyId`,`travelRequestId`,`status`),
  CONSTRAINT `HrTravelExpense_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrTravelExpense_travelRequestId_fkey` FOREIGN KEY (`travelRequestId`) REFERENCES `HrTravelRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrTravelExpense_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrTravelExpense_amount_ck` CHECK (`claimedAmount` > 0 AND (`recognizedAmount` IS NULL OR `recognizedAmount` >= 0))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HrTravelLedgerEntry` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `travelRequestId` INTEGER NOT NULL,
  `type` ENUM('ADVANCE','EXPENSE_RECOGNITION','EMPLOYEE_RETURN','EMPLOYEE_REIMBURSEMENT','REVERSAL') NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL, `currency` VARCHAR(3) NOT NULL, `effectiveDate` DATE NOT NULL,
  `reference` VARCHAR(160) NULL, `reason` TEXT NOT NULL, `actorId` INTEGER NOT NULL, `reversedEntryId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `HrTravelLedgerEntry_reversedEntryId_key` (`reversedEntryId`),
  UNIQUE INDEX `HrTravelLedgerEntry_travelRequestId_type_reference_key` (`travelRequestId`,`type`,`reference`),
  INDEX `HrTravelLedgerEntry_companyId_travelRequestId_createdAt_idx` (`companyId`,`travelRequestId`,`createdAt`),
  CONSTRAINT `HrTravelLedgerEntry_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrTravelLedgerEntry_travelRequestId_fkey` FOREIGN KEY (`travelRequestId`) REFERENCES `HrTravelRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrTravelLedgerEntry_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrTravelLedgerEntry_reversedEntryId_fkey` FOREIGN KEY (`reversedEntryId`) REFERENCES `HrTravelLedgerEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HrLoan` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `code` VARCHAR(64) NOT NULL,
  `userId` INTEGER NOT NULL, `employeeId` INTEGER NOT NULL, `purpose` TEXT NOT NULL, `currency` VARCHAR(3) NOT NULL,
  `requestedAmount` DECIMAL(18,2) NOT NULL, `approvedAmount` DECIMAL(18,2) NULL, `disbursedAmount` DECIMAL(18,2) NULL,
  `outstandingBalance` DECIMAL(18,2) NOT NULL DEFAULT 0, `preferredInstallments` INTEGER NOT NULL,
  `installmentCount` INTEGER NOT NULL, `payrollDeductionRequested` BOOLEAN NOT NULL DEFAULT false,
  `firstPreferredDeductionDate` DATE NULL, `firstDueDate` DATE NULL,
  `status` ENUM('REQUESTED','APPROVED','REJECTED','DISBURSED','ACTIVE','PAID','CLOSED','CANCELLED','REVERSED') NOT NULL DEFAULT 'REQUESTED',
  `revision` INTEGER NOT NULL DEFAULT 0, `createdById` INTEGER NOT NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `HrLoan_companyId_code_key` (`companyId`,`code`),
  INDEX `HrLoan_companyId_userId_status_requestedAt_idx` (`companyId`,`userId`,`status`,`requestedAt`),
  CONSTRAINT `HrLoan_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrLoan_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrLoan_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrLoan_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrLoan_amount_ck` CHECK (`requestedAmount` > 0 AND `outstandingBalance` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HrLoanScheduleVersion` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `loanId` INTEGER NOT NULL, `version` INTEGER NOT NULL,
  `status` ENUM('ACTIVE','SUPERSEDED','CANCELLED') NOT NULL DEFAULT 'ACTIVE', `principalOnly` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `HrLoanScheduleVersion_loanId_version_key` (`loanId`,`version`),
  INDEX `HrLoanScheduleVersion_companyId_loanId_status_idx` (`companyId`,`loanId`,`status`),
  CONSTRAINT `HrLoanScheduleVersion_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrLoanScheduleVersion_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `HrLoan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HrLoanInstallment` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `scheduleVersionId` INTEGER NOT NULL,
  `number` INTEGER NOT NULL, `dueDate` DATE NOT NULL, `scheduledPrincipal` DECIMAL(18,2) NOT NULL,
  `scheduledCharge` DECIMAL(18,2) NOT NULL DEFAULT 0, `scheduledTotal` DECIMAL(18,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `HrLoanInstallment_scheduleVersionId_number_key` (`scheduleVersionId`,`number`),
  INDEX `HrLoanInstallment_companyId_scheduleVersionId_dueDate_idx` (`companyId`,`scheduleVersionId`,`dueDate`),
  CONSTRAINT `HrLoanInstallment_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrLoanInstallment_scheduleVersionId_fkey` FOREIGN KEY (`scheduleVersionId`) REFERENCES `HrLoanScheduleVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrLoanInstallment_amount_ck` CHECK (`scheduledPrincipal` > 0 AND `scheduledCharge` >= 0 AND `scheduledTotal` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HrLoanLedgerEntry` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `loanId` INTEGER NOT NULL,
  `type` ENUM('DISBURSEMENT','CHARGE','PAYMENT','PAYROLL_DEDUCTION','REVERSAL') NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL, `currency` VARCHAR(3) NOT NULL, `effectiveDate` DATE NOT NULL,
  `payrollRunId` INTEGER NULL, `reference` VARCHAR(160) NULL, `reason` TEXT NOT NULL, `actorId` INTEGER NOT NULL,
  `reversedEntryId` INTEGER NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `HrLoanLedgerEntry_reversedEntryId_key` (`reversedEntryId`),
  UNIQUE INDEX `HrLoanLedgerEntry_loanId_type_reference_key` (`loanId`,`type`,`reference`),
  INDEX `HrLoanLedgerEntry_companyId_loanId_createdAt_idx` (`companyId`,`loanId`,`createdAt`), INDEX `HrLoanLedgerEntry_payrollRunId_idx` (`payrollRunId`),
  CONSTRAINT `HrLoanLedgerEntry_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrLoanLedgerEntry_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `HrLoan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrLoanLedgerEntry_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrLoanLedgerEntry_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrLoanLedgerEntry_reversedEntryId_fkey` FOREIGN KEY (`reversedEntryId`) REFERENCES `HrLoanLedgerEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HrDeduction` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `code` VARCHAR(64) NOT NULL,
  `userId` INTEGER NOT NULL, `employeeId` INTEGER NOT NULL, `loanId` INTEGER NULL,
  `source` ENUM('MANUAL','LOAN','LEGAL') NOT NULL DEFAULT 'MANUAL',
  `status` ENUM('DRAFT','ACTIVE','PAUSED','COMPLETED','CANCELLED','REVERSED') NOT NULL DEFAULT 'DRAFT',
  `revision` INTEGER NOT NULL DEFAULT 0, `remainingAmount` DECIMAL(18,2) NULL, `lastPayrollApplicationId` VARCHAR(160) NULL,
  `createdById` INTEGER NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `HrDeduction_loanId_key` (`loanId`), UNIQUE INDEX `HrDeduction_companyId_code_key` (`companyId`,`code`),
  INDEX `HrDeduction_companyId_userId_status_createdAt_idx` (`companyId`,`userId`,`status`,`createdAt`),
  CONSTRAINT `HrDeduction_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrDeduction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrDeduction_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrDeduction_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `HrLoan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrDeduction_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HrDeductionVersion` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `deductionId` INTEGER NOT NULL, `version` INTEGER NOT NULL,
  `name` VARCHAR(120) NOT NULL, `reason` TEXT NOT NULL, `currency` VARCHAR(3) NOT NULL,
  `frequency` ENUM('ONCE','RECURRING') NOT NULL, `requestedAmount` DECIMAL(18,2) NOT NULL,
  `applicableAmount` DECIMAL(18,2) NOT NULL, `perPeriodLimit` DECIMAL(18,2) NULL, `priority` INTEGER NOT NULL,
  `effectiveFrom` DATE NOT NULL, `effectiveTo` DATE NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `HrDeductionVersion_deductionId_version_key` (`deductionId`,`version`),
  INDEX `HrDeductionVersion_companyId_deductionId_createdAt_idx` (`companyId`,`deductionId`,`createdAt`),
  CONSTRAINT `HrDeductionVersion_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrDeductionVersion_deductionId_fkey` FOREIGN KEY (`deductionId`) REFERENCES `HrDeduction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrDeductionVersion_dates_ck` CHECK (`effectiveTo` IS NULL OR `effectiveTo` >= `effectiveFrom`),
  CONSTRAINT `HrDeductionVersion_amount_ck` CHECK (`requestedAmount` > 0 AND `applicableAmount` > 0 AND (`perPeriodLimit` IS NULL OR `perPeriodLimit` > 0))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HrDeductionApplication` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `deductionId` INTEGER NOT NULL,
  `versionId` INTEGER NOT NULL, `payrollRunId` INTEGER NOT NULL, `kind` ENUM('APPLIED','REVERSAL') NOT NULL DEFAULT 'APPLIED',
  `amount` DECIMAL(18,2) NOT NULL, `currency` VARCHAR(3) NOT NULL, `componentId` INTEGER NULL, `reason` TEXT NOT NULL,
  `actorId` INTEGER NOT NULL, `reversalOfId` INTEGER NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `HrDeductionApplication_deductionId_payrollRunId_kind_key` (`deductionId`,`payrollRunId`,`kind`),
  UNIQUE INDEX `HrDeductionApplication_reversalOfId_key` (`reversalOfId`),
  INDEX `HrDeductionApplication_companyId_payrollRunId_createdAt_idx` (`companyId`,`payrollRunId`,`createdAt`),
  CONSTRAINT `HrDeductionApplication_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrDeductionApplication_deductionId_fkey` FOREIGN KEY (`deductionId`) REFERENCES `HrDeduction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrDeductionApplication_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `HrDeductionVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrDeductionApplication_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrDeductionApplication_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrDeductionApplication_reversalOfId_fkey` FOREIGN KEY (`reversalOfId`) REFERENCES `HrDeductionApplication`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HrBenefitTrace` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `resourceType` VARCHAR(32) NOT NULL,
  `resourceId` INTEGER NOT NULL, `event` VARCHAR(64) NOT NULL, `actorId` INTEGER NULL, `reason` TEXT NULL,
  `fromStatus` VARCHAR(32) NULL, `toStatus` VARCHAR(32) NULL, `revision` INTEGER NOT NULL, `metadata` JSON NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  INDEX `HrBenefitTrace_companyId_resourceType_resourceId_occurredAt_idx` (`companyId`,`resourceType`,`resourceId`,`occurredAt`),
  CONSTRAINT `HrBenefitTrace_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `HrBenefitTrace_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HrBenefitIdempotencyRecord` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `companyId` INTEGER NOT NULL, `key` VARCHAR(128) NOT NULL,
  `operation` VARCHAR(100) NOT NULL, `requestHash` VARCHAR(64) NOT NULL, `response` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `HrBenefitIdempotencyRecord_companyId_key_key` (`companyId`,`key`),
  INDEX `HrBenefitIdempotencyRecord_companyId_operation_createdAt_idx` (`companyId`,`operation`,`createdAt`),
  CONSTRAINT `HrBenefitIdempotencyRecord_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TRIGGER `HrTravelLedgerEntry_no_update` BEFORE UPDATE ON `HrTravelLedgerEntry`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrTravelLedgerEntry is append-only';
CREATE TRIGGER `HrTravelLedgerEntry_no_delete` BEFORE DELETE ON `HrTravelLedgerEntry`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrTravelLedgerEntry is append-only';
CREATE TRIGGER `HrLoanLedgerEntry_no_update` BEFORE UPDATE ON `HrLoanLedgerEntry`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrLoanLedgerEntry is append-only';
CREATE TRIGGER `HrLoanLedgerEntry_no_delete` BEFORE DELETE ON `HrLoanLedgerEntry`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrLoanLedgerEntry is append-only';
CREATE TRIGGER `HrDeductionApplication_no_update` BEFORE UPDATE ON `HrDeductionApplication`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrDeductionApplication is append-only';
CREATE TRIGGER `HrDeductionApplication_no_delete` BEFORE DELETE ON `HrDeductionApplication`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrDeductionApplication is append-only';
CREATE TRIGGER `HrBenefitTrace_no_update` BEFORE UPDATE ON `HrBenefitTrace`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrBenefitTrace is append-only';
CREATE TRIGGER `HrBenefitTrace_no_delete` BEFORE DELETE ON `HrBenefitTrace`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrBenefitTrace is append-only';
CREATE TRIGGER `HrLoanScheduleVersion_no_update` BEFORE UPDATE ON `HrLoanScheduleVersion`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrLoanScheduleVersion is immutable';
CREATE TRIGGER `HrLoanScheduleVersion_no_delete` BEFORE DELETE ON `HrLoanScheduleVersion`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrLoanScheduleVersion is immutable';
CREATE TRIGGER `HrLoanInstallment_no_update` BEFORE UPDATE ON `HrLoanInstallment`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrLoanInstallment is immutable';
CREATE TRIGGER `HrLoanInstallment_no_delete` BEFORE DELETE ON `HrLoanInstallment`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrLoanInstallment is immutable';
CREATE TRIGGER `HrDeductionVersion_no_update` BEFORE UPDATE ON `HrDeductionVersion`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrDeductionVersion is immutable';
CREATE TRIGGER `HrDeductionVersion_no_delete` BEFORE DELETE ON `HrDeductionVersion`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'HrDeductionVersion is immutable';

INSERT IGNORE INTO `Permission` (`name`) VALUES ('hr.benefits.read'),('hr.benefits.manage'),('hr.benefits.approve'),('hr.benefits.self');
INSERT IGNORE INTO `_PermissionToRole` (`A`,`B`) SELECT p.`id`,r.`id` FROM `Permission` p JOIN `Role` r WHERE r.`name`='SUPERADMIN' AND p.`name` IN ('hr.benefits.read','hr.benefits.manage','hr.benefits.approve','hr.benefits.self');
INSERT IGNORE INTO `_PermissionToRole` (`A`,`B`) SELECT p.`id`,r.`id` FROM `Permission` p JOIN `Role` r WHERE r.`name` IN ('ADMIN','CAJERO','MESERO','COCINA','CHEF','BODEGA','HOST') AND p.`name`='hr.benefits.self';
