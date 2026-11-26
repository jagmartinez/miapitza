-- Weekly rest day(s) per employee (Código del Trabajo Art. 64, séptimo día).
-- JSON array of ISO weekdays (1 = Monday .. 7 = Sunday). NULL keeps the
-- legal default (Sunday) and payroll raises REST_DAY_DEFAULT_APPLIED so HR
-- confirms the real rest day. The worked-rest-day multiplier lives in the
-- versioned legal configuration (regular.restDayWorkedMultiplier, default 2).
ALTER TABLE `Employee` ADD COLUMN `weeklyRestDays` JSON NULL;
