import prisma from '../../utils/prisma';
import { effectiveUnitCost } from '../../utils/product-cost';
import { zonedDateTimeToUtc, getZonedParts } from '../../utils/timezone';
import { UnitConversionService } from '../unit-conversion.service';
import { SettingsScopeService } from '../settings-scope.service';
import { fiscalGrossWhere } from '../report.service';
import { buckets, type BiQuery, type BiRange } from './bi-range';

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
/** Percentage that never yields NaN/Infinity: 0 when the denominator is 0. */
export const pct = (part: number, whole: number): number => (whole > 0 ? round2((part / whole) * 100) : 0);

export interface BiOrderFact {
    at: Date;
    branchId: number;
    total: number;
    discount: number;
    commission: number;
    channel: string;
    items: { menuItemId: number; quantity: number; subtotal: number }[];
}
export interface BiCreditFact { at: Date; branchId: number; total: number; channel?: string }
export interface BiCostFact { at: Date; amount: number; kind: 'consumption' | 'waste'; productId?: number | null }
export interface BiCashOutFact { at: Date; amount: number }
export interface BiPayrollFact { start: Date; end: Date; amount: number }

/** Raw facts of one window [from, to). `end` of every interval is exclusive. */
export interface BiFacts {
    orders: BiOrderFact[];
    credits: BiCreditFact[];
    costs: BiCostFact[];
    cashOuts: BiCashOutFact[];
    payroll: BiPayrollFact[];
    /** menuItemId -> cost per portion; null when a recipe cannot be converted (N/D). */
    recipeCost: Map<number, number | null>;
    /** Movements without historical cost: excluded from the real cost and reported. */
    movementsWithoutCost: number;
}

export type RecipeCostCache = Map<number, number | null>;

const inScope = (branchIds: number[]) => (branchIds.length > 0 ? { in: branchIds } : undefined);
const dec = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Cost per portion by menu item. A recipe with an unconvertible unit is N/D (null), never 0. */
async function loadRecipeCosts(companyId: number, ids: number[], cache: RecipeCostCache): Promise<void> {
    const missing = ids.filter((id) => !cache.has(id));
    if (missing.length === 0) return;
    const menuItems = await prisma.menuItem.findMany({
        where: { id: { in: missing }, companyId },
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
    for (const mi of menuItems) {
        let cost = 0;
        let ok = true;
        for (const r of mi.recipes) {
            try {
                const base = (await UnitConversionService.convert(
                    r.product.id, companyId, Number(r.quantity), r.unit || r.product.unit,
                )).baseQuantity;
                cost += base * effectiveUnitCost(r.product.currentAverageCost, r.product.cost);
            } catch {
                ok = false;
                break;
            }
        }
        cache.set(mi.id, ok ? cost : null);
    }
    for (const id of missing) if (!cache.has(id)) cache.set(id, null);
}

function localDateOnly(date: Date, timezone: string): Date {
    const p = getZonedParts(date, timezone);
    return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

function dateColumnToLocalMidnight(d: Date, timezone: string): Date {
    return zonedDateTimeToUtc({
        year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
        hour: 0, minute: 0, second: 0,
    }, timezone);
}

export async function loadBiFacts(
    q: BiQuery, from: Date, to: Date, timezone: string, recipeCache: RecipeCostCache,
): Promise<BiFacts> {
    const { companyId, branchIds } = q;
    const branchWhere = inScope(branchIds);
    const closedAt = { gte: from, lt: to };

    const [orders, credits, movements, cashOuts, runs] = await Promise.all([
        prisma.order.findMany({
            where: {
                companyId,
                ...(branchWhere ? { branchId: branchWhere } : {}),
                ...fiscalGrossWhere(closedAt),
            },
            select: {
                closedAt: true, branchId: true, total: true, discount: true,
                channelCommission: true, salesChannel: true,
                items: { select: { menuItemId: true, quantity: true, subtotal: true } },
            },
        }),
        prisma.fiscalCreditNote.findMany({
            where: { companyId, ...(branchWhere ? { branchId: branchWhere } : {}), issuedAt: closedAt },
            select: { issuedAt: true, branchId: true, total: true, order: { select: { salesChannel: true } } },
        }),
        prisma.inventoryMovement.findMany({
            where: {
                companyId,
                createdAt: closedAt,
                ...(branchWhere ? { warehouse: { branchId: branchWhere } } : {}),
                OR: [
                    { type: 'OUT', reference: { startsWith: 'ORD-' } },
                    // Stock returned by a cancelled order or a RETURN_TO_STOCK credit note
                    // (IN / REVERSAL with an ORD- reference and no reversalOf link).
                    { type: 'IN', reference: { startsWith: 'ORD-' } },
                    { origin: 'REVERSAL', reference: { startsWith: 'ORD-' } },
                    { origin: 'WASTE' },
                    { reason: { startsWith: 'WASTE:' } },
                    {
                        origin: 'REVERSAL',
                        reversalOf: {
                            OR: [
                                { reference: { startsWith: 'ORD-' } },
                                { origin: 'WASTE' },
                                { reason: { startsWith: 'WASTE:' } },
                            ],
                        },
                    },
                ],
            },
            select: {
                createdAt: true, productId: true, type: true, quantity: true, unitCost: true, totalCost: true,
                origin: true, reason: true, reference: true, reversalOfId: true,
                reversalOf: { select: { origin: true, reason: true, reference: true } },
            },
        }),
        // Manual cash expenses: OUT movements that are not payment/refund ledger entries
        // (known prefixes below); a manual expense may carry a free-text reference.
        // Branch scope uses the warehouse branch: warehouses without branchId are left out
        // of the scoped real cost (company-wide queries include them).
        prisma.cashMovement.findMany({
            where: {
                type: 'OUT',
                OR: [
                    { reference: null },
                    { reference: '' },
                    {
                        NOT: [
                            { reference: { startsWith: 'PAY-' } }, { reference: { startsWith: 'REV-PAY-' } },
                            { reference: { startsWith: 'CAT-PAY-' } }, { reference: { startsWith: 'REV-CAT-PAY-' } },
                        ],
                    },
                ],
                createdAt: closedAt,
                shift: { companyId, ...(branchWhere ? { cashRegister: { branchId: branchWhere } } : {}) },
            },
            select: { createdAt: true, amount: true },
        }),
        loadPayrollRuns(q, from, to, timezone),
    ]);

    const orderFacts: BiOrderFact[] = orders.map((o) => ({
        at: o.closedAt as Date,
        branchId: o.branchId,
        total: dec(o.total),
        discount: dec(o.discount),
        commission: dec(o.channelCommission),
        channel: String(o.salesChannel),
        items: (o.items ?? []).map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity, subtotal: dec(i.subtotal) })),
    }));

    const itemIds = [...new Set(orderFacts.flatMap((o) => o.items.map((i) => i.menuItemId)))];
    await loadRecipeCosts(companyId, itemIds, recipeCache);

    let movementsWithoutCost = 0;
    const costs: BiCostFact[] = [];
    for (const m of movements) {
        const source = m.reversalOfId != null ? m.reversalOf : m;
        const isWaste = source?.origin === 'WASTE' || (source?.reason ?? '').startsWith('WASTE:');
        // Returns to stock subtract, whether linked through reversalOf or only by ORD- reference.
        const returned = m.reversalOfId != null || (m.type === 'IN' && !isWaste);
        const total = m.totalCost == null ? null : Number(m.totalCost);
        const unit = m.unitCost == null ? null : Number(m.unitCost);
        let amount: number | null = null;
        if (total != null && Number.isFinite(total) && total >= 0) amount = total;
        else if (unit != null && Number.isFinite(unit) && unit >= 0) amount = Number(m.quantity) * unit;
        if (amount == null) { movementsWithoutCost += 1; continue; }
        costs.push({
            at: m.createdAt,
            amount: (returned ? -1 : 1) * amount,
            kind: isWaste ? 'waste' : 'consumption',
            productId: m.productId ?? null,
        });
    }

    return {
        orders: orderFacts,
        credits: credits.map((c) => ({
            at: c.issuedAt, branchId: c.branchId, total: dec(c.total),
            channel: c.order?.salesChannel ? String(c.order.salesChannel) : undefined,
        })),
        costs,
        cashOuts: cashOuts.map((c) => ({ at: c.createdAt, amount: dec(c.amount) })),
        payroll: runs,
        recipeCost: recipeCache,
        movementsWithoutCost,
    };
}

/**
 * Payroll cost of the runs whose period overlaps the window: accrued income plus
 * employer contributions. Branch-scoped queries take the share of the run's INCOME
 * components that belongs to employees assigned to the selected branches.
 */
async function loadPayrollRuns(q: BiQuery, from: Date, to: Date, timezone: string): Promise<BiPayrollFact[]> {
    const firstDay = localDateOnly(from, timezone);
    const lastDay = localDateOnly(new Date(to.getTime() - 1), timezone);
    const scoped = q.branchIds.length > 0;
    const runs = await prisma.payrollRun.findMany({
        where: {
            companyId: q.companyId,
            status: { in: ['APPROVED', 'PAID'] },
            period: { is: { dateFrom: { lte: lastDay }, dateTo: { gte: firstDay } } },
        },
        select: {
            grossIncome: true,
            employerContributions: true,
            period: { select: { dateFrom: true, dateTo: true } },
            ...(scoped ? {
                snapshots: { select: { userId: true, branchId: true } },
                components: { select: { userId: true, type: true, amount: true } },
            } : {}),
        },
    });

    const facts: BiPayrollFact[] = [];
    for (const run of runs as Array<{
        grossIncome: unknown; employerContributions: unknown;
        period: { dateFrom: Date; dateTo: Date } | null;
        snapshots?: { userId: number; branchId: number | null }[];
        components?: { userId: number; type: string; amount: unknown }[];
    }>) {
        if (!run.period) continue;
        let amount = dec(run.grossIncome) + dec(run.employerContributions);
        if (scoped) {
            const inBranch = new Set((run.snapshots ?? [])
                .filter((s) => s.branchId != null && q.branchIds.includes(s.branchId))
                .map((s) => s.userId));
            let all = 0;
            let mine = 0;
            for (const c of run.components ?? []) {
                if (c.type !== 'INCOME') continue;
                all += dec(c.amount);
                if (inBranch.has(c.userId)) mine += dec(c.amount);
            }
            const share = all > 0
                ? mine / all
                : ((run.snapshots?.length ?? 0) > 0 ? inBranch.size / run.snapshots!.length : 0);
            amount *= share;
        }
        const start = dateColumnToLocalMidnight(run.period.dateFrom, timezone);
        const lastDayOfPeriod = dateColumnToLocalMidnight(run.period.dateTo, timezone);
        const end = zonedDateTimeToUtc({
            ...getZonedParts(new Date(lastDayOfPeriod.getTime() + 36 * 3_600_000), timezone),
            hour: 0, minute: 0, second: 0,
        }, timezone);
        facts.push({ start, end, amount });
    }
    return facts;
}

// ---- Interval maths -------------------------------------------------------

const overlapMs = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number =>
    Math.max(0, Math.min(aEnd.getTime(), bEnd.getTime()) - Math.max(aStart.getTime(), bStart.getTime()));

/** Payroll cost attributable to [s, e), prorated by time over each run's period. */
export function payrollInInterval(facts: BiFacts, s: Date, e: Date): number {
    let sum = 0;
    for (const p of facts.payroll) {
        const len = p.end.getTime() - p.start.getTime();
        if (len > 0) sum += p.amount * (overlapMs(s, e, p.start, p.end) / len);
    }
    return sum;
}

/** Share (0..1) of [s, e) covered by the union of payroll run periods. */
export function payrollCoverage(facts: BiFacts, s: Date, e: Date): number {
    const total = e.getTime() - s.getTime();
    if (total <= 0) return 0;
    const spans = facts.payroll
        .map((p) => [Math.max(p.start.getTime(), s.getTime()), Math.min(p.end.getTime(), e.getTime())] as const)
        .filter(([a, b]) => b > a)
        .sort((x, y) => x[0] - y[0]);
    let covered = 0;
    let curEnd = -Infinity;
    for (const [a, b] of spans) {
        const start = Math.max(a, curEnd);
        if (b > start) covered += b - start;
        curEnd = Math.max(curEnd, b);
    }
    return Math.min(1, covered / total);
}

/** Prorates a monthly amount over [s, e) walking the local calendar months. */
export function monthlyInInterval(monthly: number, s: Date, e: Date, timezone: string): number {
    if (!(monthly > 0) || e.getTime() <= s.getTime()) return 0;
    const first = getZonedParts(s, timezone);
    let year = first.year;
    let month = first.month;
    let sum = 0;
    for (let guard = 0; guard < 1200; guard += 1) {
        const mStart = zonedDateTimeToUtc({ year, month, day: 1, hour: 0, minute: 0, second: 0 }, timezone);
        if (mStart.getTime() >= e.getTime()) break;
        const ny = month === 12 ? year + 1 : year;
        const nm = month === 12 ? 1 : month + 1;
        const mEnd = zonedDateTimeToUtc({ year: ny, month: nm, day: 1, hour: 0, minute: 0, second: 0 }, timezone);
        sum += monthly * (overlapMs(s, e, mStart, mEnd) / (mEnd.getTime() - mStart.getTime()));
        year = ny;
        month = nm;
    }
    return sum;
}

export interface BiBucketBound { key: string; start: Date; end: Date }

function keyStart(key: string, timezone: string): Date {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:T(\d{2}))?$/.exec(key)!;
    return zonedDateTimeToUtc({
        year: Number(m[1]), month: Number(m[2]), day: m[3] ? Number(m[3]) : 1,
        hour: m[4] ? Number(m[4]) : 0, minute: 0, second: 0,
    }, timezone);
}

/** Bucket keys with their [start, end) instants, clipped to the range. */
export function bucketBounds(range: BiRange): BiBucketBound[] {
    const keys = buckets(range);
    return keys.map((key, i) => ({
        key,
        start: i === 0 ? range.from : keyStart(key, range.timezone),
        end: i === keys.length - 1 ? range.to : keyStart(keys[i + 1], range.timezone),
    }));
}

// ---- Goals ---------------------------------------------------------------

export interface BiGoalSet {
    monthlySales: number; avgTicket: number; foodCostPct: number; foodCostGapPts: number;
    grossMarginPct: number; laborCostMaxPct: number; operatingMarginPct: number; fixedMonthlyExpenses: number;
}

const SUM_KEYS = new Set(['monthlySales', 'fixedMonthlyExpenses']);
const GOAL_KEYS: Record<keyof BiGoalSet, string> = {
    monthlySales: 'goal.monthlySales', avgTicket: 'goal.avgTicket', foodCostPct: 'goal.foodCostPct',
    foodCostGapPts: 'goal.foodCostGapPts', grossMarginPct: 'goal.grossMarginPct',
    laborCostMaxPct: 'goal.laborCostMaxPct', operatingMarginPct: 'goal.operatingMarginPct',
    fixedMonthlyExpenses: 'finance.fixedMonthlyExpenses',
};

/** Goals of one scope: a branch (its override or the company value) or the company. */
export async function loadGoalsForScope(companyId: number, branchId: number | null): Promise<BiGoalSet> {
    const out = {} as BiGoalSet;
    for (const k of Object.keys(GOAL_KEYS) as (keyof BiGoalSet)[]) {
        out[k] = await SettingsScopeService.getNumber(companyId, branchId, GOAL_KEYS[k]);
    }
    return out;
}

/** Amounts add up across the selected branches; ratios and ticket are averaged. */
export async function loadGoals(companyId: number, branchIds: number[]): Promise<BiGoalSet> {
    const scopes: (number | null)[] = branchIds.length > 0 ? branchIds : [null];
    const sets = await Promise.all(scopes.map((b) => loadGoalsForScope(companyId, b)));
    const out = {} as BiGoalSet;
    for (const k of Object.keys(GOAL_KEYS) as (keyof BiGoalSet)[]) {
        const total = sets.reduce((s, g) => s + g[k], 0);
        out[k] = SUM_KEYS.has(k) ? total : total / sets.length;
    }
    return out;
}

// ---- Aggregation ---------------------------------------------------------

export interface BiTotals {
    netSales: number; grossSales: number; discounts: number; orders: number; avgTicket: number;
    costReal: number; costTheoretical: number; commissions: number; labor: number; opex: number;
    grossMarginPct: number; foodCostRealPct: number; foodCostTheoreticalPct: number;
    laborCostPct: number; operatingProfit: number; operatingMarginPct: number;
    /** Share (0..1) of the interval covered by approved/paid payroll runs. */
    laborCoverage: number;
    /** Net-sales basis of the theoretical %: excludes dishes with an N/D recipe. */
    theoreticalSalesBasis: number;
    /** Sales of dishes whose recipe cost is N/D (excluded from the theoretical cost). */
    unavailableRecipeSales: number;
    theoreticalQuality: BiQuality;
}
export type BiQuality = 'complete' | 'partial' | 'unavailable';

/**
 * Definitions (see plan "Global Constraints"):
 * - net sales = sum(Order.total) - credit notes; gross = net + sum(Order.discount)
 * - theoretical cost = units sold x recipe cost per portion (N/D dishes are excluded together
 *   with their sales from the theoretical % basis; the gap is then partial)
 * - real cost = sale-consumption movements + registered waste (reversals subtract)
 * - operating profit = net - real cost - payroll - operating expenses - channel commissions
 */
export function totalsInInterval(
    facts: BiFacts, s: Date, e: Date, fixedMonthly: number, timezone: string,
): BiTotals {
    const within = (d: Date) => d.getTime() >= s.getTime() && d.getTime() < e.getTime();
    const orders = facts.orders.filter((o) => within(o.at));
    const credits = facts.credits.filter((c) => within(c.at));

    const orderSales = orders.reduce((a, o) => a + o.total, 0);
    const creditTotal = credits.reduce((a, c) => a + c.total, 0);
    const discounts = orders.reduce((a, o) => a + o.discount, 0);
    const netSales = orderSales - creditTotal;
    const grossSales = netSales + discounts;
    const orderCount = orders.length;
    const commissions = orders.reduce((a, o) => a + o.commission, 0);

    let costTheoretical = 0;
    let unavailableRecipeSales = 0;
    let costedItems = 0;
    let unavailableItems = 0;
    for (const o of orders) {
        for (const i of o.items) {
            const c = facts.recipeCost.get(i.menuItemId);
            if (c != null) { costTheoretical += c * i.quantity; costedItems += 1; }
            else { unavailableRecipeSales += i.subtotal; unavailableItems += 1; }
        }
    }
    const theoreticalSalesBasis = Math.max(0, netSales - unavailableRecipeSales);
    const theoreticalQuality: BiQuality = unavailableItems === 0 ? 'complete' : costedItems > 0 ? 'partial' : 'unavailable';
    const costReal = facts.costs.filter((c) => within(c.at)).reduce((a, c) => a + c.amount, 0);
    const labor = payrollInInterval(facts, s, e);
    const opex = facts.cashOuts.filter((c) => within(c.at)).reduce((a, c) => a + c.amount, 0)
        + monthlyInInterval(fixedMonthly, s, e, timezone);
    const operatingProfit = netSales - costReal - labor - opex - commissions;

    return {
        netSales: round2(netSales), grossSales: round2(grossSales), discounts: round2(discounts),
        orders: orderCount, avgTicket: orderCount > 0 ? round2(netSales / orderCount) : 0,
        costReal: round2(costReal), costTheoretical: round2(costTheoretical),
        commissions: round2(commissions), labor: round2(labor), opex: round2(opex),
        grossMarginPct: netSales > 0 ? pct(netSales - costReal, netSales) : 0,
        foodCostRealPct: pct(costReal, netSales),
        foodCostTheoreticalPct: pct(costTheoretical, theoreticalSalesBasis),
        laborCostPct: pct(labor, netSales),
        operatingProfit: round2(operatingProfit),
        operatingMarginPct: netSales > 0 ? pct(operatingProfit, netSales) : 0,
        laborCoverage: payrollCoverage(facts, s, e),
        theoreticalSalesBasis: round2(theoreticalSalesBasis),
        unavailableRecipeSales: round2(unavailableRecipeSales),
        theoreticalQuality,
    };
}

// ---- Shared loader -------------------------------------------------------

export interface BiContext {
    timezone: string;
    range: BiRange;
    goals: BiGoalSet;
    cur: BiFacts;
    prev: BiFacts;
    recipeCache: RecipeCostCache;
}

/** Resolves the range and loads goals plus the facts of the current and comparison windows. */
export async function loadBiContext(q: BiQuery, timezone: string, range: BiRange): Promise<BiContext> {
    const recipeCache: RecipeCostCache = new Map();
    const [goals, cur, prev] = await Promise.all([
        loadGoals(q.companyId, q.branchIds),
        loadBiFacts(q, range.from, range.to, timezone, recipeCache),
        loadBiFacts(q, range.cmpFrom, range.cmpTo, timezone, recipeCache),
    ]);
    return { timezone, range, goals, cur, prev, recipeCache };
}
