import { Prisma } from '@prisma/client';
import {
    aguinaldoBaseWindowStart,
    highestMonthlyIncome,
    legalMinuteRate,
    protectedDayPremium,
    LEGAL_ORDINARY_DAILY_MINUTES,
} from '../../services/hr-payroll.service';
import { readFileSync } from 'fs';
import { join } from 'path';

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

describe('HR payroll overtime: monthly salary / 120 per hour at 2x', () => {
    it('pays C$12,000 monthly salary overtime at C$100 per hour regardless of the minute divisor', () => {
        const rate = legalMinuteRate({ compensationType: 'SALARY', amount: D(12000), payFrequency: 'MONTHLY' });
        expect(rate.times(60).times(2).toFixed(2)).toBe('100.00');
        expect(rate.times(3 * 60).times(2).toFixed(2)).toBe('300.00');
    });

    it('derives the hourly wage from the CT daily wage for other frequencies and from the hourly amount', () => {
        expect(legalMinuteRate({ compensationType: 'SALARY', amount: D(3000), payFrequency: 'WEEKLY' }).times(480).toFixed(4))
            .toBe(D(3000).dividedBy(7).toFixed(4));
        expect(legalMinuteRate({ compensationType: 'HOURLY', amount: D(60), payFrequency: 'MONTHLY' }).times(60).toFixed(2)).toBe('60.00');
    });

    it('pays a worked holiday double: one extra daily wage on top of the ordinary day', () => {
        const rate = legalMinuteRate({ compensationType: 'SALARY', amount: D(12000), payFrequency: 'MONTHLY' });
        const holiday = protectedDayPremium({ minuteRate: rate, payableMinutes: LEGAL_ORDINARY_DAILY_MINUTES, holiday: true, restDay: false, holidayMultiplier: '2', restDayMultiplier: '2' });
        expect(holiday.premium.toFixed(2)).toBe('400.00');
    });

    it('the calculation uses the legal rate for overtime and caps the protected-day premium at one day', () => {
        const source = readFileSync(join(__dirname, '../../services/hr-payroll.service.ts'), 'utf8');
        expect(source).toContain('premiumMinuteRate.times(summary.approvedOvertimeMinutes).times(config.regular.overtimeMultiplier)');
        expect(source).toContain('payableMinutes: Math.min(payableMinutes, LEGAL_ORDINARY_DAILY_MINUTES)');
    });
});

describe('HR aguinaldo: highest salary of the last 6 months', () => {
    it('starts the window on the first day of the 6th month back from the cutoff month', () => {
        expect(aguinaldoBaseWindowStart(new Date('2026-11-30T00:00:00.000Z'), 6).toISOString().slice(0, 10)).toBe('2026-06-01');
        expect(aguinaldoBaseWindowStart(new Date('2026-03-31T00:00:00.000Z'), 6).toISOString().slice(0, 10)).toBe('2025-10-01');
    });

    it('groups paid periods by the month they end and takes the highest month', () => {
        const best = highestMonthlyIncome([
            { periodTo: new Date('2026-06-15T00:00:00.000Z'), amount: D(6000) },
            { periodTo: new Date('2026-06-30T00:00:00.000Z'), amount: D(6000) },
            { periodTo: new Date('2026-07-15T00:00:00.000Z'), amount: D(6500) },
            { periodTo: new Date('2026-07-31T00:00:00.000Z'), amount: D(6000) },
            { periodTo: new Date('2026-08-31T00:00:00.000Z'), amount: D(12000) },
        ]);
        expect(best).toEqual({ month: '2026-07', amount: D(12500) });
    });

    it('returns zero without history', () => {
        expect(highestMonthlyIncome([])).toEqual({ month: null, amount: D(0) });
    });
});
