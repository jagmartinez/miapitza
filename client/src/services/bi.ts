import api from './api';
import type { BiQuality, BridgeStep, Insight } from '@/ui/charts/types';

export type { BiQuality, BridgeStep, Insight };

export type BiPeriod = 'today' | '7d' | '30d' | '12m' | 'custom';
export type BiCompare = 'previous' | 'year';
export type BiTrendMetric = 'netSales' | 'grossMargin' | 'orders' | 'avgTicket';
export type TrafficLight = 'ok' | 'warn' | 'bad';

/** Filtros comunes de todas las rutas `/api/v1/bi/*`. */
export interface BiParams {
    period: BiPeriod;
    compare: BiCompare;
    branchIds: number[];
    from?: string;
    to?: string;
}

export interface Money { current: number; previous: number; deltaPct: number | null }

export interface BiSummary {
    netSales: Money; grossSales: Money; discounts: Money; orders: Money; avgTicket: Money;
    grossMarginPct: Money; foodCostRealPct: Money; foodCostTheoreticalPct: Money;
    /** Costo real menos teórico; null cuando hay platos con receta N/D. */
    foodCostGapAmount: number | null;
    laborCostPct: Money; operatingProfit: Money; operatingMarginPct: Money;
    goals: {
        monthlySales: number; periodSales: number; avgTicket: number; foodCostPct: number; foodCostGapPts: number;
        grossMarginPct: number; laborCostMaxPct: number; operatingMarginPct: number;
    };
    spark: Record<'netSales' | 'grossMarginPct' | 'avgTicket' | 'laborCostPct' | 'operatingProfit', number[]> & {
        foodCostGapPts: (number | null)[];
    };
    dataQuality: { labor: BiQuality; theoreticalCost: BiQuality; laborCoverage: number };
    warnings: string[];
}

export interface BiTrend { buckets: string[]; current: number[]; previous: number[]; goal: number | null }

export interface ChannelRow {
    channel: string; label: string; netSales: number; sharePct: number; netMarginPct: number; avgTicket: number;
}

export interface BiHeatmap {
    hours: number[];
    days: { weekday: number; label: string; values: number[] }[];
    peak: { weekday: number; hour: number };
    valley: { weekday: number; hour: number };
}

export interface BiPareto {
    items: { menuItemId: number; name: string; margin: number; cumulativePct: number }[];
    itemsFor80Pct: number;
    totalItems: number;
    unavailableItems: number;
}

export interface BranchRow {
    branchId: number; name: string; netSales: number; deltaPct: number | null; spark: number[]; avgTicket: number;
    foodCostPct: number;
    laborCostPct: number | null;
    operatingMarginPct: number | null;
    salesPerSqm: number | null;
    laborQuality: BiQuality;
    status: { foodCost: TrafficLight; labor: TrafficLight | 'nd' };
}

function toQuery(p: BiParams, extra: Record<string, string | number> = {}): Record<string, string | number> {
    const out: Record<string, string | number> = { period: p.period, compare: p.compare, ...extra };
    if (p.branchIds.length > 0) out.branchIds = p.branchIds.join(',');
    if (p.period === 'custom') {
        if (p.from) out.from = p.from;
        if (p.to) out.to = p.to;
    }
    return out;
}

async function get<T>(route: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
    const res = await api.get(`/v1/bi/${route}`, { params, signal });
    return res.data.data as T;
}

export const biAPI = {
    summary: (p: BiParams, signal?: AbortSignal) => get<BiSummary>('summary', toQuery(p), signal),
    trend: (p: BiParams, metric: BiTrendMetric, signal?: AbortSignal) => get<BiTrend>('trend', toQuery(p, { metric }), signal),
    bridge: (p: BiParams, signal?: AbortSignal) => get<BridgeStep[]>('bridge', toQuery(p), signal),
    channels: (p: BiParams, signal?: AbortSignal) => get<ChannelRow[]>('channels', toQuery(p), signal),
    heatmap: (p: BiParams, signal?: AbortSignal) => get<BiHeatmap>('heatmap', toQuery(p), signal),
    pareto: (p: BiParams, limit = 10, signal?: AbortSignal) => get<BiPareto>('pareto', toQuery(p, { limit }), signal),
    branches: (p: BiParams, signal?: AbortSignal) => get<BranchRow[]>('branches', toQuery(p), signal),
    insights: (p: BiParams, signal?: AbortSignal) => get<Insight[]>('insights', toQuery(p), signal),
};
