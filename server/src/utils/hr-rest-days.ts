/**
 * Weekly rest day(s) (séptimo día, Código del Trabajo de Nicaragua Art. 64) stored on
 * Employee.weeklyRestDays as ISO weekdays: 1 = Monday ... 7 = Sunday.
 */
export const ISO_WEEKDAY_LABELS_ES: Record<number, string> = {
    1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo',
};

/** Maximum weekly rest days per employee: the séptimo día plus at most one more (e.g. a 5-day week). */
export const MAX_WEEKLY_REST_DAYS = 2;

/** A valid list has 1..2 distinct integers in 1..7. */
export function isValidWeeklyRestDays(value: unknown): value is number[] {
    return Array.isArray(value) && value.length >= 1 && value.length <= MAX_WEEKLY_REST_DAYS &&
        value.every(day => Number.isInteger(day) && day >= 1 && day <= 7) &&
        new Set(value).size === value.length;
}

/** Sorted copy of a valid list; callers validate first. */
export function normalizeWeeklyRestDays(value: number[]): number[] {
    return [...value].sort((a, b) => a - b);
}

/** ISO weekday of a local calendar date stored at UTC midnight (summary.date, holiday.date). */
export function isoWeekdayOfDateKey(date: Date): number {
    return date.getUTCDay() === 0 ? 7 : date.getUTCDay();
}
