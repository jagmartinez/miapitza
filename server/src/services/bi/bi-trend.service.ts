import { SettingService } from '../setting.service';
import { bucketBounds, loadBiFacts, loadGoals, monthlyInInterval, round2, totalsInInterval, type BiTotals } from './bi-common';
import { resolveBiRange, type BiQuery, type BiRange } from './bi-range';

export type BiTrendMetric = 'netSales' | 'grossMargin' | 'orders' | 'avgTicket';

export interface BiTrend { buckets: string[]; current: number[]; previous: number[]; goal: number | null }

function valueOf(metric: BiTrendMetric, t: BiTotals): number {
    switch (metric) {
        case 'netSales': return t.netSales;
        // Gross margin in C$: net sales minus real food cost.
        case 'grossMargin': return round2(t.netSales - t.costReal);
        case 'orders': return t.orders;
        case 'avgTicket': return t.avgTicket;
    }
}

/**
 * Series by bucket. Empty buckets are kept with 0 (a bucket without orders has no
 * sales and no ticket). `previous[i]` is aligned by position with `current[i]`.
 * `goal` is the per-bucket target (monthly goal prorated by time, averaged over the
 * buckets); fixed for the ticket; null for orders or when no goal is configured.
 */
export async function getBiTrend(q: BiQuery, metric: BiTrendMetric, now: Date = new Date()): Promise<BiTrend> {
    const timezone = await SettingService.getTimezone(q.companyId);
    const range = resolveBiRange(q, now, timezone);
    const recipeCache = new Map<number, number | null>();
    const [goals, cur, prev] = await Promise.all([
        loadGoals(q.companyId, q.branchIds),
        loadBiFacts(q, range.from, range.to, timezone, recipeCache),
        loadBiFacts(q, range.cmpFrom, range.cmpTo, timezone, recipeCache),
    ]);
    const fixed = goals.fixedMonthlyExpenses;

    const bounds = bucketBounds(range);
    const cmpRange: BiRange = { ...range, from: range.cmpFrom, to: range.cmpTo };
    const cmpBounds = bucketBounds(cmpRange);

    const current = bounds.map((b) => valueOf(metric, totalsInInterval(cur, b.start, b.end, fixed, timezone)));
    // Calendars can differ in length (leap years): align by position, pad/trim to the current length.
    const previous = bounds.map((_, i) => {
        const b = cmpBounds[i];
        return b ? valueOf(metric, totalsInInterval(prev, b.start, b.end, fixed, timezone)) : 0;
    });

    let goal: number | null = null;
    if (metric === 'netSales' || metric === 'grossMargin') {
        const sales = monthlyInInterval(goals.monthlySales, range.from, range.to, timezone) / Math.max(bounds.length, 1);
        if (sales > 0) goal = round2(metric === 'netSales' ? sales : sales * (goals.grossMarginPct / 100));
    } else if (metric === 'avgTicket') {
        goal = goals.avgTicket > 0 ? goals.avgTicket : null;
    }

    return { buckets: bounds.map((b) => b.key), current, previous, goal };
}
