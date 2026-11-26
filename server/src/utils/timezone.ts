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

export type TimeZoneDisambiguation = 'earlier' | 'later';

function sameZonedParts(left: ZonedParts, right: ZonedParts): boolean {
    return left.year === right.year && left.month === right.month && left.day === right.day &&
        left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

export function zonedDateTimeToUtc(
    parts: ZonedParts,
    timeZone: string,
    disambiguation: TimeZoneDisambiguation = 'earlier',
): Date {
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
    const result = new Date(guess);
    if (!sameZonedParts(getZonedParts(result, timeZone), parts)) {
        // Spring-forward gaps contain wall-clock values that never occur. Fail
        // closed instead of silently moving the shift to a different hour.
        throw new RangeError('La hora local no existe en la zona horaria indicada por un cambio de horario');
    }
    // Discover both offsets around a fall-back transition and apply a documented,
    // deterministic policy. Weekly schedules use `earlier` unless a caller opts in
    // to `later`; the resulting UTC instant and timezone snapshot are persisted.
    const candidates = new Map<number, Date>();
    for (let hours = -48; hours <= 48; hours += 6) {
        const sampleMs = targetAsUtc + hours * 60 * 60 * 1000;
        const sampleParts = getZonedParts(new Date(sampleMs), timeZone);
        const sampleAsUtc = Date.UTC(
            sampleParts.year, sampleParts.month - 1, sampleParts.day,
            sampleParts.hour, sampleParts.minute, sampleParts.second,
        );
        const candidate = new Date(targetAsUtc - (sampleAsUtc - sampleMs));
        if (sameZonedParts(getZonedParts(candidate, timeZone), parts)) {
            candidates.set(candidate.getTime(), candidate);
        }
    }
    candidates.set(result.getTime(), result);
    const ordered = Array.from(candidates.values()).sort((left, right) => left.getTime() - right.getTime());
    return disambiguation === 'later' ? ordered[ordered.length - 1] : ordered[0];
}

function addCalendarDays(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>, days: number) {
    const normalized = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return {
        year: normalized.getUTCFullYear(),
        month: normalized.getUTCMonth() + 1,
        day: normalized.getUTCDate()
    };
}

function dateKeyOf(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>): number {
    return parts.year * 10000 + parts.month * 100 + parts.day;
}

/**
 * First instant of a local calendar day. Usually local 00:00:00, but in zones
 * whose DST transition happens at midnight (America/Santiago, America/Havana,
 * Asia/Beirut...) 00:00 never occurs; the day then starts at the transition
 * instant (e.g. 01:00 local), found by binary search over the UTC timeline.
 */
export function zonedStartOfDay(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>, timeZone: string): Date {
    try {
        return zonedDateTimeToUtc({ year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0, second: 0 }, timeZone);
    } catch (error) {
        if (!(error instanceof RangeError)) throw error;
    }
    const target = dateKeyOf(parts);
    const utcMidnight = Date.UTC(parts.year, parts.month - 1, parts.day);
    // UTC offsets lie within [-12h, +14h]: at `low` the local date is still
    // before the target day and at `high` it has already reached it.
    let low = utcMidnight - 15 * 60 * 60 * 1000;
    let high = utcMidnight + 13 * 60 * 60 * 1000;
    while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (dateKeyOf(getZonedParts(new Date(mid), timeZone)) >= target) high = mid;
        else low = mid;
    }
    return new Date(high);
}

/** Exclusive end of a local calendar day: the first instant of the next local day. */
function zonedStartOfNextDay(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>, timeZone: string): Date {
    return zonedStartOfDay(addCalendarDays(parts, 1), timeZone);
}

export function getZonedDayBounds(timeZone: string, instant: Date = new Date()) {
    const local = getZonedParts(instant, timeZone);
    const start = zonedStartOfDay(local, timeZone);
    const endExclusive = zonedStartOfNextDay(local, timeZone);
    return { start, endExclusive, endInclusive: new Date(endExclusive.getTime() - 1) };
}

export function getZonedDaysBounds(timeZone: string, days: number, instant: Date = new Date()) {
    if (!Number.isInteger(days) || days < 1) throw new Error('El rango debe contener al menos un día');
    const local = getZonedParts(instant, timeZone);
    const start = zonedStartOfDay(local, timeZone);
    const endExclusive = zonedStartOfDay(addCalendarDays(local, days), timeZone);
    return { start, endExclusive, endInclusive: new Date(endExclusive.getTime() - 1) };
}

export function getZonedDayStartOffset(timeZone: string, dayOffset: number, instant: Date = new Date()): Date {
    if (!Number.isInteger(dayOffset)) throw new Error('El desplazamiento de días debe ser entero');
    const local = getZonedParts(instant, timeZone);
    return zonedStartOfDay(addCalendarDays(local, dayOffset), timeZone);
}

export function getZonedMonthBounds(timeZone: string, instant: Date = new Date()) {
    const local = getZonedParts(instant, timeZone);
    const start = zonedStartOfDay({ year: local.year, month: local.month, day: 1 }, timeZone);
    const nextMonth = new Date(Date.UTC(local.year, local.month, 1));
    const endExclusive = zonedStartOfDay({
        year: nextMonth.getUTCFullYear(),
        month: nextMonth.getUTCMonth() + 1,
        day: 1
    }, timeZone);
    return { start, endExclusive, endInclusive: new Date(endExclusive.getTime() - 1) };
}

export function parseZonedDateStart(value: string, timeZone: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value);
    const [year, month, day] = value.split('-').map(Number);
    return zonedStartOfDay({ year, month, day }, timeZone);
}

export function parseZonedDateEnd(value: string, timeZone: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value);
    const [year, month, day] = value.split('-').map(Number);
    return new Date(zonedStartOfNextDay({ year, month, day }, timeZone).getTime() - 1);
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
