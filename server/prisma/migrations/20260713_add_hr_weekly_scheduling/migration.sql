-- Versioned weekly scheduling foundation. This migration is additive and does
-- not mutate existing HR or operational records.

CREATE TABLE `ShiftTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `jobPositionId` INTEGER NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `startMinute` INTEGER NOT NULL,
    `endMinute` INTEGER NOT NULL,
    `breakMinutes` INTEGER NOT NULL DEFAULT 0,
    `paidBreak` BOOLEAN NOT NULL DEFAULT false,
    `timezone` VARCHAR(64) NOT NULL,
    `notes` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ShiftTemplate_companyId_code_key`(`companyId`, `code`),
    INDEX `ShiftTemplate_companyId_branchId_active_idx`(`companyId`, `branchId`, `active`),
    INDEX `ShiftTemplate_jobPositionId_idx`(`jobPositionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WeeklySchedule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `weekStart` DATE NOT NULL,
    `version` INTEGER NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `publicationKey` VARCHAR(64) NULL,
    `supersedesScheduleId` INTEGER NULL,
    `createdById` INTEGER NOT NULL,
    `publishedById` INTEGER NULL,
    `publishedAt` DATETIME(3) NULL,
    `supersededAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WeeklySchedule_companyId_publicationKey_key`(`companyId`, `publicationKey`),
    UNIQUE INDEX `WeeklySchedule_companyId_weekStart_version_key`(`companyId`, `weekStart`, `version`),
    INDEX `WeeklySchedule_companyId_weekStart_status_idx`(`companyId`, `weekStart`, `status`),
    INDEX `WeeklySchedule_supersedesScheduleId_idx`(`supersedesScheduleId`),
    INDEX `WeeklySchedule_createdById_idx`(`createdById`),
    INDEX `WeeklySchedule_publishedById_idx`(`publishedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScheduledShift` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `scheduleId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `jobPositionId` INTEGER NULL,
    `shiftTemplateId` INTEGER NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `timezoneSnapshot` VARCHAR(64) NOT NULL,
    `breakMinutes` INTEGER NOT NULL DEFAULT 0,
    `paidBreak` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `status` ENUM('SCHEDULED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ScheduledShift_companyId_userId_startAt_idx`(`companyId`, `userId`, `startAt`),
    INDEX `ScheduledShift_scheduleId_status_idx`(`scheduleId`, `status`),
    INDEX `ScheduledShift_branchId_startAt_idx`(`branchId`, `startAt`),
    INDEX `ScheduledShift_jobPositionId_idx`(`jobPositionId`),
    INDEX `ScheduledShift_shiftTemplateId_idx`(`shiftTemplateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScheduleAcknowledgement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `scheduleId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `acknowledgedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ScheduleAcknowledgement_scheduleId_userId_key`(`scheduleId`, `userId`),
    INDEX `ScheduleAcknowledgement_companyId_userId_acknowledgedAt_idx`(`companyId`, `userId`, `acknowledgedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `HolidayCalendar` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `HolidayCalendar_companyId_name_key`(`companyId`, `name`),
    INDEX `HolidayCalendar_companyId_active_idx`(`companyId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Holiday` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `calendarId` INTEGER NOT NULL,
    `branchId` INTEGER NULL,
    `scopeKey` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `paid` BOOLEAN NOT NULL DEFAULT true,
    `payMultiplier` DECIMAL(5, 2) NOT NULL DEFAULT 1,
    `notes` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Holiday_calendarId_date_scopeKey_key`(`calendarId`, `date`, `scopeKey`),
    INDEX `Holiday_companyId_date_active_idx`(`companyId`, `date`, `active`),
    INDEX `Holiday_branchId_date_idx`(`branchId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShiftSwapRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `scheduleId` INTEGER NOT NULL,
    `requesterShiftId` INTEGER NOT NULL,
    `offeredShiftId` INTEGER NULL,
    `requestedById` INTEGER NOT NULL,
    `targetUserId` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `reason` TEXT NULL,
    `targetRespondedAt` DATETIME(3) NULL,
    `decidedById` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNotes` TEXT NULL,
    `openRequesterKey` VARCHAR(64) NULL,
    `openOfferedKey` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ShiftSwapRequest_companyId_status_createdAt_idx`(`companyId`, `status`, `createdAt`),
    INDEX `ShiftSwapRequest_scheduleId_idx`(`scheduleId`),
    INDEX `ShiftSwapRequest_requestedById_status_idx`(`requestedById`, `status`),
    INDEX `ShiftSwapRequest_targetUserId_status_idx`(`targetUserId`, `status`),
    INDEX `ShiftSwapRequest_requesterShiftId_idx`(`requesterShiftId`),
    INDEX `ShiftSwapRequest_offeredShiftId_idx`(`offeredShiftId`),
    INDEX `ShiftSwapRequest_decidedById_idx`(`decidedById`),
    UNIQUE INDEX `ShiftSwapRequest_openRequesterKey_key`(`openRequesterKey`),
    UNIQUE INDEX `ShiftSwapRequest_openOfferedKey_key`(`openOfferedKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShiftAssignmentOverride` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `scheduledShiftId` INTEGER NOT NULL,
    `assignedUserId` INTEGER NOT NULL,
    `swapRequestId` INTEGER NOT NULL,
    `assignedById` INTEGER NOT NULL,
    `effectiveAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShiftAssignmentOverride_scheduledShiftId_key`(`scheduledShiftId`),
    INDEX `ShiftAssignmentOverride_companyId_assignedUserId_effectiveAt_idx`(`companyId`, `assignedUserId`, `effectiveAt`),
    INDEX `ShiftAssignmentOverride_swapRequestId_idx`(`swapRequestId`),
    INDEX `ShiftAssignmentOverride_assignedById_idx`(`assignedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShiftSwapReservation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `swapRequestId` INTEGER NOT NULL,
    `scheduledShiftId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShiftSwapReservation_scheduledShiftId_key`(`scheduledShiftId`),
    UNIQUE INDEX `ShiftSwapReservation_swapRequestId_scheduledShiftId_key`(`swapRequestId`, `scheduledShiftId`),
    INDEX `ShiftSwapReservation_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `ShiftSwapReservation_swapRequestId_idx`(`swapRequestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ShiftTemplate` ADD CONSTRAINT `ShiftTemplate_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftTemplate` ADD CONSTRAINT `ShiftTemplate_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftTemplate` ADD CONSTRAINT `ShiftTemplate_jobPositionId_fkey`
    FOREIGN KEY (`jobPositionId`) REFERENCES `JobPosition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ShiftTemplate`
    ADD CONSTRAINT `ShiftTemplate_startMinute_chk` CHECK (`startMinute` BETWEEN 0 AND 1439),
    ADD CONSTRAINT `ShiftTemplate_endMinute_chk` CHECK (`endMinute` BETWEEN 0 AND 1439),
    ADD CONSTRAINT `ShiftTemplate_breakMinutes_chk` CHECK (`breakMinutes` >= 0);

ALTER TABLE `WeeklySchedule` ADD CONSTRAINT `WeeklySchedule_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WeeklySchedule` ADD CONSTRAINT `WeeklySchedule_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WeeklySchedule` ADD CONSTRAINT `WeeklySchedule_publishedById_fkey`
    FOREIGN KEY (`publishedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WeeklySchedule` ADD CONSTRAINT `WeeklySchedule_supersedesScheduleId_fkey`
    FOREIGN KEY (`supersedesScheduleId`) REFERENCES `WeeklySchedule`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ScheduledShift` ADD CONSTRAINT `ScheduledShift_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ScheduledShift` ADD CONSTRAINT `ScheduledShift_scheduleId_fkey`
    FOREIGN KEY (`scheduleId`) REFERENCES `WeeklySchedule`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ScheduledShift` ADD CONSTRAINT `ScheduledShift_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ScheduledShift` ADD CONSTRAINT `ScheduledShift_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ScheduledShift` ADD CONSTRAINT `ScheduledShift_jobPositionId_fkey`
    FOREIGN KEY (`jobPositionId`) REFERENCES `JobPosition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ScheduledShift` ADD CONSTRAINT `ScheduledShift_shiftTemplateId_fkey`
    FOREIGN KEY (`shiftTemplateId`) REFERENCES `ShiftTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ScheduledShift`
    ADD CONSTRAINT `ScheduledShift_endAfterStart_chk` CHECK (`endAt` > `startAt`),
    ADD CONSTRAINT `ScheduledShift_breakMinutes_chk` CHECK (`breakMinutes` >= 0);

ALTER TABLE `ScheduleAcknowledgement` ADD CONSTRAINT `ScheduleAcknowledgement_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ScheduleAcknowledgement` ADD CONSTRAINT `ScheduleAcknowledgement_scheduleId_fkey`
    FOREIGN KEY (`scheduleId`) REFERENCES `WeeklySchedule`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ScheduleAcknowledgement` ADD CONSTRAINT `ScheduleAcknowledgement_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `HolidayCalendar` ADD CONSTRAINT `HolidayCalendar_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Holiday` ADD CONSTRAINT `Holiday_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Holiday` ADD CONSTRAINT `Holiday_calendarId_fkey`
    FOREIGN KEY (`calendarId`) REFERENCES `HolidayCalendar`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Holiday` ADD CONSTRAINT `Holiday_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Holiday`
    ADD CONSTRAINT `Holiday_payMultiplier_chk` CHECK (`payMultiplier` > 0);

ALTER TABLE `ShiftSwapRequest` ADD CONSTRAINT `ShiftSwapRequest_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftSwapRequest` ADD CONSTRAINT `ShiftSwapRequest_scheduleId_fkey`
    FOREIGN KEY (`scheduleId`) REFERENCES `WeeklySchedule`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftSwapRequest` ADD CONSTRAINT `ShiftSwapRequest_requesterShiftId_fkey`
    FOREIGN KEY (`requesterShiftId`) REFERENCES `ScheduledShift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftSwapRequest` ADD CONSTRAINT `ShiftSwapRequest_offeredShiftId_fkey`
    FOREIGN KEY (`offeredShiftId`) REFERENCES `ScheduledShift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftSwapRequest` ADD CONSTRAINT `ShiftSwapRequest_requestedById_fkey`
    FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftSwapRequest` ADD CONSTRAINT `ShiftSwapRequest_targetUserId_fkey`
    FOREIGN KEY (`targetUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftSwapRequest` ADD CONSTRAINT `ShiftSwapRequest_decidedById_fkey`
    FOREIGN KEY (`decidedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ShiftAssignmentOverride` ADD CONSTRAINT `ShiftAssignmentOverride_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftAssignmentOverride` ADD CONSTRAINT `ShiftAssignmentOverride_scheduledShiftId_fkey`
    FOREIGN KEY (`scheduledShiftId`) REFERENCES `ScheduledShift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftAssignmentOverride` ADD CONSTRAINT `ShiftAssignmentOverride_assignedUserId_fkey`
    FOREIGN KEY (`assignedUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftAssignmentOverride` ADD CONSTRAINT `ShiftAssignmentOverride_swapRequestId_fkey`
    FOREIGN KEY (`swapRequestId`) REFERENCES `ShiftSwapRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftAssignmentOverride` ADD CONSTRAINT `ShiftAssignmentOverride_assignedById_fkey`
    FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ShiftSwapReservation` ADD CONSTRAINT `ShiftSwapReservation_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftSwapReservation` ADD CONSTRAINT `ShiftSwapReservation_swapRequestId_fkey`
    FOREIGN KEY (`swapRequestId`) REFERENCES `ShiftSwapRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftSwapReservation` ADD CONSTRAINT `ShiftSwapReservation_scheduledShiftId_fkey`
    FOREIGN KEY (`scheduledShiftId`) REFERENCES `ScheduledShift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
