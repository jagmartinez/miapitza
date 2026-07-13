interface ZonedParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
        return true;
    } catch {
        return false;
    }
}

function formatter(timeZone: string): Intl.DateTimeFormat {
    const cached = formatters.get(timeZone);
    if (cached) return cached;
    if (!isValidTimeZone(timeZone)) throw new Error(`Zona horaria inválida: ${timeZone}`);

    const created = new Intl.DateTimeFormat('en-US', {
        timeZone,
        calendar: 'gregory',
        numberingSystem: 'latn',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });
    formatters.set(timeZone, created);
    return created;
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
    const values: Record<string, number> = {};
    for (const part of formatter(timeZone).formatToParts(date)) {
        if (part.type !== 'literal') values[part.type] = Number(part.value);
    }
    return {
        year: values.year,
        month: values.month,
        day: values.day,
        hour: values.hour,
        minute: values.minute,
        second: values.second
    };
}

function zonedDateTimeToUtc(parts: ZonedParts, timeZone: string): Date {
    const targetAsUtc = Date.UTC(
        parts.year, parts.month - 1, parts.day,
        parts.hour, parts.minute, parts.second
    );
    let guess = targetAsUtc;

    // Resolve the zone offset at the target instant. Repeating also handles
    // offset transitions without relying on the host/container timezone.
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const actual = getZonedParts(new Date(guess), timeZone);
        const actualAsUtc = Date.UTC(
            actual.year, actual.month - 1, actual.day,
            actual.hour, actual.minute, actual.second
        );
        const correction = targetAsUtc - actualAsUtc;
        guess += correction;
        if (correction === 0) break;
    }
    return new Date(guess);
}

function addCalendarDays(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>, days: number) {
    const normalized = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return {
        year: normalized.getUTCFullYear(),
        month: normalized.getUTCMonth() + 1,
        day: normalized.getUTCDate()
    };
}

export function getZonedDayBounds(timeZone: string, instant: Date = new Date()) {
    const local = getZonedParts(instant, timeZone);
    const start = zonedDateTimeToUtc({ ...local, hour: 0, minute: 0, second: 0 }, timeZone);
    const nextDay = addCalendarDays(local, 1);
    const endExclusive = zonedDateTimeToUtc({ ...nextDay, hour: 0, minute: 0, second: 0 }, timeZone);
    return { start, endExclusive, endInclusive: new Date(endExclusive.getTime() - 1) };
}

export function getZonedDaysBounds(timeZone: string, days: number, instant: Date = new Date()) {
    if (!Number.isInteger(days) || days < 1) throw new Error('El rango debe contener al menos un día');
    const local = getZonedParts(instant, timeZone);
    const start = zonedDateTimeToUtc({ ...local, hour: 0, minute: 0, second: 0 }, timeZone);
    const afterRange = addCalendarDays(local, days);
    const endExclusive = zonedDateTimeToUtc({ ...afterRange, hour: 0, minute: 0, second: 0 }, timeZone);
    return { start, endExclusive, endInclusive: new Date(endExclusive.getTime() - 1) };
}

export function getZonedDayStartOffset(timeZone: string, dayOffset: number, instant: Date = new Date()): Date {
    if (!Number.isInteger(dayOffset)) throw new Error('El desplazamiento de días debe ser entero');
    const local = getZonedParts(instant, timeZone);
    const target = addCalendarDays(local, dayOffset);
    return zonedDateTimeToUtc({ ...target, hour: 0, minute: 0, second: 0 }, timeZone);
}

export function getZonedMonthBounds(timeZone: string, instant: Date = new Date()) {
    const local = getZonedParts(instant, timeZone);
    const start = zonedDateTimeToUtc({
        year: local.year, month: local.month, day: 1, hour: 0, minute: 0, second: 0
    }, timeZone);
    const nextMonth = new Date(Date.UTC(local.year, local.month, 1));
    const endExclusive = zonedDateTimeToUtc({
        year: nextMonth.getUTCFullYear(),
        month: nextMonth.getUTCMonth() + 1,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0
    }, timeZone);
    return { start, endExclusive, endInclusive: new Date(endExclusive.getTime() - 1) };
}

export function parseZonedDateStart(value: string, timeZone: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value);
    const [year, month, day] = value.split('-').map(Number);
    return zonedDateTimeToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
}

export function parseZonedDateEnd(value: string, timeZone: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value);
    const [year, month, day] = value.split('-').map(Number);
    const nextDay = addCalendarDays({ year, month, day }, 1);
    const endExclusive = zonedDateTimeToUtc({ ...nextDay, hour: 0, minute: 0, second: 0 }, timeZone);
    return new Date(endExclusive.getTime() - 1);
}

export function zonedDateKey(date: Date, timeZone: string): string {
    const { year, month, day } = getZonedParts(date, timeZone);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function zonedMonthKey(date: Date, timeZone: string): string {
    const { year, month } = getZonedParts(date, timeZone);
    return `${year}-${String(month).padStart(2, '0')}`;
}

export function zonedHour(date: Date, timeZone: string): number {
    return getZonedParts(date, timeZone).hour;
}

export function zonedWeekday(date: Date, timeZone: string): number {
    const { year, month, day } = getZonedParts(date, timeZone);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
