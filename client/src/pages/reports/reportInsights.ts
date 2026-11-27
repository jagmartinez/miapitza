import { formatNumber } from '../../ui/format/number';
export interface InsightCol {
    key: string;
    header: string;
    format?: 'currency' | 'number' | 'percent' | 'date' | 'status';
    signColor?: boolean;
}
export type ReportRow = Record<string, unknown>;

const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/** Columnas cuya suma de la página es significativa (montos acumulables, no precios unitarios ni promedios). */
export function isAdditiveColumn(col: InsightCol): boolean {
    if (col.format !== 'currency' || col.signColor) return false;
    if (/^(total|amount|sales|revenue|spent|income|commission)/i.test(col.key)) return true;
    return !/unit|price|avg|average|prom|cost|margin|variation|variance/i.test(col.key);
}

/** Primera columna de texto (etiqueta de la fila) y primera de valor (monto, o número si no hay montos). */
export function pickChartColumns(cols: InsightCol[]): { label: InsightCol; value: InsightCol } | null {
    const label = cols.find((c) => !c.format);
    const value =
        cols.find((c) => c.format === 'currency' && !c.signColor) ?? cols.find((c) => c.format === 'number' && !c.signColor);
    return label && value ? { label, value } : null;
}

export interface ChartSeries {
    title: string;
    items: { name: string; value: number; cumulativePct: number }[];
    skipped: number;
}

type Point = { name: string; value: number };

function validPoints(items: ReportRow[], label: InsightCol, value: InsightCol): Point[] {
    return items
        .map((r) => ({ name: String(r[label.key] ?? ''), value: num(r[value.key]) }))
        .filter((r): r is Point => r.value !== null && r.name !== '');
}

/** Top N por valor con acumulado; las filas sin dato se excluyen y se cuentan en `skipped`, nunca se grafican como 0. */
export function buildChartSeries(items: ReportRow[], cols: InsightCol[], limit = 10): ChartSeries | null {
    const picked = pickChartColumns(cols);
    if (!picked || items.length < 2) return null;
    const rows = validPoints(items, picked.label, picked.value);
    if (rows.length < 2 || rows.some((r) => r.value < 0)) return null;
    const total = rows.reduce((s, r) => s + r.value, 0);
    if (total <= 0) return null;
    const top = [...rows].sort((a, b) => b.value - a.value).slice(0, limit);
    let acc = 0;
    return {
        title: `Top ${top.length} por ${picked.value.header}`,
        items: top.map((r) => {
            acc += r.value;
            return { ...r, cumulativePct: (acc / total) * 100 };
        }),
        skipped: items.length - rows.length,
    };
}

/** Lectura rápida: frases construidas solo con cifras del propio reporte. */
export function buildQuickRead(opts: {
    items: ReportRow[];
    cols: InsightCol[];
    format: (col: InsightCol, v: number) => string;
}): string[] {
    const { items, cols, format } = opts;
    const lines = [`El reporte tiene ${items.length} registro${items.length === 1 ? '' : 's'} con los filtros aplicados.`];
    const picked = pickChartColumns(cols);
    if (!picked) return lines;
    const valid = validPoints(items, picked.label, picked.value);
    const total = valid.reduce((s, r) => s + r.value, 0);
    if (valid.length > 0 && total > 0 && valid.every((r) => r.value >= 0)) {
        const best = valid.reduce((a, b) => (b.value > a.value ? b : a));
        lines.push(
            `${picked.label.header} con mayor ${picked.value.header.toLowerCase()}: ${best.name} (${format(picked.value, best.value)}, ${formatNumber((best.value / total) * 100)} % del total).`,
        );
    }
    const missing = items.length - valid.length;
    if (missing > 0) {
        lines.push(
            `${missing} fila${missing === 1 ? '' : 's'} sin dato de ${picked.value.header.toLowerCase()} (N/D): no entra${missing === 1 ? '' : 'n'} en la lectura ni en el gráfico.`,
        );
    }
    return lines;
}

const DAY = 86_400_000;
const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Periodo inmediatamente anterior con la misma duración (inclusive). */
export function previousPeriod(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string } | null {
    const from = parse(dateFrom);
    const to = parse(dateTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
    const days = Math.round((to - from) / DAY) + 1;
    return { dateFrom: iso(from - days * DAY), dateTo: iso(from - DAY) };
}

export interface SummaryDelta {
    key: string;
    current: number;
    previous: number;
    /** null cuando el periodo anterior es 0: no hay base para un porcentaje. */
    pct: number | null;
}

export function compareSummaries(current: Record<string, unknown>, previous: Record<string, unknown> | null): SummaryDelta[] {
    if (!previous) return [];
    const out: SummaryDelta[] = [];
    for (const [key, value] of Object.entries(current)) {
        const c = num(value);
        const p = num(previous[key]);
        if (c === null || p === null || typeof value === 'string') continue;
        out.push({ key, current: c, previous: p, pct: p === 0 ? null : ((c - p) / Math.abs(p)) * 100 });
    }
    return out;
}
