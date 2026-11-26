-- Payroll snapshots keep the frozen rest days in sourceTrace; older builds
-- simply stop paying DESCANSO_TRABAJADO on new calculations.
ALTER TABLE `Employee` DROP COLUMN `weeklyRestDays`;
