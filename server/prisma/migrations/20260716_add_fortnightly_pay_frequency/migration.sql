-- BIWEEKLY remains the twice-per-month (24 periods/year) frequency.
-- FORTNIGHTLY is the distinct every-14-days (26 periods/year) frequency.
ALTER TABLE `CompensationHistory`
  MODIFY `payFrequency` ENUM('WEEKLY', 'BIWEEKLY', 'FORTNIGHTLY', 'MONTHLY') NOT NULL;
