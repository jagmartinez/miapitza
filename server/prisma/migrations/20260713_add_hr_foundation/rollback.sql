-- Destructive rollback for the HR foundation migration. Use only after a
-- reviewed backup because employee/geofence history will be removed.
DROP TABLE IF EXISTS `BranchGeofenceVersion`;
DROP TABLE IF EXISTS `EmployeeDocument`;
DROP TABLE IF EXISTS `CompensationHistory`;
DROP TABLE IF EXISTS `EmployeeBranchAssignment`;
DROP TABLE IF EXISTS `EmploymentContract`;
DROP TABLE IF EXISTS `Employee`;
DROP TABLE IF EXISTS `JobPosition`;
DROP TABLE IF EXISTS `CostCenter`;
DROP TABLE IF EXISTS `Department`;

ALTER TABLE `Branch`
    DROP CHECK `Branch_hr_geofence_check`,
    DROP CHECK `Branch_hr_coordinates_check`,
    DROP COLUMN `geofenceVersion`,
    DROP COLUMN `attendanceEnabled`,
    DROP COLUMN `maxLocationAccuracyM`,
    DROP COLUMN `geofenceRadiusM`,
    DROP COLUMN `longitude`,
    DROP COLUMN `latitude`;

ALTER TABLE `User` DROP COLUMN `accountType`;
