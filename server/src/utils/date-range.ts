/**
 * Parse date query params. HTML `<input type="date">` sends YYYY-MM-DD which
 * `new Date()` interprets as UTC midnight — excluding records later that day.
 */
export function parseQueryDateFrom(value: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const d = new Date(value);
        d.setUTCHours(0, 0, 0, 0);
        return d;
    }
    return new Date(value);
}

export function parseQueryDateTo(value: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const d = new Date(value);
        d.setUTCHours(23, 59, 59, 999);
        return d;
    }
    return new Date(value);
}

export function parseOptionalQueryDateFrom(value?: string): Date | undefined {
    return value ? parseQueryDateFrom(value) : undefined;
}

export function parseOptionalQueryDateTo(value?: string): Date | undefined {
    return value ? parseQueryDateTo(value) : undefined;
}
