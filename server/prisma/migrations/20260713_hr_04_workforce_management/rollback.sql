-- Destructive rollback for HR phase 4 only. Run after removing all phase 5+
-- foreign keys that may depend on attendance periods or workforce ledgers.

DROP TRIGGER IF EXISTS `VacationLedgerEntry_prevent_delete`;
DROP TRIGGER IF EXISTS `VacationLedgerEntry_prevent_update`;
DROP TABLE IF EXISTS `WorkforceIdempotencyRecord`;
DROP TABLE IF EXISTS `VacationLedgerEntry`;
DROP TABLE IF EXISTS `VacationBalance`;
DROP TABLE IF EXISTS `LeaveRequest`;
DROP TABLE IF EXISTS `LeaveType`;
DROP TABLE IF EXISTS `OvertimeRequest`;
DROP TABLE IF EXISTS `AttendanceCorrection`;
DROP TABLE IF EXISTS `AttendanceIncident`;
DROP TABLE IF EXISTS `AttendanceDailySummary`;
DROP TABLE IF EXISTS `AttendancePeriod`;
