import { SettingService } from '../setting.service';
import prisma from '../../utils/prisma';
import { getZonedParts } from '../../utils/timezone';
import { type BiFacts, loadBiFacts, round2 } from './bi-common';
import { resolveBiRange, type BiQuery, type BiRange } from './bi-range';

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const WEEKDAY_LABELS: Record<Weekday, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' };
const DEFAULT_OPEN_HOUR = 11;
const DEFAULT_CLOSE_HOUR = 22;

export interface BiHeatmap {
    hours: number[];
    days: { weekday: Weekday; label: string; values: number[] }[];
    peak: { weekday: number; hour: number };
    valley: { weekday: number; hour: number };
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a local calendar date. */
export function isoWeekday(year: number, month: number, day: number): Weekday {
    const d = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return (d === 0 ? 7 : d) as Weekday;
}

/** How many times each weekday occurs among the local days of the range. */
export function weekdayOccurrences(range: BiRange): Record<Weekday, number> {
    const out: Record<Weekday, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    const start = getZonedParts(range.from, range.timezone);
    for (let i = 0; i < range.days; i += 1) {
        const d = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
        out[isoWeekday(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())] += 1;
    }
    return out;
}

/**
 * Pure heatmap: value = average sales per occurrence of that weekday in the range, by local hour.
 * Hours cover the operating window with sales (at least 11-22). The peak is the largest cell and the
 * valley the smallest cell that has sales (closed hours are not a valley).
 */
export function buildHeatmap(facts: BiFacts, range: BiRange): BiHeatmap {
    const occurrences = weekdayOccurrences(range);
    const sums = new Map<string, number>();
    let minHour = DEFAULT_OPEN_HOUR;
    let maxHour = DEFAULT_CLOSE_HOUR;
    for (const o of facts.orders) {
        if (o.at.getTime() < range.from.getTime() || o.at.getTime() >= range.to.getTime()) continue;
        const p = getZonedParts(o.at, range.timezone);
        const key = `${isoWeekday(p.year, p.month, p.day)}-${p.hour}`;
        sums.set(key, (sums.get(key) ?? 0) + o.total);
        minHour = Math.min(minHour, p.hour);
        maxHour = Math.max(maxHour, p.hour);
    }
    const hours: number[] = [];
    for (let h = minHour; h <= maxHour; h += 1) hours.push(h);

    const weekdays: Weekday[] = [1, 2, 3, 4, 5, 6, 7];
    const days = weekdays.map((weekday) => ({
        weekday,
        label: WEEKDAY_LABELS[weekday],
        values: hours.map((h) => (occurrences[weekday] > 0
            ? round2((sums.get(`${weekday}-${h}`) ?? 0) / occurrences[weekday])
            : 0)),
    }));

    let peak = { weekday: 1, hour: hours[0] };
    let valley = { weekday: 1, hour: hours[0] };
    let peakValue = -Infinity;
    let valleyValue = Infinity;
    for (const d of days) {
        d.values.forEach((v, i) => {
            if (v > peakValue) { peakValue = v; peak = { weekday: d.weekday, hour: hours[i] }; }
            if (v > 0 && v < valleyValue) { valleyValue = v; valley = { weekday: d.weekday, hour: hours[i] }; }
        });
    }
    if (valleyValue === Infinity) valley = peak;
    return { hours, days, peak, valley };
}

export async function getBiHeatmap(q: BiQuery, now: Date = new Date()): Promise<BiHeatmap> {
    const timezone = await SettingService.getTimezone(q.companyId);
    const range = resolveBiRange(q, now, timezone);
    const facts = await loadBiFacts(q, range.from, range.to, timezone, new Map());
    return buildHeatmap(facts, range);
}

export interface BiPareto {
    items: { menuItemId: number; name: string; margin: number; cumulativePct: number }[];
    itemsFor80Pct: number;
    totalItems: number;
    /** Dishes sold whose recipe cost is N/D: left out of the margin ranking, never counted as 0 cost. */
    unavailableItems: number;
}

/**
 * Pure Pareto of margin by dish (subtotal - units x recipe cost). `cumulativePct` accumulates over the
 * positive margins (dishes losing money add 0), so it is non-decreasing and ends at <= 100.
 * `itemsFor80Pct` and `totalItems` count the whole menu sold, not only the returned top.
 */
export function buildPareto(
    facts: BiFacts, from: Date, to: Date, names: Map<number, string>, limit: number,
): BiPareto {
    const margin = new Map<number, number>();
    const unavailable = new Set<number>();
    for (const o of facts.orders) {
        if (o.at.getTime() < from.getTime() || o.at.getTime() >= to.getTime()) continue;
        for (const i of o.items) {
            const cost = facts.recipeCost.get(i.menuItemId);
            if (cost == null) { unavailable.add(i.menuItemId); continue; }
            margin.set(i.menuItemId, (margin.get(i.menuItemId) ?? 0) + i.subtotal - cost * i.quantity);
        }
    }
    const sorted = [...margin.entries()].sort((a, b) => b[1] - a[1]);
    const positiveTotal = sorted.reduce((s, [, m]) => s + Math.max(m, 0), 0);
    let running = 0;
    let itemsFor80Pct = 0;
    const all = sorted.map(([menuItemId, m], index) => {
        running += Math.max(m, 0);
        const cumulativePct = positiveTotal > 0 ? Math.min(100, round2((running / positiveTotal) * 100)) : 0;
        if (positiveTotal > 0 && itemsFor80Pct === 0 && running / positiveTotal >= 0.8) itemsFor80Pct = index + 1;
        return { menuItemId, name: names.get(menuItemId) ?? `Platillo ${menuItemId}`, margin: round2(m), cumulativePct };
    });
    return {
        items: all.slice(0, Math.max(0, limit)),
        itemsFor80Pct,
        totalItems: sorted.length,
        unavailableItems: unavailable.size,
    };
}

export async function getBiPareto(q: BiQuery, limit = 10, now: Date = new Date()): Promise<BiPareto> {
    const timezone = await SettingService.getTimezone(q.companyId);
    const range = resolveBiRange(q, now, timezone);
    const facts = await loadBiFacts(q, range.from, range.to, timezone, new Map());
    const ids = [...new Set(facts.orders.flatMap((o) => o.items.map((i) => i.menuItemId)))];
    const rows = ids.length > 0
        ? await prisma.menuItem.findMany({ where: { id: { in: ids }, companyId: q.companyId }, select: { id: true, name: true } })
        : [];
    return buildPareto(facts, range.from, range.to, new Map(rows.map((r) => [r.id, r.name])), limit);
}
