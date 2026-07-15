import { describe, expect, it } from 'vitest';
import {
    addDaysDateOnly,
    isDateInWeek,
    shiftCrossesMidnight,
    sortScheduleShifts,
    weekDates,
    weekStartFor,
    toScheduledShiftApiInput,
} from './scheduleDates';

describe('HR schedule date rules', () => {
    it('normalizes any date to a Monday and builds a seven-day week', () => {
        expect(weekStartFor('2026-07-16')).toBe('2026-07-13');
        expect(weekDates('2026-07-13')).toEqual([
            '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16',
            '2026-07-17', '2026-07-18', '2026-07-19',
        ]);
        expect(isDateInWeek('2026-07-19', '2026-07-13')).toBe(true);
        expect(isDateInWeek('2026-07-20', '2026-07-13')).toBe(false);
    });

    it('handles month/year boundaries without timezone drift', () => {
        expect(addDaysDateOnly('2026-12-28', 7)).toBe('2027-01-04');
        expect(addDaysDateOnly('2027-01-04', -7)).toBe('2026-12-28');
        expect(() => addDaysDateOnly('2026-02-31', 1)).toThrow('Fecha inválida');
    });

    it('identifies overnight shifts and orders shifts chronologically', () => {
        expect(shiftCrossesMidnight({ startTime: '22:00', endTime: '06:00' })).toBe(true);
        expect(shiftCrossesMidnight({ startTime: '08:00', endTime: '17:00' })).toBe(false);
        expect(shiftCrossesMidnight({ startTime: '08:00', endTime: '08:00' })).toBe(false);
        const shifts = [
            { date: '2026-07-14', startTime: '08:00' },
            { date: '2026-07-13', startTime: '14:00' },
            { date: '2026-07-13', startTime: '06:00' },
        ];
        expect(sortScheduleShifts(shifts)).toEqual([shifts[2], shifts[1], shifts[0]]);
    });

    it('preserves branch-local wall time for authoritative server conversion', () => {
        const input = toScheduledShiftApiInput({
            userId: 3,
            branchId: 4,
            jobPositionId: 5,
            date: '2026-07-13',
            startTime: '22:00',
            endTime: '06:00',
            breakMinutes: 30,
        });
        expect(input).toEqual(expect.objectContaining({
            date: '2026-07-13',
            startTime: '22:00',
            endTime: '06:00',
            breakMinutes: 30,
        }));
    });
});
