import prisma from '../../utils/prisma';
import { effectiveUnitCost } from '../../utils/product-cost';
import { getZonedParts } from '../../utils/timezone';
import { SettingService } from '../setting.service';
import { UnitConversionService } from '../unit-conversion.service';
import {
    bucketBounds, type BiFacts, type BiQuality, loadBiContext, loadBiFacts, loadGoalsForScope,
    type RecipeCostCache, round2, totalsInInterval,
} from './bi-common';
import { channelBreakdown, type ChannelRow } from './bi-pnl.service';
import { buildHeatmap, isoWeekday, weekdayOccurrences, type BiHeatmap, type Weekday } from './bi-patterns.service';
import { resolveBiRange, type BiQuery, type BiRange } from './bi-range';

export type TrafficLight = 'ok' | 'warn' | 'bad';

export interface BranchRow {
    branchId: number; name: string; netSales: number; deltaPct: number | null; spark: number[]; avgTicket: number;
    foodCostPct: number;
    /** null (N/D) when no approved payroll covers the range for the branch: never shown as 0. */
    laborCostPct: number | null;
    /** null (N/D) together with laborCostPct: the operating margin would ignore personnel cost. */
    operatingMarginPct: number | null;
    salesPerSqm: number | null;
    /** Share of the range covered by approved payroll ('partial' means labor and margin are incomplete). */
    laborQuality: BiQuality;
    status: { foodCost: TrafficLight; labor: TrafficLight | 'nd' };
}

export interface Insight {
    id: string;
    kind: 'cost' | 'branch' | 'opportunity' | 'channel';
    severity: 'danger' | 'warning' | 'success';
    impactAmount: number;
    message: string;
    action: { label: string; route: string };
}

const MAX_INSIGHTS = 5;
const DELIVERY_CHANNELS = new Set(['DELIVERY', 'PEDIDOSYA']);

const money = (n: number): string => `C$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** ok <= goal, warn <= goal + 2 pts, bad above. A goal that is not configured (<= 0) never alarms. */
export function trafficLight(value: number, goal: number): TrafficLight {
    if (!(goal > 0)) return 'ok';
    if (value <= goal) return 'ok';
    return value <= goal + 2 ? 'warn' : 'bad';
}

const laborQualityOf = (coverage: number): BiQuality => (coverage < 0.001 ? 'unavailable' : coverage < 0.999 ? 'partial' : 'complete');

// ---- Branch comparison -----------------------------------------------------

type BranchDetail = BranchRow & { prevNetSales: number };

async function loadBranchDetails(
    q: BiQuery, range: BiRange, timezone: string, recipeCache: RecipeCostCache,
): Promise<BranchDetail[]> {
    const branches = await prisma.branch.findMany({
        where: { companyId: q.companyId, status: 'ACTIVE', ...(q.branchIds.length > 0 ? { id: { in: q.branchIds } } : {}) },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });
    const bounds = bucketBounds(range);
    const rows = await Promise.all(branches.map(async (b): Promise<BranchDetail> => {
        const bq: BiQuery = { ...q, branchIds: [b.id] };
        // Goals of THIS branch (its override or the company value), not the company-wide ones.
        const [goals, cur, prev] = await Promise.all([
            loadGoalsForScope(q.companyId, b.id),
            loadBiFacts(bq, range.from, range.to, timezone, recipeCache),
            loadBiFacts(bq, range.cmpFrom, range.cmpTo, timezone, recipeCache),
        ]);
        const fixed = goals.fixedMonthlyExpenses;
        const t = totalsInInterval(cur, range.from, range.to, fixed, timezone);
        const p = totalsInInterval(prev, range.cmpFrom, range.cmpTo, fixed, timezone);
        const laborQuality = laborQualityOf(t.laborCoverage);
        const laborKnown = laborQuality !== 'unavailable';
        return {
            branchId: b.id,
            name: b.name,
            netSales: t.netSales,
            prevNetSales: p.netSales,
            deltaPct: p.netSales === 0 ? null : round2(((t.netSales - p.netSales) / Math.abs(p.netSales)) * 100),
            spark: bounds.map((x) => totalsInInterval(cur, x.start, x.end, fixed, timezone).netSales),
            avgTicket: t.avgTicket,
            foodCostPct: t.foodCostRealPct,
            laborCostPct: laborKnown ? t.laborCostPct : null,
            operatingMarginPct: laborKnown ? t.operatingMarginPct : null,
            // Square metres are not stored on Branch yet.
            salesPerSqm: null,
            laborQuality,
            status: {
                foodCost: trafficLight(t.foodCostRealPct, goals.foodCostPct),
                labor: laborKnown ? trafficLight(t.laborCostPct, goals.laborCostMaxPct) : 'nd',
            },
        };
    }));
    return rows.sort((a, b) => b.netSales - a.netSales);
}

export async function getBiBranches(q: BiQuery, now: Date = new Date()): Promise<BranchRow[]> {
    const timezone = await SettingService.getTimezone(q.companyId);
    const range = resolveBiRange(q, now, timezone);
    const details = await loadBranchDetails(q, range, timezone, new Map());
    return details.map(({ prevNetSales: _prev, ...row }) => row);
}

// ---- Insight rules (pure) --------------------------------------------------

/** Supply whose real cost exceeds its theoretical cost the most. Both maps hold amounts in C$. */
export function topVarianceSupply(
    real: Map<number, number>, theoretical: Map<number, number>, names: Map<number, string>,
): { name: string; diff: number } | null {
    let best: { id: number; diff: number } | null = null;
    for (const id of new Set([...real.keys(), ...theoretical.keys()])) {
        const diff = (real.get(id) ?? 0) - (theoretical.get(id) ?? 0);
        if (diff > 0 && (!best || diff > best.diff)) best = { id, diff };
    }
    return best ? { name: names.get(best.id) ?? `Insumo ${best.id}`, diff: round2(best.diff) } : null;
}

/** Rule 1 - cost: real vs theoretical food cost gap above the goal. Needs a complete theoretical cost. */
export function costInsight(input: {
    realPct: number; theoreticalPct: number; goalGapPts: number; netSales: number;
    quality: BiQuality; topSupply: { name: string; diff: number } | null;
}): Insight | null {
    if (input.quality !== 'complete' || !(input.netSales > 0)) return null;
    const gap = round2(input.realPct - input.theoreticalPct);
    if (!(gap > input.goalGapPts)) return null;
    // Impact = gap (points of net sales) x net sales.
    const impact = round2((gap / 100) * input.netSales);
    const supply = input.topSupply ? ` El mayor desvío es ${input.topSupply.name} (${money(input.topSupply.diff)} sobre lo teórico).` : '';
    return {
        id: 'cost-gap',
        kind: 'cost',
        severity: gap > input.goalGapPts * 2 ? 'danger' : 'warning',
        impactAmount: impact,
        message: `El costo real supera al teórico por ${gap.toFixed(2)} pts (${money(impact)}).${supply}`,
        action: { label: 'Ver costos', route: '/cost-report' },
    };
}

/** Rule 2 - branch: sales down more than 2 % against the comparison period. Impact = lost sales. */
export function branchInsights(rows: { branchId: number; name: string; netSales: number; prevNetSales: number; deltaPct: number | null }[]): Insight[] {
    const out: Insight[] = [];
    for (const r of rows) {
        if (r.deltaPct == null || !(r.deltaPct < -2)) continue;
        const lost = round2(r.prevNetSales - r.netSales);
        if (!(lost > 0)) continue;
        out.push({
            id: `branch-${r.branchId}`,
            kind: 'branch',
            severity: r.deltaPct < -10 ? 'danger' : 'warning',
            impactAmount: lost,
            message: `${r.name} vende ${Math.abs(r.deltaPct).toFixed(2)} % menos que el periodo comparado (${money(lost)}).`,
            action: { label: 'Ver sucursales', route: '/reporteria' },
        });
    }
    return out;
}

/**
 * Rule 3 - opportunity: the weekday x hour slot with scheduled staff and sales below 40 % of that
 * day's average. Impact = (day average - slot sales) x occurrences x gross margin. The slot with the
 * largest impact is reported.
 */
export function opportunityInsight(input: {
    heatmap: BiHeatmap; occurrences: Record<Weekday, number>; staffed: Set<string>; grossMarginPct: number;
}): Insight | null {
    let best: { weekday: number; label: string; hour: number; value: number; avg: number; impact: number } | null = null;
    for (const d of input.heatmap.days) {
        const avg = d.values.reduce((a, b) => a + b, 0) / Math.max(input.heatmap.hours.length, 1);
        if (!(avg > 0)) continue;
        d.values.forEach((value, i) => {
            const hour = input.heatmap.hours[i];
            if (!input.staffed.has(`${d.weekday}-${hour}`) || !(value < avg * 0.4)) return;
            const impact = (avg - value) * input.occurrences[d.weekday] * (input.grossMarginPct / 100);
            if (impact > 0 && (!best || impact > best.impact)) best = { weekday: d.weekday, label: d.label, hour, value, avg, impact };
        });
    }
    if (!best) return null;
    const b = best as { weekday: number; label: string; hour: number; value: number; avg: number; impact: number };
    return {
        id: `opportunity-${b.weekday}-${b.hour}`,
        kind: 'opportunity',
        severity: 'success',
        impactAmount: round2(b.impact),
        message: `${b.label} ${String(b.hour).padStart(2, '0')}:00 vende ${money(b.value)} frente a ${money(b.avg)} de promedio del día y tiene personal programado.`,
        action: { label: 'Ajustar horarios', route: '/rh/horarios' },
    };
}

/** Rule 4 - channel: delivery share up more than 2 pts. Impact = delta share x sales x (dine-in margin - delivery margin). */
export function channelInsight(input: {
    curDeliverySharePct: number; prevDeliverySharePct: number; netSales: number;
    dineInMarginPct: number | null; deliveryMarginPct: number | null;
}): Insight | null {
    const delta = input.curDeliverySharePct - input.prevDeliverySharePct;
    if (!(delta > 2) || input.dineInMarginPct == null || input.deliveryMarginPct == null) return null;
    const marginGap = (input.dineInMarginPct - input.deliveryMarginPct) / 100;
    const impact = round2((delta / 100) * input.netSales * marginGap);
    if (!(impact > 0)) return null;
    return {
        id: 'channel-delivery',
        kind: 'channel',
        severity: 'warning',
        impactAmount: impact,
        message: `El delivery subió ${delta.toFixed(2)} pts de participación y deja menos margen que el salón (${money(impact)}).`,
        action: { label: 'Ver canales', route: '/reporteria' },
    };
}

export function rankInsights(list: Insight[]): Insight[] {
    return [...list].sort((a, b) => Math.abs(b.impactAmount) - Math.abs(a.impactAmount)).slice(0, MAX_INSIGHTS);
}

// ---- Data for the rules ------------------------------------------------------

/** Weighted net margin of a channel group; null when the group has no sales. */
function groupMargin(rows: ChannelRow[], pick: (c: string) => boolean): { sharePct: number; marginPct: number | null } {
    const g = rows.filter((r) => pick(r.channel));
    const sales = g.reduce((s, r) => s + r.netSales, 0);
    const share = g.reduce((s, r) => s + r.sharePct, 0);
    return { sharePct: share, marginPct: sales > 0 ? g.reduce((s, r) => s + r.netMarginPct * r.netSales, 0) / sales : null };
}

/** Theoretical cost per supply of everything sold in [from, to), converted to base units. */
async function loadTheoreticalBySupply(
    q: BiQuery, facts: BiFacts, from: Date, to: Date,
): Promise<{ theoretical: Map<number, number>; names: Map<number, string> }> {
    const sold = new Map<number, number>();
    for (const o of facts.orders) {
        if (o.at.getTime() < from.getTime() || o.at.getTime() >= to.getTime()) continue;
        for (const i of o.items) sold.set(i.menuItemId, (sold.get(i.menuItemId) ?? 0) + i.quantity);
    }
    const theoretical = new Map<number, number>();
    const names = new Map<number, string>();
    if (sold.size === 0) return { theoretical, names };
    const items = await prisma.menuItem.findMany({
        where: { id: { in: [...sold.keys()] }, companyId: q.companyId },
        select: {
            id: true,
            recipes: {
                select: {
                    quantity: true, unit: true,
                    product: { select: { id: true, name: true, unit: true, currentAverageCost: true, cost: true } },
                },
            },
        },
    });
    for (const mi of items) {
        const units = sold.get(mi.id) ?? 0;
        for (const r of mi.recipes) {
            try {
                const base = (await UnitConversionService.convert(
                    r.product.id, q.companyId, Number(r.quantity), r.unit || r.product.unit,
                )).baseQuantity;
                const cost = base * effectiveUnitCost(r.product.currentAverageCost, r.product.cost) * units;
                theoretical.set(r.product.id, (theoretical.get(r.product.id) ?? 0) + cost);
                names.set(r.product.id, r.product.name);
            } catch {
                // An unconvertible line only drops out of the per-supply variance; the gap rule already
                // requires a complete theoretical cost.
            }
        }
    }
    return { theoretical, names };
}

/** Local weekday-hour slots covered by published, non-cancelled scheduled shifts. */
async function loadStaffedSlots(q: BiQuery, range: BiRange): Promise<Set<string>> {
    const shifts = await prisma.scheduledShift.findMany({
        where: {
            companyId: q.companyId,
            status: 'SCHEDULED',
            schedule: { is: { status: 'PUBLISHED' } },
            startAt: { lt: range.to },
            endAt: { gt: range.from },
            ...(q.branchIds.length > 0 ? { branchId: { in: q.branchIds } } : {}),
        },
        select: { startAt: true, endAt: true },
    });
    const slots = new Set<string>();
    for (const s of shifts) {
        for (let t = s.startAt.getTime(); t < s.endAt.getTime(); t += 3_600_000) {
            const p = getZonedParts(new Date(t), range.timezone);
            slots.add(`${isoWeekday(p.year, p.month, p.day)}-${p.hour}`);
        }
    }
    return slots;
}

/** Up to 5 findings ordered by |impact| in C$. Rules whose data is unavailable are silently skipped. */
export async function getBiInsights(q: BiQuery, now: Date = new Date()): Promise<Insight[]> {
    const timezone = await SettingService.getTimezone(q.companyId);
    const range = resolveBiRange(q, now, timezone);
    const ctx = await loadBiContext(q, timezone, range);
    const fixed = ctx.goals.fixedMonthlyExpenses;
    const t = totalsInInterval(ctx.cur, range.from, range.to, fixed, timezone);

    const [branches, staffed, supply] = await Promise.all([
        loadBranchDetails(q, range, timezone, ctx.recipeCache),
        loadStaffedSlots(q, range),
        loadTheoreticalBySupply(q, ctx.cur, range.from, range.to),
    ]);

    const real = new Map<number, number>();
    for (const c of ctx.cur.costs) {
        if (c.productId == null || c.at.getTime() < range.from.getTime() || c.at.getTime() >= range.to.getTime()) continue;
        real.set(c.productId, (real.get(c.productId) ?? 0) + c.amount);
    }

    const curChannels = channelBreakdown(ctx.cur, range.from, range.to);
    const prevChannels = channelBreakdown(ctx.prev, range.cmpFrom, range.cmpTo);
    const curDelivery = groupMargin(curChannels, (c) => DELIVERY_CHANNELS.has(c));
    const prevDelivery = groupMargin(prevChannels, (c) => DELIVERY_CHANNELS.has(c));
    const dineIn = groupMargin(curChannels, (c) => !DELIVERY_CHANNELS.has(c));

    const found: (Insight | null)[] = [
        costInsight({
            realPct: t.foodCostRealPct, theoreticalPct: t.foodCostTheoreticalPct, goalGapPts: ctx.goals.foodCostGapPts,
            netSales: t.netSales, quality: t.theoreticalQuality,
            topSupply: topVarianceSupply(real, supply.theoretical, supply.names),
        }),
        ...branchInsights(branches),
        opportunityInsight({
            heatmap: buildHeatmap(ctx.cur, range), occurrences: weekdayOccurrences(range), staffed,
            grossMarginPct: t.grossMarginPct,
        }),
        channelInsight({
            curDeliverySharePct: curDelivery.sharePct, prevDeliverySharePct: prevDelivery.sharePct, netSales: t.netSales,
            dineInMarginPct: dineIn.marginPct, deliveryMarginPct: curDelivery.marginPct,
        }),
    ];
    return rankInsights(found.filter((i): i is Insight => i != null));
}
