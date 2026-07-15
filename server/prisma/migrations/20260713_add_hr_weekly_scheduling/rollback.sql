-- MANUAL ROLLBACK ONLY. Applying this removes all Phase 2 scheduling data.
-- Execute only after confirming no production schedule must be retained.
-- Remove later RH migrations (attendance and beyond) before this rollback.
DROP TABLE IF EXISTS `ShiftSwapReservation`;
DROP TABLE IF EXISTS `ShiftAssignmentOverride`;
DROP TABLE IF EXISTS `ShiftSwapRequest`;
DROP TABLE IF EXISTS `Holiday`;
DROP TABLE IF EXISTS `HolidayCalendar`;
DROP TABLE IF EXISTS `ScheduleAcknowledgement`;
DROP TABLE IF EXISTS `ScheduledShift`;
DROP TABLE IF EXISTS `WeeklySchedule`;
DROP TABLE IF EXISTS `ShiftTemplate`;
