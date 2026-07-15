-- HR workforce management: attendance derivation, corrections, overtime,
-- leave/vacation workflows, immutable ledger and closeable payroll source periods.

CREATE TABLE `AttendancePeriod` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `dateFrom` DATE NOT NULL,
    `dateTo` DATE NOT NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `status` ENUM('OPEN','CLOSED','REOPENED') NOT NULL DEFAULT 'OPEN',
    `revision` INTEGER NOT NULL DEFAULT 0,
    `lastActionReason` TEXT NULL,
    `payrollEligible` BOOLEAN NOT NULL DEFAULT false,
    `createdById` INTEGER NOT NULL,
    `closedById` INTEGER NULL,
    `closedAt` DATETIME(3) NULL,
    `reopenedById` INTEGER NULL,
    `reopenedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `AttendancePeriod_companyId_dateFrom_dateTo_key`(`companyId`,`dateFrom`,`dateTo`),
    INDEX `AttendancePeriod_companyId_status_dateFrom_dateTo_idx`(`companyId`,`status`,`dateFrom`,`dateTo`),
    INDEX `AttendancePeriod_createdById_idx`(`createdById`),
    INDEX `AttendancePeriod_closedById_idx`(`closedById`),
    INDEX `AttendancePeriod_reopenedById_idx`(`reopenedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AttendanceDailySummary` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `branchId` INTEGER NULL,
    `scopeKey` VARCHAR(64) NOT NULL,
    `date` DATE NOT NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `periodId` INTEGER NULL,
    `scheduledMinutes` INTEGER NULL,
    `ordinaryMinutes` INTEGER NOT NULL DEFAULT 0,
    `breakMinutes` INTEGER NOT NULL DEFAULT 0,
    `lateMinutes` INTEGER NOT NULL DEFAULT 0,
    `earlyDepartureMinutes` INTEGER NOT NULL DEFAULT 0,
    `candidateOvertimeMinutes` INTEGER NOT NULL DEFAULT 0,
    `approvedOvertimeMinutes` INTEGER NOT NULL DEFAULT 0,
    `calculatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sourceRevision` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `AttendanceDailySummary_companyId_userId_date_scopeKey_key`(`companyId`,`userId`,`date`,`scopeKey`),
    INDEX `AttendanceDailySummary_companyId_date_branchId_idx`(`companyId`,`date`,`branchId`),
    INDEX `AttendanceDailySummary_periodId_idx`(`periodId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AttendanceIncident` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `dailySummaryId` INTEGER NULL,
    `userId` INTEGER NOT NULL,
    `branchId` INTEGER NULL,
    `date` DATE NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `severity` ENUM('INFO','WARNING','CRITICAL') NOT NULL DEFAULT 'WARNING',
    `status` ENUM('OPEN','RESOLVED','DISMISSED') NOT NULL DEFAULT 'OPEN',
    `reasonCode` VARCHAR(64) NULL,
    `message` TEXT NOT NULL,
    `attendanceEventId` INTEGER NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `AttendanceIncident_companyId_dedupeKey_key`(`companyId`,`dedupeKey`),
    INDEX `AttendanceIncident_companyId_date_status_severity_idx`(`companyId`,`date`,`status`,`severity`),
    INDEX `AttendanceIncident_userId_date_idx`(`userId`,`date`),
    INDEX `AttendanceIncident_dailySummaryId_idx`(`dailySummaryId`),
    INDEX `AttendanceIncident_attendanceEventId_idx`(`attendanceEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AttendanceCorrection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `dailySummaryId` INTEGER NULL,
    `incidentId` INTEGER NULL,
    `targetEventId` INTEGER NULL,
    `compensationEventId` INTEGER NULL,
    `type` ENUM('ADD_PUNCH','VOID_PUNCH','CHANGE_TIME','ASSIGN_BRANCH','OTHER') NOT NULL,
    `requestedAction` ENUM('CHECK_IN','BREAK_START','BREAK_END','CHECK_OUT') NULL,
    `requestedOccurredAt` DATETIME(3) NULL,
    `requestedTimezone` VARCHAR(64) NULL,
    `requestedBranchId` INTEGER NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('PENDING','APPROVED','REJECTED','CANCELLED','APPLIED') NOT NULL DEFAULT 'PENDING',
    `revision` INTEGER NOT NULL DEFAULT 0,
    `requestedById` INTEGER NOT NULL,
    `decidedById` INTEGER NULL,
    `decisionReason` TEXT NULL,
    `decidedAt` DATETIME(3) NULL,
    `appliedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `AttendanceCorrection_compensationEventId_key`(`compensationEventId`),
    INDEX `AttendanceCorrection_companyId_status_createdAt_idx`(`companyId`,`status`,`createdAt`),
    INDEX `AttendanceCorrection_userId_createdAt_idx`(`userId`,`createdAt`),
    INDEX `AttendanceCorrection_dailySummaryId_idx`(`dailySummaryId`),
    INDEX `AttendanceCorrection_incidentId_idx`(`incidentId`),
    INDEX `AttendanceCorrection_targetEventId_idx`(`targetEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OvertimeRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `dailySummaryId` INTEGER NULL,
    `date` DATE NOT NULL,
    `candidateMinutes` INTEGER NULL,
    `summarySourceRevision` INTEGER NULL,
    `requestedMinutes` INTEGER NOT NULL,
    `approvedMinutes` INTEGER NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
    `revision` INTEGER NOT NULL DEFAULT 0,
    `requestedById` INTEGER NOT NULL,
    `decidedById` INTEGER NULL,
    `decisionReason` TEXT NULL,
    `decidedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `OvertimeRequest_companyId_status_date_idx`(`companyId`,`status`,`date`),
    INDEX `OvertimeRequest_userId_date_idx`(`userId`,`date`),
    INDEX `OvertimeRequest_dailySummaryId_idx`(`dailySummaryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LeaveType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `paid` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `balanceTracked` BOOLEAN NOT NULL DEFAULT false,
    `unit` ENUM('DAYS','HOURS','MINUTES') NOT NULL DEFAULT 'DAYS',
    `requiresAttachment` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `LeaveType_companyId_code_key`(`companyId`,`code`),
    INDEX `LeaveType_companyId_active_idx`(`companyId`,`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LeaveRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `branchId` INTEGER NULL,
    `leaveTypeId` INTEGER NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `fraction` ENUM('FULL_DAY','HALF_DAY','HOURS') NOT NULL,
    `startTime` VARCHAR(5) NULL,
    `endTime` VARCHAR(5) NULL,
    `requestedAmount` DECIMAL(12,4) NOT NULL,
    `balanceUnit` ENUM('DAYS','HOURS','MINUTES') NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('DRAFT','PENDING','APPROVED','REJECTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `revision` INTEGER NOT NULL DEFAULT 0,
    `requestedById` INTEGER NOT NULL,
    `decidedById` INTEGER NULL,
    `decisionReason` TEXT NULL,
    `submittedAt` DATETIME(3) NULL,
    `decidedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `LeaveRequest_companyId_status_startDate_endDate_idx`(`companyId`,`status`,`startDate`,`endDate`),
    INDEX `LeaveRequest_userId_startDate_endDate_idx`(`userId`,`startDate`,`endDate`),
    INDEX `LeaveRequest_leaveTypeId_idx`(`leaveTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `VacationBalance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `leaveTypeId` INTEGER NULL,
    `scopeKey` VARCHAR(64) NOT NULL,
    `periodLabel` VARCHAR(64) NULL,
    `unit` ENUM('DAYS','HOURS','MINUTES') NOT NULL,
    `asOf` DATE NOT NULL,
    `sourceRevision` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `VacationBalance_companyId_userId_scopeKey_key`(`companyId`,`userId`,`scopeKey`),
    INDEX `VacationBalance_companyId_asOf_idx`(`companyId`,`asOf`),
    INDEX `VacationBalance_leaveTypeId_idx`(`leaveTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `VacationLedgerEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `balanceId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `leaveRequestId` INTEGER NULL,
    `effectiveDate` DATE NOT NULL,
    `amount` DECIMAL(12,4) NOT NULL,
    `unit` ENUM('DAYS','HOURS','MINUTES') NOT NULL,
    `type` ENUM('ACCRUAL','USAGE','ADJUSTMENT','REVERSAL') NOT NULL,
    `reason` TEXT NOT NULL,
    `reference` VARCHAR(191) NULL,
    `actorId` INTEGER NULL,
    `resultingBalance` DECIMAL(12,4) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `VacationLedgerEntry_leaveRequestId_type_key`(`leaveRequestId`,`type`),
    UNIQUE INDEX `VacationLedgerEntry_companyId_reference_key`(`companyId`,`reference`),
    INDEX `VacationLedgerEntry_companyId_effectiveDate_idx`(`companyId`,`effectiveDate`),
    INDEX `VacationLedgerEntry_balanceId_id_idx`(`balanceId`,`id`),
    INDEX `VacationLedgerEntry_userId_effectiveDate_idx`(`userId`,`effectiveDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WorkforceIdempotencyRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `key` VARCHAR(128) NOT NULL,
    `operation` VARCHAR(64) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `entityType` VARCHAR(64) NOT NULL,
    `entityId` INTEGER NOT NULL DEFAULT 0,
    `response` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `WorkforceIdempotencyRecord_companyId_key_key`(`companyId`,`key`),
    INDEX `WorkforceIdempotencyRecord_companyId_operation_createdAt_idx`(`companyId`,`operation`,`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AttendancePeriod` ADD CONSTRAINT `AttendancePeriod_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendancePeriod` ADD CONSTRAINT `AttendancePeriod_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendancePeriod` ADD CONSTRAINT `AttendancePeriod_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendancePeriod` ADD CONSTRAINT `AttendancePeriod_reopenedById_fkey` FOREIGN KEY (`reopenedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `AttendanceDailySummary` ADD CONSTRAINT `AttendanceDailySummary_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceDailySummary` ADD CONSTRAINT `AttendanceDailySummary_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceDailySummary` ADD CONSTRAINT `AttendanceDailySummary_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceDailySummary` ADD CONSTRAINT `AttendanceDailySummary_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `AttendancePeriod`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `AttendanceIncident` ADD CONSTRAINT `AttendanceIncident_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceIncident` ADD CONSTRAINT `AttendanceIncident_dailySummaryId_fkey` FOREIGN KEY (`dailySummaryId`) REFERENCES `AttendanceDailySummary`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceIncident` ADD CONSTRAINT `AttendanceIncident_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceIncident` ADD CONSTRAINT `AttendanceIncident_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceIncident` ADD CONSTRAINT `AttendanceIncident_attendanceEventId_fkey` FOREIGN KEY (`attendanceEventId`) REFERENCES `AttendanceEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceIncident` ADD CONSTRAINT `AttendanceIncident_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `AttendanceCorrection` ADD CONSTRAINT `AttendanceCorrection_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceCorrection` ADD CONSTRAINT `AttendanceCorrection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceCorrection` ADD CONSTRAINT `AttendanceCorrection_dailySummaryId_fkey` FOREIGN KEY (`dailySummaryId`) REFERENCES `AttendanceDailySummary`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceCorrection` ADD CONSTRAINT `AttendanceCorrection_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `AttendanceIncident`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceCorrection` ADD CONSTRAINT `AttendanceCorrection_targetEventId_fkey` FOREIGN KEY (`targetEventId`) REFERENCES `AttendanceEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceCorrection` ADD CONSTRAINT `AttendanceCorrection_compensationEventId_fkey` FOREIGN KEY (`compensationEventId`) REFERENCES `AttendanceEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceCorrection` ADD CONSTRAINT `AttendanceCorrection_requestedBranchId_fkey` FOREIGN KEY (`requestedBranchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceCorrection` ADD CONSTRAINT `AttendanceCorrection_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AttendanceCorrection` ADD CONSTRAINT `AttendanceCorrection_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `OvertimeRequest` ADD CONSTRAINT `OvertimeRequest_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OvertimeRequest` ADD CONSTRAINT `OvertimeRequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OvertimeRequest` ADD CONSTRAINT `OvertimeRequest_dailySummaryId_fkey` FOREIGN KEY (`dailySummaryId`) REFERENCES `AttendanceDailySummary`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OvertimeRequest` ADD CONSTRAINT `OvertimeRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OvertimeRequest` ADD CONSTRAINT `OvertimeRequest_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `LeaveType` ADD CONSTRAINT `LeaveType_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_leaveTypeId_fkey` FOREIGN KEY (`leaveTypeId`) REFERENCES `LeaveType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_decidedById_fkey` FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `VacationBalance` ADD CONSTRAINT `VacationBalance_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `VacationBalance` ADD CONSTRAINT `VacationBalance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `VacationBalance` ADD CONSTRAINT `VacationBalance_leaveTypeId_fkey` FOREIGN KEY (`leaveTypeId`) REFERENCES `LeaveType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `VacationLedgerEntry` ADD CONSTRAINT `VacationLedgerEntry_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `VacationLedgerEntry` ADD CONSTRAINT `VacationLedgerEntry_balanceId_fkey` FOREIGN KEY (`balanceId`) REFERENCES `VacationBalance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `VacationLedgerEntry` ADD CONSTRAINT `VacationLedgerEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `VacationLedgerEntry` ADD CONSTRAINT `VacationLedgerEntry_leaveRequestId_fkey` FOREIGN KEY (`leaveRequestId`) REFERENCES `LeaveRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `VacationLedgerEntry` ADD CONSTRAINT `VacationLedgerEntry_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `WorkforceIdempotencyRecord` ADD CONSTRAINT `WorkforceIdempotencyRecord_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER `VacationLedgerEntry_prevent_update`
BEFORE UPDATE ON `VacationLedgerEntry`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VacationLedgerEntry is immutable; append a reversal instead';

CREATE TRIGGER `VacationLedgerEntry_prevent_delete`
BEFORE DELETE ON `VacationLedgerEntry`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'VacationLedgerEntry is immutable; append a reversal instead';
