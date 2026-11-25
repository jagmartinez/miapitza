import { SettingService } from '../setting.service';
import { bucketBounds, type BiQuality, loadBiFacts, loadGoals, monthlyInInterval, round2, totalsInInterval, type BiTotals } from './bi-common';
import { resolveBiRange, type BiQuery } from './bi-range';

export interface Money { current: number; previous: number; deltaPct: number | null }   // null si previous = 0

export interface BiSummary {
    netSales: Money; grossSales: Money; discounts: Money; orders: Money; avgTicket: Money;
    grossMarginPct: Money; foodCostRealPct: Money; foodCostTheoreticalPct: Money;
    /** Real minus theoretical cost; null when dishes with N/D recipes make the comparison partial. */
    foodCostGapAmount: number | null;
    laborCostPct: Money; operatingProfit: Money; operatingMarginPct: Money;
    goals: {
        monthlySales: number; periodSales: number; avgTicket: number; foodCostPct: number; foodCostGapPts: number;
        grossMarginPct: number; laborCostMaxPct: number; operatingMarginPct: number;
    };
    spark: Record<'netSales' | 'grossMarginPct' | 'avgTicket' | 'laborCostPct' | 'operatingProfit', number[]> & {
        /** null for buckets whose gap is not comparable (N/D recipes sold). */
        foodCostGapPts: (number | null)[];
    };
    /**
     * Machine-readable data quality of the current range. Where it is not 'complete' the client
     * shows N/D (or a partial label): labor drives laborCostPct/operatingProfit/operatingMarginPct;
     * theoreticalCost drives foodCostTheoreticalPct and the food cost gap.
     */
    dataQuality: { labor: BiQuality; theoreticalCost: BiQuality; laborCoverage: number };
    /** Data-quality notices: values that could not be computed are excluded, never shown as 0. */
    warnings: string[];
}

function money(current: number, previous: number): Money {
    return {
        current: round2(current),
        previous: round2(previous),
        deltaPct: previous === 0 ? null : round2(((current - previous) / Math.abs(previous)) * 100),
    };
}

export async function getBiSummary(q: BiQuery, now: Date = new Date()): Promise<BiSummary> {
    const timezone = await SettingService.getTimezone(q.companyId);
    const range = resolveBiRange(q, now, timezone);
    const recipeCache = new Map<number, number | null>();

    const [goals, cur, prev] = await Promise.all([
        loadGoals(q.companyId, q.branchIds),
        loadBiFacts(q, range.from, range.to, timezone, recipeCache),
        loadBiFacts(q, range.cmpFrom, range.cmpTo, timezone, recipeCache),
    ]);

    const fixed = goals.fixedMonthlyExpenses;
    const t: BiTotals = totalsInInterval(cur, range.from, range.to, fixed, timezone);
    const p: BiTotals = totalsInInterval(prev, range.cmpFrom, range.cmpTo, fixed, timezone);

    const bounds = bucketBounds(range);
    const series = bounds.map((b) => totalsInInterval(cur, b.start, b.end, fixed, timezone));
    const gapPts = (x: BiTotals): number | null =>
        x.theoreticalQuality === 'complete' ? round2(x.foodCostRealPct - x.foodCostTheoreticalPct) : null;
    const laborQuality: BiQuality = t.laborCoverage < 0.001 ? 'unavailable' : t.laborCoverage < 0.999 ? 'partial' : 'complete';

    const warnings: string[] = [];
    const unavailableRecipes = [...recipeCache.values()].filter((v) => v == null).length;
    if (unavailableRecipes > 0) {
        warnings.push(`Costo teórico no disponible para ${unavailableRecipes} platillo(s) con unidad de receta sin conversión; se excluyen del costo teórico y de su base de venta; la brecha de food cost no es comparable.`);
    }
    const noCost = cur.movementsWithoutCost + prev.movementsWithoutCost;
    if (noCost > 0) {
        warnings.push(`${noCost} movimiento(s) de inventario sin costo histórico se excluyen del costo real.`);
    }
    if (laborQuality === 'unavailable') {
        warnings.push('No hay nómina aprobada que cubra el periodo: el costo de personal no está disponible y la utilidad operativa no lo incluye.');
    } else if (laborQuality === 'partial') {
        warnings.push(`La nómina aprobada cubre solo el ${Math.round(t.laborCoverage * 100)}% del periodo: el costo de personal y la utilidad operativa están incompletos.`);
    }

    return {
        netSales: money(t.netSales, p.netSales),
        grossSales: money(t.grossSales, p.grossSales),
        discounts: money(t.discounts, p.discounts),
        orders: money(t.orders, p.orders),
        avgTicket: money(t.avgTicket, p.avgTicket),
        grossMarginPct: money(t.grossMarginPct, p.grossMarginPct),
        foodCostRealPct: money(t.foodCostRealPct, p.foodCostRealPct),
        foodCostTheoreticalPct: money(t.foodCostTheoreticalPct, p.foodCostTheoreticalPct),
        // Waste and over-portioning: real cost minus theoretical cost of what was sold.
        foodCostGapAmount: t.theoreticalQuality === 'complete' ? round2(t.costReal - t.costTheoretical) : null,
        laborCostPct: money(t.laborCostPct, p.laborCostPct),
        operatingProfit: money(t.operatingProfit, p.operatingProfit),
        operatingMarginPct: money(t.operatingMarginPct, p.operatingMarginPct),
        goals: {
            monthlySales: goals.monthlySales,
            // Monthly goal prorated by time over the (possibly multi-month) range.
            periodSales: round2(monthlyInInterval(goals.monthlySales, range.from, range.to, timezone)),
            avgTicket: goals.avgTicket,
            foodCostPct: goals.foodCostPct,
            foodCostGapPts: goals.foodCostGapPts,
            grossMarginPct: goals.grossMarginPct,
            laborCostMaxPct: goals.laborCostMaxPct,
            operatingMarginPct: goals.operatingMarginPct,
        },
        spark: {
            netSales: series.map((x) => x.netSales),
            grossMarginPct: series.map((x) => x.grossMarginPct),
            foodCostGapPts: series.map(gapPts),
            avgTicket: series.map((x) => x.avgTicket),
            laborCostPct: series.map((x) => x.laborCostPct),
            operatingProfit: series.map((x) => x.operatingProfit),
        },
        dataQuality: { labor: laborQuality, theoreticalCost: t.theoreticalQuality, laborCoverage: round2(t.laborCoverage) },
        warnings,
    };
}
