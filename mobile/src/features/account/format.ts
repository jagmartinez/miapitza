import type { HrSwapShift } from './hrApi';

/** dd/mm/yyyy from a calendar date. A date column arrives as "2026-11-15" or "2026-11-15T00:00:00.000Z": only the date part counts, never the device zone. */
export function dateOnly(v?: string | null): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function parts(iso: string, timeZone?: string): Record<string, string> | null {
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        const f = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
    } catch {
        return null;
    }
}

/** "19/11/2026 22:00" for a UTC instant, read in the given IANA zone (the device zone when absent or invalid). */
export function instantText(iso?: string | null, timeZone?: string | null): string {
    if (!iso) return '';
    const p = parts(iso, timeZone || undefined) ?? parts(iso);
    return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}` : '';
}

/** "Entrada 08:02" helper: just the time of an instant in a zone. */
export function timeText(iso?: string | null, timeZone?: string | null): string {
    return instantText(iso, timeZone).slice(11);
}

/** "25/11/2026 09:00-17:00 · Sucursal" read in the shift's own timezone (the instants are UTC). */
export function shiftText(sh?: HrSwapShift | null): string {
    if (!sh?.startAt || !sh.endAt) return '';
    const tz = sh.timezoneSnapshot || undefined;
    const a = parts(sh.startAt, tz);
    const b = parts(sh.endAt, tz);
    if (!a || !b) return '';
    return `${a.day}/${a.month}/${a.year} ${a.hour}:${a.minute}-${b.hour}:${b.minute}${sh.branch?.name ? ` · ${sh.branch.name}` : ''}`;
}
