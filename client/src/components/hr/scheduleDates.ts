import type { HrScheduledShiftApiInput, HrScheduleShift, HrScheduleShiftInput } from '../../types/hr-schedule';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function fromDateOnly(value: string): Date {
    const match = DATE_ONLY.exec(value);
    if (!match) throw new Error(`Fecha inválida: ${value}`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new Error(`Fecha inválida: ${value}`);
    }
    return date;
}

function toDateOnlyUtc(value: Date): string {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

export function addDaysDateOnly(value: string, days: number): string {
    const date = fromDateOnly(value);
    date.setUTCDate(date.getUTCDate() + days);
    return toDateOnlyUtc(date);
}

export function weekStartFor(value: Date | string = new Date()): string {
    if (typeof value === 'string') {
        const date = fromDateOnly(value);
        const offset = (date.getUTCDay() + 6) % 7;
        date.setUTCDate(date.getUTCDate() - offset);
        return toDateOnlyUtc(date);
    }
    const localDate = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    return weekStartFor(localDate);
}

export function weekDates(weekStart: string): string[] {
    return Array.from({ length: 7 }, (_, index) => addDaysDateOnly(weekStart, index));
}

export function isDateInWeek(date: string, weekStart: string): boolean {
    return date >= weekStart && date <= addDaysDateOnly(weekStart, 6);
}

export function timeToMinutes(value: string): number {
    const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? (hours * 60) + minutes : 0;
}

export function shiftCrossesMidnight(shift: Pick<HrScheduleShiftInput, 'startTime' | 'endTime'>): boolean {
    return timeToMinutes(shift.endTime) < timeToMinutes(shift.startTime);
}

export function sortScheduleShifts<T extends Pick<HrScheduleShift, 'date' | 'startTime'>>(shifts: T[]): T[] {
    return [...shifts].sort((left, right) =>
        left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime)
    );
}

export function toScheduleShiftInput(shift: HrScheduleShift): HrScheduleShiftInput {
    return {
        userId: shift.userId,
        branchId: shift.branchId,
        jobPositionId: shift.jobPositionId,
        shiftTemplateId: shift.shiftTemplateId,
        date: shift.date,
        startTime: shift.startTime.slice(0, 5),
        endTime: shift.endTime.slice(0, 5),
        breakMinutes: shift.breakMinutes ?? 0,
        paidBreak: shift.paidBreak ?? false,
        notes: shift.notes?.trim() || null,
    };
}

/** Preserve branch-local wall-clock values; the server owns timezone/DST conversion. */
export function toScheduledShiftApiInput(input: HrScheduleShiftInput): HrScheduledShiftApiInput {
    return {
        userId: input.userId,
        branchId: input.branchId,
        jobPositionId: input.jobPositionId ?? null,
        shiftTemplateId: input.shiftTemplateId ?? null,
        date: input.date,
        startTime: input.startTime.slice(0, 5),
        endTime: input.endTime.slice(0, 5),
        breakMinutes: input.breakMinutes ?? 0,
        paidBreak: input.paidBreak ?? false,
        notes: input.notes?.trim() || null,
    };
}

export function existingShiftApiInput(shift: HrScheduleShift): HrScheduledShiftApiInput {
    return toScheduledShiftApiInput(shift);
}
