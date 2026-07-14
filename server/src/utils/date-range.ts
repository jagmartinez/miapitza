import { parseZonedDateEnd, parseZonedDateStart } from './timezone';

export class InvalidQueryDateError extends Error {
    statusCode = 400;
    constructor(value: string) {
        super(`Fecha de consulta inválida: ${value}`);
        this.name = 'InvalidQueryDateError';
    }
}

function ensureValidDate(value: string, parse: () => Date): Date {
    try {
        const result = parse();
        if (Number.isNaN(result.getTime())) throw new InvalidQueryDateError(value);
        return result;
    } catch (error) {
        if (error instanceof InvalidQueryDateError) throw error;
        throw new InvalidQueryDateError(value);
    }
}

function isValidCalendarDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const normalized = new Date(Date.UTC(year, month - 1, day));
    return normalized.getUTCFullYear() === year
        && normalized.getUTCMonth() === month - 1
        && normalized.getUTCDate() === day;
}

/**
 * Parse date query params. HTML `<input type="date">` sends YYYY-MM-DD which
 * `new Date()` interprets as UTC midnight — excluding records later that day.
 */
export function parseQueryDateFrom(value: string, timeZone: string = 'UTC'): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        if (!isValidCalendarDate(value)) throw new InvalidQueryDateError(value);
        return ensureValidDate(value, () => parseZonedDateStart(value, timeZone));
    }
    return ensureValidDate(value, () => new Date(value));
}

export function parseQueryDateTo(value: string, timeZone: string = 'UTC'): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        if (!isValidCalendarDate(value)) throw new InvalidQueryDateError(value);
        return ensureValidDate(value, () => parseZonedDateEnd(value, timeZone));
    }
    return ensureValidDate(value, () => new Date(value));
}

export function parseOptionalQueryDateFrom(value?: string, timeZone: string = 'UTC'): Date | undefined {
    return value ? parseQueryDateFrom(value, timeZone) : undefined;
}

export function parseOptionalQueryDateTo(value?: string, timeZone: string = 'UTC'): Date | undefined {
    return value ? parseQueryDateTo(value, timeZone) : undefined;
}
