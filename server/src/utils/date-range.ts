import { parseZonedDateEnd, parseZonedDateStart } from './timezone';

/**
 * Parse date query params. HTML `<input type="date">` sends YYYY-MM-DD which
 * `new Date()` interprets as UTC midnight — excluding records later that day.
 */
export function parseQueryDateFrom(value: string, timeZone: string = 'UTC'): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return parseZonedDateStart(value, timeZone);
    }
    return new Date(value);
}

export function parseQueryDateTo(value: string, timeZone: string = 'UTC'): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return parseZonedDateEnd(value, timeZone);
    }
    return new Date(value);
}

export function parseOptionalQueryDateFrom(value?: string, timeZone: string = 'UTC'): Date | undefined {
    return value ? parseQueryDateFrom(value, timeZone) : undefined;
}

export function parseOptionalQueryDateTo(value?: string, timeZone: string = 'UTC'): Date | undefined {
    return value ? parseQueryDateTo(value, timeZone) : undefined;
}
