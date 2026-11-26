import type { NextFunction, Request, Response } from 'express';
import { getErrorMessage } from '../utils/error';
import { BranchScopeError, isCompanyWide } from '../utils/branch-scope';
import type { BiCompare, BiPeriod, BiQuery } from '../services/bi/bi-range';
import { getBiSummary } from '../services/bi/bi-summary.service';
import { getBiTrend, type BiTrendMetric } from '../services/bi/bi-trend.service';
import { getBiBridge, getBiChannels } from '../services/bi/bi-pnl.service';
import { getBiHeatmap, getBiPareto } from '../services/bi/bi-patterns.service';
import { getBiBranches, getBiInsights } from '../services/bi/bi-insights.service';

const PERIODS: BiPeriod[] = ['today', '7d', '30d', '12m', 'custom'];
const COMPARES: BiCompare[] = ['previous', 'year'];
const METRICS: BiTrendMetric[] = ['netSales', 'grossMargin', 'orders', 'avgTicket'];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;

class BiRequestError extends Error {
    constructor(public statusCode: number, message: string) {
        super(message);
        this.name = 'BiRequestError';
    }
}

type ReqUser = NonNullable<Request['user']>;

/**
 * Branch scope of a BI request. Company-wide admins may query any subset (empty = all branches);
 * every other user is pinned to their active branch and asking for another one is a 403: data of
 * different branches is never mixed.
 */
export function resolveBiBranchIds(user: ReqUser, requested: number[]): number[] {
    if (isCompanyWide(user)) return requested;
    if (!user.branchId) {
        throw new BranchScopeError('Su usuario no tiene una sucursal activa asignada. Contacte al administrador.');
    }
    if (requested.some((id) => id !== user.branchId)) {
        throw new BranchScopeError('No autorizado para consultar otra sucursal');
    }
    return [user.branchId];
}

function parseBranchIds(value: unknown): number[] {
    if (value == null || value === '') return [];
    if (typeof value !== 'string') throw new BiRequestError(400, 'branchIds inválido');
    const ids = value.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
    if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new BiRequestError(400, 'branchIds inválido');
    return [...new Set(ids)].sort((a, b) => a - b);
}

/** Validates the common query (`period, from, to, compare, branchIds`) and applies the user scope. */
export function parseBiQuery(req: Request): BiQuery {
    const period = (req.query.period ?? '30d') as BiPeriod;
    if (!PERIODS.includes(period)) throw new BiRequestError(400, 'Periodo inválido');
    const compare = (req.query.compare ?? 'previous') as BiCompare;
    if (!COMPARES.includes(compare)) throw new BiRequestError(400, 'Comparación inválida');

    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (period === 'custom') {
        if (!from || !DATE_ONLY.test(from) || (to != null && !DATE_ONLY.test(to))) {
            throw new BiRequestError(400, 'El periodo personalizado requiere fechas from/to en formato YYYY-MM-DD');
        }
    }
    return {
        companyId: req.user!.companyId,
        branchIds: resolveBiBranchIds(req.user!, parseBranchIds(req.query.branchIds)),
        period,
        ...(period === 'custom' ? { from, to: to ?? from } : {}),
        compare,
    };
}

// ---- 60 s in-memory cache ------------------------------------------------------

const cache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

export function clearBiCache(): void {
    cache.clear();
}

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value as Promise<T>;
    if (cache.size >= CACHE_MAX_ENTRIES) {
        for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
        if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    }
    const value = load();
    cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
    // A failed load must not be served again from the cache.
    value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
    return value;
}

function cacheKey(q: BiQuery, route: string, extra: Record<string, unknown> = {}): string {
    return JSON.stringify([q.companyId, route, q.period, q.from ?? null, q.to ?? null, q.compare, [...q.branchIds].sort((a, b) => a - b), extra]);
}

function handler(route: string, run: (q: BiQuery, req: Request) => { extra?: Record<string, unknown>; load: () => Promise<unknown> }) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const q = parseBiQuery(req);
            const { extra, load } = run(q, req);
            const data = await cached(cacheKey(q, route, extra), load);
            res.json({ success: true, data });
        } catch (error: unknown) {
            if (error instanceof BiRequestError || error instanceof BranchScopeError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            // Invalid dates / ranges thrown by resolveBiRange.
            if (error instanceof RangeError) return res.status(400).json({ success: false, message: error.message });
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    };
}

export class BiController {
    static summary = handler('summary', (q) => ({ load: () => getBiSummary(q) }));

    static trend = handler('trend', (q, req) => {
        const metric = (req.query.metric ?? 'netSales') as BiTrendMetric;
        if (!METRICS.includes(metric)) throw new BiRequestError(400, 'Métrica inválida');
        return { extra: { metric }, load: () => getBiTrend(q, metric) };
    });

    static bridge = handler('bridge', (q) => ({ load: () => getBiBridge(q) }));
    static channels = handler('channels', (q) => ({ load: () => getBiChannels(q) }));
    static heatmap = handler('heatmap', (q) => ({ load: () => getBiHeatmap(q) }));

    static pareto = handler('pareto', (q, req) => {
        const raw = req.query.limit == null ? 10 : Number(req.query.limit);
        if (!Number.isInteger(raw) || raw < 1 || raw > 50) throw new BiRequestError(400, 'limit debe estar entre 1 y 50');
        return { extra: { limit: raw }, load: () => getBiPareto(q, raw) };
    });

    static branches = handler('branches', (q) => ({ load: () => getBiBranches(q) }));
    static insights = handler('insights', (q) => ({ load: () => getBiInsights(q) }));
}
