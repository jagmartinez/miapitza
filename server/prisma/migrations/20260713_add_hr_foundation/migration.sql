-- Additive foundation for the tenant-scoped Human Resources module.
-- Existing users remain EXTERNAL until an Employee profile is created.
ALTER TABLE `User`
    ADD COLUMN `accountType` ENUM('INTERNAL', 'EXTERNAL') NOT NULL DEFAULT 'EXTERNAL';

ALTER TABLE `Branch`
    ADD COLUMN `latitude` DECIMAL(10, 7) NULL,
    ADD COLUMN `longitude` DECIMAL(10, 7) NULL,
    ADD COLUMN `geofenceRadiusM` INTEGER NULL,
    ADD COLUMN `maxLocationAccuracyM` INTEGER NULL,
    ADD COLUMN `attendanceEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `geofenceVersion` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `Branch`
    ADD CONSTRAINT `Branch_hr_coordinates_check` CHECK (
        (`latitude` IS NULL AND `longitude` IS NULL) OR
        (`latitude` BETWEEN -90 AND 90 AND `longitude` BETWEEN -180 AND 180)
    ),
    ADD CONSTRAINT `Branch_hr_geofence_check` CHECK (
        (`latitude` IS NULL AND `geofenceRadiusM` IS NULL AND `maxLocationAccuracyM` IS NULL AND `attendanceEnabled` = false) OR
        (`latitude` IS NOT NULL AND `longitude` IS NOT NULL AND
         `geofenceRadiusM` BETWEEN 10 AND 10000 AND
         `maxLocationAccuracyM` BETWEEN 1 AND 5000)
    );

CREATE TABLE `Department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Department_companyId_code_key`(`companyId`, `code`),
    UNIQUE INDEX `Department_companyId_name_key`(`companyId`, `name`),
    INDEX `Department_companyId_active_idx`(`companyId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `JobPosition` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `departmentId` INTEGER NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `JobPosition_companyId_code_key`(`companyId`, `code`),
    UNIQUE INDEX `JobPosition_companyId_name_key`(`companyId`, `name`),
    INDEX `JobPosition_companyId_active_idx`(`companyId`, `active`),
    INDEX `JobPosition_departmentId_idx`(`departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CostCenter` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CostCenter_companyId_code_key`(`companyId`, `code`),
    UNIQUE INDEX `CostCenter_companyId_name_key`(`companyId`, `name`),
    INDEX `CostCenter_companyId_active_idx`(`companyId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Employee` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `employeeCode` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(191) NOT NULL,
    `preferredName` VARCHAR(191) NULL,
    `documentType` VARCHAR(191) NULL,
    `documentNumber` VARCHAR(191) NULL,
    `socialSecurityNumber` VARCHAR(191) NULL,
    `taxId` VARCHAR(191) NULL,
    `workEmail` VARCHAR(191) NULL,
    `workPhone` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `emergencyContactName` VARCHAR(191) NULL,
    `emergencyContactPhone` VARCHAR(191) NULL,
    `emergencyContactRelationship` VARCHAR(191) NULL,
    `hireDate` DATE NOT NULL,
    `terminationDate` DATE NULL,
    `employmentType` ENUM('FULL_TIME', 'PART_TIME', 'TEMPORARY', 'CONTRACTOR', 'INTERN') NOT NULL DEFAULT 'FULL_TIME',
    `status` ENUM('ACTIVE', 'ON_LEAVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED') NOT NULL DEFAULT 'ACTIVE',
    `departmentId` INTEGER NULL,
    `jobPositionId` INTEGER NULL,
    `costCenterId` INTEGER NULL,
    `supervisorEmployeeId` INTEGER NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Employee_userId_key`(`userId`),
    UNIQUE INDEX `Employee_companyId_employeeCode_key`(`companyId`, `employeeCode`),
    INDEX `Employee_companyId_status_idx`(`companyId`, `status`),
    INDEX `Employee_departmentId_idx`(`departmentId`),
    INDEX `Employee_jobPositionId_idx`(`jobPositionId`),
    INDEX `Employee_costCenterId_idx`(`costCenterId`),
    INDEX `Employee_supervisorEmployeeId_idx`(`supervisorEmployeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Employee`
    ADD CONSTRAINT `Employee_hr_dates_check` CHECK (
        (`status` = 'TERMINATED' AND `terminationDate` IS NOT NULL AND `terminationDate` >= `hireDate`) OR
        (`status` <> 'TERMINATED' AND `terminationDate` IS NULL)
    );

CREATE TABLE `EmploymentContract` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `jobPositionId` INTEGER NULL,
    `costCenterId` INTEGER NULL,
    `contractNumber` VARCHAR(191) NOT NULL,
    `employmentType` ENUM('FULL_TIME', 'PART_TIME', 'TEMPORARY', 'CONTRACTOR', 'INTERN') NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED') NOT NULL DEFAULT 'DRAFT',
    `signedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EmploymentContract_companyId_contractNumber_key`(`companyId`, `contractNumber`),
    INDEX `EmploymentContract_companyId_status_idx`(`companyId`, `status`),
    INDEX `EmploymentContract_employeeId_startDate_idx`(`employeeId`, `startDate`),
    INDEX `EmploymentContract_jobPositionId_idx`(`jobPositionId`),
    INDEX `EmploymentContract_costCenterId_idx`(`costCenterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EmploymentContract`
    ADD CONSTRAINT `EmploymentContract_hr_dates_check` CHECK (`endDate` IS NULL OR `endDate` >= `startDate`);

CREATE TABLE `EmployeeBranchAssignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `effectiveFrom` DATE NOT NULL,
    `effectiveTo` DATE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EmployeeBranchAssignment_employeeId_branchId_effectiveFrom_key`(`employeeId`, `branchId`, `effectiveFrom`),
    INDEX `EmployeeBranchAssignment_companyId_branchId_idx`(`companyId`, `branchId`),
    INDEX `EmployeeBranchAssignment_employeeId_effectiveTo_idx`(`employeeId`, `effectiveTo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EmployeeBranchAssignment`
    ADD CONSTRAINT `EmployeeBranchAssignment_hr_dates_check` CHECK (`effectiveTo` IS NULL OR `effectiveTo` >= `effectiveFrom`);

CREATE TABLE `CompensationHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `contractId` INTEGER NULL,
    `changedById` INTEGER NOT NULL,
    `compensationType` ENUM('SALARY', 'HOURLY') NOT NULL,
    `payFrequency` ENUM('WEEKLY', 'BIWEEKLY', 'MONTHLY') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'NIO',
    `effectiveFrom` DATE NOT NULL,
    `effectiveTo` DATE NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompensationHistory_companyId_employeeId_effectiveFrom_idx`(`companyId`, `employeeId`, `effectiveFrom`),
    INDEX `CompensationHistory_contractId_idx`(`contractId`),
    INDEX `CompensationHistory_changedById_idx`(`changedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CompensationHistory`
    ADD CONSTRAINT `CompensationHistory_hr_values_check` CHECK (
        `amount` > 0 AND (`effectiveTo` IS NULL OR `effectiveTo` >= `effectiveFrom`)
    );

CREATE TABLE `BranchGeofenceVersion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `branchId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `geofenceRadiusM` INTEGER NULL,
    `maxLocationAccuracyM` INTEGER NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/Managua',
    `attendanceEnabled` BOOLEAN NOT NULL DEFAULT false,
    `changedById` INTEGER NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BranchGeofenceVersion_branchId_version_key`(`branchId`, `version`),
    INDEX `BranchGeofenceVersion_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `BranchGeofenceVersion_changedById_idx`(`changedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmployeeDocument` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `uploadedById` INTEGER NOT NULL,
    `documentType` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `expiresAt` DATE NULL,
    `status` ENUM('ACTIVE', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EmployeeDocument_storageKey_key`(`storageKey`),
    INDEX `EmployeeDocument_companyId_employeeId_idx`(`companyId`, `employeeId`),
    INDEX `EmployeeDocument_uploadedById_idx`(`uploadedById`),
    INDEX `EmployeeDocument_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Department` ADD CONSTRAINT `Department_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `JobPosition` ADD CONSTRAINT `JobPosition_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `JobPosition` ADD CONSTRAINT `JobPosition_departmentId_fkey`
    FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CostCenter` ADD CONSTRAINT `CostCenter_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Employee` ADD CONSTRAINT `Employee_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_departmentId_fkey`
    FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_jobPositionId_fkey`
    FOREIGN KEY (`jobPositionId`) REFERENCES `JobPosition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_costCenterId_fkey`
    FOREIGN KEY (`costCenterId`) REFERENCES `CostCenter`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_supervisorEmployeeId_fkey`
    FOREIGN KEY (`supervisorEmployeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `EmploymentContract` ADD CONSTRAINT `EmploymentContract_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EmploymentContract` ADD CONSTRAINT `EmploymentContract_employeeId_fkey`
    FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EmploymentContract` ADD CONSTRAINT `EmploymentContract_jobPositionId_fkey`
    FOREIGN KEY (`jobPositionId`) REFERENCES `JobPosition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `EmploymentContract` ADD CONSTRAINT `EmploymentContract_costCenterId_fkey`
    FOREIGN KEY (`costCenterId`) REFERENCES `CostCenter`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `EmployeeBranchAssignment` ADD CONSTRAINT `EmployeeBranchAssignment_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EmployeeBranchAssignment` ADD CONSTRAINT `EmployeeBranchAssignment_employeeId_fkey`
    FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EmployeeBranchAssignment` ADD CONSTRAINT `EmployeeBranchAssignment_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CompensationHistory` ADD CONSTRAINT `CompensationHistory_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CompensationHistory` ADD CONSTRAINT `CompensationHistory_employeeId_fkey`
    FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CompensationHistory` ADD CONSTRAINT `CompensationHistory_contractId_fkey`
    FOREIGN KEY (`contractId`) REFERENCES `EmploymentContract`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CompensationHistory` ADD CONSTRAINT `CompensationHistory_changedById_fkey`
    FOREIGN KEY (`changedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `BranchGeofenceVersion` ADD CONSTRAINT `BranchGeofenceVersion_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BranchGeofenceVersion` ADD CONSTRAINT `BranchGeofenceVersion_branchId_fkey`
    FOREIGN KEY (`branchId`) REFERENCES `Branch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BranchGeofenceVersion` ADD CONSTRAINT `BranchGeofenceVersion_changedById_fkey`
    FOREIGN KEY (`changedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `EmployeeDocument` ADD CONSTRAINT `EmployeeDocument_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EmployeeDocument` ADD CONSTRAINT `EmployeeDocument_employeeId_fkey`
    FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EmployeeDocument` ADD CONSTRAINT `EmployeeDocument_uploadedById_fkey`
    FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
