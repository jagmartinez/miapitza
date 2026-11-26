import { getZonedParts, zonedDateTimeToUtc } from '../../utils/timezone';

export type BiPeriod = 'today' | '7d' | '30d' | '12m' | 'custom';
export type BiCompare = 'previous' | 'year';
export type BiGranularity = 'hour' | 'day' | 'month';

export interface BiQuery {
    companyId: number;
    branchIds: number[];
    period: BiPeriod;
    from?: string;
    to?: string;
    compare: BiCompare;
}

/** `to` and `cmpTo` are exclusive bounds (start of the next local day/month). */
export interface BiRange {
    from: Date;
    to: Date;
    cmpFrom: Date;
    cmpTo: Date;
    granularity: BiGranularity;
    timezone: string;
    days: number;
}

interface YMD { year: number; month: number; day: number }

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function localMidnight(ymd: YMD, timezone: string): Date {
    // Normalise overflow (day 0, month 13, ...) through UTC arithmetic first.
    const n = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
    return zonedDateTimeToUtc({
        year: n.getUTCFullYear(), month: n.getUTCMonth() + 1, day: n.getUTCDate(),
        hour: 0, minute: 0, second: 0,
    }, timezone);
}

function localYmd(date: Date, timezone: string): YMD {
    const { year, month, day } = getZonedParts(date, timezone);
    return { year, month, day };
}

function dayNumber(ymd: YMD): number {
    return Math.round(Date.UTC(ymd.year, ymd.month - 1, ymd.day) / 86_400_000);
}

function parseDateOnly(value: string | undefined, label: string): YMD {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
    if (!m) throw new RangeError(`Fecha ${label} inválida`);
    const ymd = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    const check = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
    if (check.getUTCMonth() + 1 !== ymd.month || check.getUTCDate() !== ymd.day) {
        throw new RangeError(`Fecha ${label} inválida`);
    }
    return ymd;
}

/** Same calendar day one year earlier; 29 Feb falls back to 28 Feb. */
function minusOneYear(ymd: YMD): YMD {
    const year = ymd.year - 1;
    const lastDay = new Date(Date.UTC(year, ymd.month, 0)).getUTCDate();
    return { year, month: ymd.month, day: Math.min(ymd.day, lastDay) };
}

export function resolveBiRange(q: BiQuery, now: Date, timezone: string): BiRange {
    const today = localYmd(now, timezone);
    let fromYmd: YMD;
    let toYmd: YMD; // exclusive
    let granularity: BiGranularity;

    switch (q.period) {
        case 'today':
            fromYmd = today;
            toYmd = { ...today, day: today.day + 1 };
            granularity = 'hour';
            break;
        case '7d':
        case '30d': {
            const n = q.period === '7d' ? 7 : 30;
            fromYmd = { ...today, day: today.day - (n - 1) };
            toYmd = { ...today, day: today.day + 1 };
            granularity = 'day';
            break;
        }
        case '12m':
            fromYmd = { year: today.year, month: today.month - 11, day: 1 };
            toYmd = { year: today.year, month: today.month + 1, day: 1 };
            granularity = 'month';
            break;
        case 'custom': {
            const f = parseDateOnly(q.from, 'inicial');
            const t = parseDateOnly(q.to ?? q.from, 'final');
            if (dayNumber(t) < dayNumber(f)) throw new RangeError('El rango es inválido: la fecha final es anterior a la inicial');
            fromYmd = f;
            toYmd = { ...t, day: t.day + 1 };
            granularity = (dayNumber(t) - dayNumber(f) + 1) <= 62 ? 'day' : 'month';
            break;
        }
        default:
            throw new RangeError('Periodo inválido');
    }

    const from = localMidnight(fromYmd, timezone);
    const to = localMidnight(toYmd, timezone);
    const days = dayNumber(localYmd(to, timezone)) - dayNumber(localYmd(from, timezone));

    let cmpFrom: Date;
    let cmpTo: Date;
    if (q.compare === 'year') {
        cmpFrom = localMidnight(minusOneYear(localYmd(from, timezone)), timezone);
        cmpTo = localMidnight(minusOneYear(localYmd(to, timezone)), timezone);
    } else {
        cmpTo = from;
        const f = localYmd(from, timezone);
        cmpFrom = q.period === '12m'
            ? localMidnight({ year: f.year - 1, month: f.month, day: 1 }, timezone)
            : localMidnight({ ...f, day: f.day - days }, timezone);
    }

    return { from, to, cmpFrom, cmpTo, granularity, timezone, days };
}

/** '2026-11-20T13' | '2026-11-20' | '2026-11' in the company timezone. */
export function bucketKey(date: Date, granularity: BiGranularity, timezone: string): string {
    const p = getZonedParts(date, timezone);
    const month = `${pad(p.year, 4)}-${pad(p.month)}`;
    if (granularity === 'month') return month;
    const day = `${month}-${pad(p.day)}`;
    return granularity === 'day' ? day : `${day}T${pad(p.hour)}`;
}

/** Every bucket key of the current range, in order, including empty ones. */
export function buckets(range: BiRange): string[] {
    const keys: string[] = [];
    const seen = new Set<string>();
    const push = (k: string) => { if (!seen.has(k)) { seen.add(k); keys.push(k); } };
    const { granularity, timezone } = range;

    if (granularity === 'hour') {
        for (let t = range.from.getTime(); t < range.to.getTime(); t += 3_600_000) {
            push(bucketKey(new Date(t), 'hour', timezone));
        }
        return keys;
    }
    const start = localYmd(range.from, timezone);
    const end = dayNumber(localYmd(range.to, timezone));
    if (granularity === 'day') {
        for (let d = dayNumber(start); d < end; d += 1) {
            const dt = new Date(d * 86_400_000);
            push(`${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`);
        }
        return keys;
    }
    const last = bucketKey(new Date(range.to.getTime() - 1), 'month', timezone);
    for (let i = 0; i < 1200; i += 1) {
        const dt = new Date(Date.UTC(start.year, start.month - 1 + i, 1));
        const k = `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}`;
        push(k);
        if (k === last) break;
    }
    return keys;
}
