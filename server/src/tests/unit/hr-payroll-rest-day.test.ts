import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import {
    DEFAULT_REST_DAY_WORKED_MULTIPLIER,
    DEFAULT_WEEKLY_REST_DAYS,
    REST_DAY_WORKED_CONCEPT,
    aguinaldoComponentSources,
    effectiveWeeklyRestDays,
    isWeeklyRestDay,
    normalizeFullCoverageSalary,
    overtimeLegalLimitBreaches,
    proratedSalary,
    protectedDayPremium,
    reconcilePublishedShiftSummaries,
    publishedScheduleShortfall,
    restDayDefaultAppliedMessage,
    salaryAbsenceDeduction,
    salaryDailyWage,
    salaryEarningsByDeduction,
    unconfiguredIncomeComponentCodes,
    validateLegalConfiguration,
    weeklyRestDaysMatchSnapshot,
} from '../../services/hr-payroll.service';
import {
    calculateStatutoryPayroll,
    type PayrollStatutoryConfiguration,
    type StatutoryCalculationInput,
} from '../../services/hr-payroll-statutory';
import { weeklyRestDaysInput } from '../../services/hr.service';

const statutory: PayrollStatutoryConfiguration = {
    companyTaxRegime: { code: 'GENERAL', sourceReference: 'Ley 822', incomeTaxApplicability: 'APPLIES' },
    inss: {
        applicability: 'APPLIES', sourceReference: 'INSS 2026', regime: 'INTEGRAL',
        employeeRate: '0.07', employerRateBelowThreshold: '0.215', employerRateAtOrAboveThreshold: '0.225',
        employerSizeThreshold: 50, minimumMonthlyContributionBase: '10000', minimumBaseProration: 'PER_PAY_PERIOD_SERVICE_RATIO',
        annualPeriods: { WEEKLY: 52, BIWEEKLY: 24, FORTNIGHTLY: 26, MONTHLY: 12 },
    },
    inatec: { applicability: 'APPLIES', sourceReference: 'INATEC 2%', employerRate: '0.02' },
    incomeTax: {
        sourceReference: 'Ley 822 art. 23 y Decreto 01-2013 art. 19', regimeApplicabilityAcknowledged: true,
        calculationMethods: { fixed: 'FIXED_PERIOD_PROJECTION', salaryChange: 'FIXED_SALARY_CHANGE', variable: 'VARIABLE_ACCUMULATED', occasional: 'OCCASIONAL_INCREMENTAL' },
        inssEmployeeContributionDeductible: true, occasionalInssDeductionTreatment: 'DEDUCT_FROM_OCCASIONAL_NET', adjustmentMode: 'WITHHOLD_OR_REFUND',
        annualPeriods: { WEEKLY: 52, BIWEEKLY: 24, FORTNIGHTLY: 26, MONTHLY: 12 },
        brackets: [
            { lowerBound: '0', upperBound: '100000', baseTax: '0', rate: '0', excessOver: '0' },
            { lowerBound: '100000', upperBound: '200000', baseTax: '0', rate: '0.15', excessOver: '100000' },
            { lowerBound: '200000', upperBound: '350000', baseTax: '15000', rate: '0.20', excessOver: '200000' },
            { lowerBound: '350000', upperBound: '500000', baseTax: '45000', rate: '0.25', excessOver: '350000' },
            { lowerBound: '500000', upperBound: null, baseTax: '82500', rate: '0.30', excessOver: '500000' },
        ],
    },
    paymentConceptCatalog: [
        { code: 'INGRESO_ORDINARIO_FIJO', name: 'Ingreso ordinario fijo', type: 'INCOME', socialSecurityApplicable: true, trainingContributionApplicable: true, incomeTaxTreatment: 'REGULAR_FIXED', incomeTaxDeductible: false, sourceReference: 'Regla laboral' },
        { code: 'DESCANSO_TRABAJADO', name: 'Recargo por día de descanso trabajado', type: 'INCOME', socialSecurityApplicable: true, trainingContributionApplicable: true, incomeTaxTreatment: 'REGULAR_VARIABLE', incomeTaxDeductible: false, sourceReference: 'CT Art. 64' },
    ],
};

const legalConfiguration = {
    schema: 'HR_PAYROLL_PARAMETRIC_V4' as const, legallyValidated: true as const, currency: 'NIO',
    regular: { minuteDivisors: { WEEKLY: '3360', BIWEEKLY: '7200', FORTNIGHTLY: '6720', MONTHLY: '14400' }, overtimeMultiplier: '2', paidLeaveUnitMinutes: { DAYS: '480', HOURS: '60', MINUTES: '1' } },
    aguinaldo: { method: 'HISTORICAL_PAID_COMPONENTS' as const, lookbackDays: 365, incomeDivisor: '12', prorationMode: 'NONE' as const, eligibleSources: ['RULE'], roundingScale: 2 as const },
    statutory,
};

function statutoryInput(overrides: Partial<StatutoryCalculationInput> = {}): StatutoryCalculationInput {
    return {
        inssContributionBase: '0', regularInssContributionBase: '0', occasionalInssContributionBase: '0',
        inatecContributionBase: '0', fixedIncomeTaxGross: '0', variableIncomeTaxGross: '0', occasionalIncomeTaxGross: '0',
        otherIncomeTaxDeductions: '0', priorRegularIncomeTaxNet: '0', priorOccasionalIncomeTaxNet: '0',
        priorRegularIncomeTaxWithheld: '0', priorOccasionalIncomeTaxWithheld: '0',
        currentFixedCompensationAmount: '0', latestFixedCompensationAmount: '0', latestRegularIncomeTaxNet: '0',
        priorFixedSalaryChangeActive: false, priorFixedSalaryChangeAnnualProjection: '0', priorHadVariableIncome: false,
        employerRefundAllowed: false, elapsedFiscalMonths: 1, priorPeriods: 0, payFrequency: 'MONTHLY', employerHeadcount: 10, serviceRatio: '1',
        ...overrides,
    };
}

const utc = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('HR aguinaldo method validation', () => {
    it('accepts the highest-month method and rejects unknown methods or base months outside 1-12', () => {
        const highest = { ...legalConfiguration, aguinaldo: { ...legalConfiguration.aguinaldo, method: 'HIGHEST_MONTH_LAST_6_MONTHS', baseMonths: 6 } };
        expect(validateLegalConfiguration(highest).aguinaldo).toMatchObject({ method: 'HIGHEST_MONTH_LAST_6_MONTHS', baseMonths: 6 });
        expect(() => validateLegalConfiguration({ ...highest, aguinaldo: { ...highest.aguinaldo, baseMonths: 0 } })).toThrow('configuración legal validada');
        expect(() => validateLegalConfiguration({ ...highest, aguinaldo: { ...highest.aguinaldo, baseMonths: 13 } })).toThrow('configuración legal validada');
        expect(() => validateLegalConfiguration({ ...highest, aguinaldo: { ...highest.aguinaldo, method: 'OTHER' } })).toThrow('configuración legal validada');
    });
});

describe('HR payroll rest-day premium (séptimo día, CT Art. 64)', () => {
    // MONTHLY C$14,400 with divisor 14,400 min (30 d x 8 h) => C$1.00 per minute.
    const minuteRate = new Prisma.Decimal('14400').dividedBy('14400');

    it('defaults the rest-day multiplier to 2, keeps an explicit value and rejects values below 1', () => {
        expect(DEFAULT_REST_DAY_WORKED_MULTIPLIER).toBe('2');
        expect(validateLegalConfiguration(legalConfiguration).regular.restDayWorkedMultiplier).toBe('2');
        const explicit = validateLegalConfiguration({ ...legalConfiguration, regular: { ...legalConfiguration.regular, restDayWorkedMultiplier: '2.5' } }, { requireCurrentSchema: true });
        expect(explicit.regular.restDayWorkedMultiplier).toBe('2.5');
        expect(() => validateLegalConfiguration({ ...legalConfiguration, regular: { ...legalConfiguration.regular, restDayWorkedMultiplier: '0.9' } }))
            .toThrow(expect.objectContaining({ code: 'HR_PAYROLL_LEGAL_CONFIGURATION_REQUIRED' }));
    });

    it('uses the employee rest days, or Sunday (ISO 7) as the flagged legal default', () => {
        expect(DEFAULT_WEEKLY_REST_DAYS).toEqual([7]);
        expect(effectiveWeeklyRestDays(null)).toEqual({ days: [7], source: 'LEGAL_DEFAULT' });
        expect(effectiveWeeklyRestDays([6, 3])).toEqual({ days: [3, 6], source: 'EMPLOYEE' });
        expect(effectiveWeeklyRestDays([8])).toEqual({ days: [7], source: 'LEGAL_DEFAULT' });
        expect(effectiveWeeklyRestDays([1, 1])).toEqual({ days: [7], source: 'LEGAL_DEFAULT' });
        // 2026-11-15 is a Sunday, 2026-11-17 a Tuesday.
        expect(isWeeklyRestDay(utc('2026-11-15'), [7])).toBe(true);
        expect(isWeeklyRestDay(utc('2026-11-17'), [7])).toBe(false);
        expect(isWeeklyRestDay(utc('2026-11-17'), [2])).toBe(true);
    });

    it('validates the employee write input (1..2 distinct ISO weekdays, null clears)', () => {
        expect(weeklyRestDaysInput(undefined)).toBeUndefined();
        expect(weeklyRestDaysInput(null)).toBeNull();
        expect(weeklyRestDaysInput([7, 3])).toEqual([3, 7]);
        expect(() => weeklyRestDaysInput([])).toThrow('weeklyRestDays');
        expect(() => weeklyRestDaysInput([0])).toThrow('weeklyRestDays');
        expect(() => weeklyRestDaysInput([2, 2])).toThrow('weeklyRestDays');
        expect(() => weeklyRestDaysInput([1, 2, 3, 4, 5, 6, 7])).toThrow('weeklyRestDays');
        // Three rest days are rejected with a Spanish message; legacy stored lists of 3+ fall back to Sunday.
        expect(() => weeklyRestDaysInput([1, 2, 3])).toThrow('uno o dos días');
        expect(weeklyRestDaysInput([6, 7])).toEqual([6, 7]);
        expect(effectiveWeeklyRestDays([1, 2, 3])).toEqual({ days: [7], source: 'LEGAL_DEFAULT' });
    });

    it('rest day worked 480 min at C$1/min: ordinary C$480 + premium 480 x 1 x (2-1) = C$480 => double pay C$960', () => {
        const result = protectedDayPremium({ minuteRate, payableMinutes: 480, holiday: false, restDay: true, holidayMultiplier: '2', restDayMultiplier: '2' });
        expect(result.kind).toBe('REST_DAY');
        expect(result.premium.toFixed(2)).toBe('480.00');
        expect(minuteRate.times(480).plus(result.premium).toFixed(2)).toBe('960.00');
        const none = protectedDayPremium({ minuteRate, payableMinutes: 480, holiday: false, restDay: false, holidayMultiplier: '2', restDayMultiplier: '2' });
        expect(none.kind).toBeNull();
        expect(none.premium.toFixed(2)).toBe('0.00');
    });

    it('never stacks holiday and rest-day premiums: pays only the higher (ties go to the holiday)', () => {
        // Both 2x: 480 x 1 x (2-1) = C$480 once, not C$960.
        const tie = protectedDayPremium({ minuteRate, payableMinutes: 480, holiday: true, restDay: true, holidayMultiplier: '2', restDayMultiplier: '2' });
        expect(tie.kind).toBe('HOLIDAY');
        expect(tie.premium.toFixed(2)).toBe('480.00');
        // Rest day 2.5x beats holiday 2x: 480 x 1 x (2.5-1) = C$720.
        const higherRest = protectedDayPremium({ minuteRate, payableMinutes: 480, holiday: true, restDay: true, holidayMultiplier: '2', restDayMultiplier: '2.5' });
        expect(higherRest.kind).toBe('REST_DAY');
        expect(higherRest.multiplier).toBe('2.5');
        expect(higherRest.premium.toFixed(2)).toBe('720.00');
        // Holiday 3x beats rest day 2x: 480 x 1 x (3-1) = C$960.
        const higherHoliday = protectedDayPremium({ minuteRate, payableMinutes: 480, holiday: true, restDay: true, holidayMultiplier: '3', restDayMultiplier: '2' });
        expect(higherHoliday.kind).toBe('HOLIDAY');
        expect(higherHoliday.premium.toFixed(2)).toBe('960.00');
    });

    it('rest-day premium enters INSS/INATEC/IR bases like the holiday premium: salary 20,000 + premium 1,000', () => {
        // INSS 7% x 21,000 = 1,470.00; patronal 21.5% x 21,000 = 4,515.00; INATEC 2% x 21,000 = 420.00.
        // IR variable: (21,000 - 1,470) x 12 = 234,360 => 15,000 + 20% x 34,360 = 21,872.00 / 12 = 1,822.67.
        const result = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '21000', regularInssContributionBase: '21000', inatecContributionBase: '21000',
            fixedIncomeTaxGross: '20000', variableIncomeTaxGross: '1000', currentFixedCompensationAmount: '20000',
        }));
        expect(result.employeeInss.toFixed(2)).toBe('1470.00');
        expect(result.employerInss.toFixed(2)).toBe('4515.00');
        expect(result.employerInatec.toFixed(2)).toBe('420.00');
        expect(result.incomeTaxMethod).toBe('VARIABLE_ACCUMULATED');
        expect(result.annualProjection.toFixed(2)).toBe('234360.00');
        expect(result.regularAnnualIncomeTax.toFixed(2)).toBe('21872.00');
        expect(result.currentIncomeTaxWithholding.toFixed(2)).toBe('1822.67');
    });

    it('marks a frozen run stale only when the effective rest days change', () => {
        expect(weeklyRestDaysMatchSnapshot({}, [3])).toBe(true);
        expect(weeklyRestDaysMatchSnapshot({ weeklyRestDays: [7] }, null)).toBe(true);
        expect(weeklyRestDaysMatchSnapshot({ weeklyRestDays: [7] }, [7])).toBe(true);
        expect(weeklyRestDaysMatchSnapshot({ weeklyRestDays: [7] }, [1])).toBe(false);
        expect(weeklyRestDaysMatchSnapshot({ weeklyRestDays: [3, 6] }, [6, 3])).toBe(true);
    });

    it('freezes rest days and the multiplier in the snapshot and pays DESCANSO_TRABAJADO with source REST_DAY', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../services/hr-payroll.service.ts'), 'utf8');
        expect(source).toContain("source: 'REST_DAY'");
        expect(source).toContain('weeklyRestDays: restDays.days');
        expect(source).toContain('restDayWorkedMultiplier: restDayMultiplier');
        expect(source).toContain("'HR_PAYROLL_REST_DAY_SOURCE_STALE'");
        expect(source).toContain("code: 'REST_DAY_DEFAULT_APPLIED', severity: 'WARNING'");
        // Emitted once per run, not per employee.
        expect(source.match(/code: 'REST_DAY_DEFAULT_APPLIED'/g)).toHaveLength(1);
        expect(source).toContain('restDayDefaultEmployees.push(');
        expect(REST_DAY_WORKED_CONCEPT).toBe('DESCANSO_TRABAJADO');
        const migration = fs.readFileSync(path.resolve(__dirname, '../../../prisma/migrations/20260806_hr_rest_day_premium/migration.sql'), 'utf8');
        expect(migration).toContain('ADD COLUMN `weeklyRestDays` JSON NULL');
    });
});

describe('HR payroll end-to-end correctness fixes', () => {
    it('deducts an absent day at the CT daily wage (salary / 30), not salary / legacy divisor', () => {
        // MONTHLY C$12,000 => daily wage 12,000 / 30 = C$400. Legacy divisor 9,600 deducted 480 x 1.25 = C$600 (salary / 20).
        const contractualAmount = new Prisma.Decimal('12000');
        const zero = new Prisma.Decimal(0);
        const dailyWage = salaryDailyWage(contractualAmount, 'MONTHLY');
        expect(dailyWage.toFixed(2)).toBe('400.00');
        expect(salaryDailyWage(new Prisma.Decimal('2800'), 'WEEKLY').toFixed(2)).toBe('400.00');
        expect(salaryDailyWage(new Prisma.Decimal('6000'), 'FORTNIGHTLY').toFixed(2)).toBe('400.00');
        expect(salaryDailyWage(new Prisma.Decimal('5600'), 'BIWEEKLY').toFixed(2)).toBe('400.00');
        const day = (date: string, scheduledMinutes: number, unworkedMinutes: number) => ({ date, scheduledMinutes, unworkedMinutes });
        // One 8 h absence: 12,000 - 400 = C$11,600 (old: 11,400).
        const one = salaryAbsenceDeduction({ dailyWage, scheduledDays: [day('2026-11-18', 480, 480)] });
        expect(one.deduction.toFixed(2)).toBe('400.00');
        const byDeduction = salaryEarningsByDeduction({ entitledAmount: contractualAmount, absenceDeduction: one.deduction });
        expect(byDeduction.toFixed(2)).toBe('11600.00');
        expect(normalizeFullCoverageSalary({ contractualAmount, ordinaryEarnings: byDeduction, paidLeaveEarnings: zero, fullScheduledAttendance: false, fullyCoveredByPaidLeave: false })
            .ordinaryEarnings.toFixed(2)).toBe('11600.00');
        // 20 absences: 12,000 - 20 x 400 = C$4,000 (old legacy divisor: 20 x 600 = 12,000 => C$0).
        const twenty = salaryAbsenceDeduction({ dailyWage, scheduledDays: Array.from({ length: 20 }, (_, index) => day(`2026-11-${String(index + 1).padStart(2, '0')}`, 480, 480)) });
        expect(salaryEarningsByDeduction({ entitledAmount: contractualAmount, absenceDeduction: twenty.deduction }).toFixed(2)).toBe('4000.00');
        // Prorated per scope: 30 min late on a 480-min shift = 400 x 30 / 480 = C$25.
        expect(salaryAbsenceDeduction({ dailyWage, scheduledDays: [day('2026-11-18', 480, 30)] }).deduction.toFixed(2)).toBe('25.00');
        // A 600-min shift absent still deducts one day (min(1, 600/600)) = C$400, never more.
        expect(salaryAbsenceDeduction({ dailyWage, scheduledDays: [day('2026-11-18', 600, 600)] }).deduction.toFixed(2)).toBe('400.00');
        // Never negative: 31 x 400 = 12,400 > 12,000 => C$0.00.
        const all = salaryAbsenceDeduction({ dailyWage, scheduledDays: Array.from({ length: 31 }, (_, index) => day(`2026-12-${String(index + 1).padStart(2, '0')}`, 480, 480)) });
        expect(salaryEarningsByDeduction({ entitledAmount: contractualAmount, absenceDeduction: all.deduction }).toFixed(2)).toBe('0.00');
    });

    it('restores paid leave with the same per-date formula, even when the shift is longer than the leave unit', () => {
        const dailyWage = new Prisma.Decimal('400');
        // 600-min shift absent, 1-day paid leave (DAYS unit = 480 min): deduct 400, restore 400 (old: 480 x rate < deduction).
        const daysLeave = salaryAbsenceDeduction({
            dailyWage, scheduledDays: [{ date: '2026-11-18', scheduledMinutes: 600, unworkedMinutes: 600 }],
            paidLeaves: [{ from: '2026-11-18', to: '2026-11-18', requestedAmount: '1', unit: 'DAYS', unitMinutes: '480' }],
        });
        expect(daysLeave.deduction.toFixed(2)).toBe('400.00');
        expect(daysLeave.paidLeaveRestore.toFixed(2)).toBe('400.00');
        const contractualAmount = new Prisma.Decimal('12000');
        const normalized = normalizeFullCoverageSalary({
            contractualAmount, ordinaryEarnings: salaryEarningsByDeduction({ entitledAmount: contractualAmount, absenceDeduction: daysLeave.deduction }),
            paidLeaveEarnings: daysLeave.paidLeaveRestore, fullScheduledAttendance: false, fullyCoveredByPaidLeave: false,
        });
        // 11,600 ordinary + 400 leave = 12,000.
        expect(normalized.ordinaryEarnings.toFixed(2)).toBe('11600.00');
        expect(normalized.paidLeaveEarnings.toFixed(2)).toBe('400.00');
        // 2 h paid leave on the same absent 600-min shift: restore 400 x 120 / 600 = C$80.
        const hoursLeave = salaryAbsenceDeduction({
            dailyWage, scheduledDays: [{ date: '2026-11-18', scheduledMinutes: 600, unworkedMinutes: 600 }],
            paidLeaves: [{ from: '2026-11-18', to: '2026-11-18', requestedAmount: '2', unit: 'HOURS', unitMinutes: '60' }],
        });
        expect(hoursLeave.paidLeaveRestore.toFixed(2)).toBe('80.00');
        // 3-day leave over 2 absent dates and a worked date restores only the 2 absences: C$800.
        const multi = salaryAbsenceDeduction({
            dailyWage,
            scheduledDays: [
                { date: '2026-11-16', scheduledMinutes: 480, unworkedMinutes: 480 },
                { date: '2026-11-17', scheduledMinutes: 480, unworkedMinutes: 0 },
                { date: '2026-11-18', scheduledMinutes: 480, unworkedMinutes: 480 },
            ],
            paidLeaves: [{ from: '2026-11-16', to: '2026-11-18', requestedAmount: '3', unit: 'DAYS', unitMinutes: '480' }],
        });
        expect(multi.deduction.toFixed(2)).toBe('800.00');
        expect(multi.paidLeaveRestore.toFixed(2)).toBe('800.00');
    });

    it('counts unworked published-shift minutes per date and branch', () => {
        const shift = (localDate: string, shiftId: number) => ({
            scheduleId: 1, scheduleRevision: 1, scheduleStatus: 'PUBLISHED', shiftId,
            startAt: `${localDate}T08:00:00.000Z`, endAt: `${localDate}T16:00:00.000Z`,
            breakMinutes: 0, paidBreak: false, branchId: 4, timezoneSnapshot: 'UTC', branchTimezone: 'UTC', localDate,
            originalUserId: 7, effectiveUserId: 7, overrideId: null, overrideEffectiveAt: null,
        });
        const summaries = [
            { date: utc('2026-11-16'), branchId: 4, scopeKey: 'BRANCH:4', scheduledMinutes: 480, ordinaryMinutes: 480, approvedOvertimeMinutes: 0 },
            // 30 minutes late: 480 - 450 = 30 unworked.
            { date: utc('2026-11-17'), branchId: 4, scopeKey: 'BRANCH:4', scheduledMinutes: 480, ordinaryMinutes: 450, approvedOvertimeMinutes: 0 },
            // Absent all day: 480 unworked. Total 30 + 480 = 510.
            { date: utc('2026-11-18'), branchId: 4, scopeKey: 'BRANCH:4', scheduledMinutes: 480, ordinaryMinutes: 0, approvedOvertimeMinutes: 0 },
        ];
        const result = reconcilePublishedShiftSummaries([shift('2026-11-16', 1), shift('2026-11-17', 2), shift('2026-11-18', 3)], summaries);
        expect(result.unworkedScheduledMinutes).toBe(510);
        expect(result.fullScheduledAttendance).toBe(false);
    });

    it('prorates a fixed salary for a partial service window by calendar days', () => {
        // Hired on the 16th of a 31-day month: 12,000 x 16 / 31 = 6,193.548... -> C$6,193.55.
        expect(proratedSalary(new Prisma.Decimal('12000'), 16, 31).toFixed(2)).toBe('6193.55');
        expect(proratedSalary(new Prisma.Decimal('12000'), 31, 31).toFixed(2)).toBe('12000.00');
        expect(proratedSalary(new Prisma.Decimal('12000'), 40, 31).toFixed(2)).toBe('12000.00');
    });

    it('flags approved overtime above 3 h/day or 9 h per ISO week (CT Art. 58)', () => {
        expect(overtimeLegalLimitBreaches([
            { date: utc('2026-11-16'), approvedOvertimeMinutes: 180 },
            { date: utc('2026-11-17'), approvedOvertimeMinutes: 180 },
            { date: utc('2026-11-18'), approvedOvertimeMinutes: 120 },
        ])).toEqual([]);
        // Thursday 240 > 180/day; Mon-Thu 180 + 180 + 120 + 240 = 720 > 540/week; next ISO week starts fresh.
        expect(overtimeLegalLimitBreaches([
            { date: utc('2026-11-16'), approvedOvertimeMinutes: 180 },
            { date: utc('2026-11-17'), approvedOvertimeMinutes: 180 },
            { date: utc('2026-11-18'), approvedOvertimeMinutes: 120 },
            { date: utc('2026-11-19'), approvedOvertimeMinutes: 240 },
            { date: utc('2026-11-23'), approvedOvertimeMinutes: 60 },
        ])).toEqual(['2026-11-19 (240 min/día)', 'semana del 2026-11-16 (720 min/semana)']);
    });

    it('maps the default aguinaldo sources to the component sources the calculation writes', () => {
        // ['ORDINARY','OVERTIME','PAID_LEAVE'] used to match only OVERTIME: 12 x 12,000 salary + 600 overtime
        // gave 600 / 12 = C$50 instead of (144,000 + 600) / 12 = C$12,050.
        expect(aguinaldoComponentSources(['ORDINARY', 'OVERTIME', 'PAID_LEAVE'])).toEqual(['ORDINARY', 'RULE', 'OVERTIME', 'PAID_LEAVE', 'LEAVE']);
        expect(aguinaldoComponentSources(['RULE', ' RULE '])).toEqual(['RULE']);
    });

    const publishedShift = (localDate: string, shiftId: number, branchId = 4, start = '08:00', end = '16:00') => ({
        scheduleId: 1, scheduleRevision: 1, scheduleStatus: 'PUBLISHED', shiftId,
        startAt: `${localDate}T${start}:00.000Z`, endAt: `${localDate}T${end}:00.000Z`,
        breakMinutes: 0, paidBreak: false, branchId, timezoneSnapshot: 'UTC', branchTimezone: 'UTC', localDate,
        originalUserId: 7, effectiveUserId: 7, overrideId: null, overrideEffectiveAt: null,
    });

    it('never deducts an unworked published shift on a paid holiday of that branch', () => {
        const holiday = (branchId: number | null) => [{ id: 9, date: utc('2026-11-18'), branchId, name: 'Feriado' }];
        const shifts = [publishedShift('2026-11-17', 1), publishedShift('2026-11-18', 2)];
        const summaries = [{ date: utc('2026-11-17'), branchId: 4, scopeKey: 'BRANCH:4', scheduledMinutes: 480, ordinaryMinutes: 480, approvedOvertimeMinutes: 0 }];
        // Company-wide holiday on 11-18: 480 min excused, nothing deducted => salary C$12,000 intact.
        const excused = reconcilePublishedShiftSummaries(shifts, summaries, holiday(null));
        expect(excused.unworkedScheduledMinutes).toBe(0);
        expect(excused.holidayExcusedMinutes).toBe(480);
        expect(excused.scheduledDays).toEqual([{ date: '2026-11-17', scheduledMinutes: 480, unworkedMinutes: 0 }]);
        const dailyWage = new Prisma.Decimal('400');
        expect(salaryAbsenceDeduction({ dailyWage, scheduledDays: excused.scheduledDays }).deduction.toFixed(2)).toBe('0.00');
        // Holiday scoped to branch 5 does not excuse the branch-4 shift: deduct C$400.
        const other = reconcilePublishedShiftSummaries(shifts, summaries, holiday(5));
        expect(other.unworkedScheduledMinutes).toBe(480);
        expect(salaryAbsenceDeduction({ dailyWage, scheduledDays: other.scheduledDays }).deduction.toFixed(2)).toBe('400.00');
        // Split day across two branches (300 + 300 min) fully absent deducts one daily wage, C$400, not C$800.
        const split = reconcilePublishedShiftSummaries([publishedShift('2026-11-19', 3, 4, '08:00', '13:00'), publishedShift('2026-11-19', 4, 5, '14:00', '19:00')], []);
        expect(split.scheduledDays).toEqual([{ date: '2026-11-19', scheduledMinutes: 600, unworkedMinutes: 600 }]);
        expect(salaryAbsenceDeduction({ dailyWage, scheduledDays: split.scheduledDays }).deduction.toFixed(2)).toBe('400.00');
    });

    it('keeps UNCONFIGURED_PAYMENT_CONCEPT blocking for automatic income missing from the frozen catalog', () => {
        // The test catalog has DESCANSO_TRABAJADO but not FERIADO_TRABAJADO; manual components are UNCLASSIFIED_MANUAL_INCOME's job.
        expect(unconfiguredIncomeComponentCodes([
            { code: 'INGRESO_ORDINARIO_FIJO', type: 'INCOME', source: 'RULE' },
            { code: 'FERIADO_TRABAJADO', type: 'INCOME', source: 'HOLIDAY' },
            { code: 'DESCANSO_TRABAJADO', type: 'INCOME', source: 'REST_DAY' },
            { code: 'BONO_LIBRE', type: 'INCOME', source: 'MANUAL' },
            { code: 'FERIADO_TRABAJADO', type: 'INCOME', source: 'HOLIDAY' },
        ], statutory)).toEqual(['FERIADO_TRABAJADO']);
        const inactive = { ...statutory, paymentConceptCatalog: statutory.paymentConceptCatalog.map(item => item.code === 'DESCANSO_TRABAJADO' ? { ...item, active: false } : item) };
        expect(unconfiguredIncomeComponentCodes([{ code: 'DESCANSO_TRABAJADO', type: 'INCOME', source: 'REST_DAY' }], inactive)).toEqual(['DESCANSO_TRABAJADO']);
        const source = fs.readFileSync(path.resolve(__dirname, '../../services/hr-payroll.service.ts'), 'utf8');
        expect(source).toContain('const unconfiguredCodes = unconfiguredIncomeComponentCodes(incomeComponents, input.config.statutory);');
        const seed = fs.readFileSync(path.resolve(__dirname, '../../../prisma/seed-hr-payroll-demo.ts'), 'utf8');
        expect(seed).toContain("code: 'FERIADO_TRABAJADO'");
        expect(seed).toContain("code: 'DESCANSO_TRABAJADO'");
    });

    it('flags a published schedule that covers only part of the service window', () => {
        // November 2026: 30 days, 5 Sundays (1, 8, 15, 22, 29), paid holiday Wed 18 => 24 expected working days.
        const holidayDates = new Set(['2026-11-18']);
        const twoWeeks = new Set(['02', '03', '04', '05', '06', '07', '09', '10', '11', '12', '13', '14'].map(day => `2026-11-${day}`));
        const base = { serviceFrom: utc('2026-11-01'), serviceTo: utc('2026-11-30'), restDays: [7], holidayDates };
        // Only 12 published dates: 12 of 24 missing.
        expect(publishedScheduleShortfall({ ...base, publishedDates: twoWeeks }))
            .toEqual({ expectedWorkingDays: 24, coveredWorkingDays: 12, missingWorkingDays: 12 });
        // Approved leave Mon 23 - Sat 28 covers 6 more: 6 missing.
        expect(publishedScheduleShortfall({ ...base, publishedDates: twoWeeks, leaveIntervals: [{ from: utc('2026-11-23'), to: utc('2026-11-28') }] }).missingWorkingDays).toBe(6);
        // Complete Mon-Sat schedule (holiday excluded): nothing missing.
        const all = new Set(Array.from({ length: 30 }, (_, index) => `2026-11-${String(index + 1).padStart(2, '0')}`)
            .filter(date => !isWeeklyRestDay(utc(date), [7]) && date !== '2026-11-18'));
        expect(publishedScheduleShortfall({ ...base, publishedDates: all })).toEqual({ expectedWorkingDays: 24, coveredWorkingDays: 24, missingWorkingDays: 0 });
        const source = fs.readFileSync(path.resolve(__dirname, '../../services/hr-payroll.service.ts'), 'utf8');
        expect(source).toContain("code: 'INCOMPLETE_PUBLISHED_SCHEDULE'");
    });

    it('lists every employee once in the run-level REST_DAY_DEFAULT_APPLIED warning', () => {
        expect(restDayDefaultAppliedMessage([{ id: 3, name: 'Ana' }, { id: 5, name: 'Luis' }]))
            .toBe('2 colaborador(es) sin día de descanso configurado: Ana (#3), Luis (#5); se pagó el recargo de séptimo día sobre el domingo (Art. 64 CT). Configure su descanso real y recalcule si no corresponde');
    });
});
