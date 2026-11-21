import { formatLocalDateInput } from './dateInput';

export type NpsTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface SurveySummary {
    responses: number;
    promoters: number;
    passives: number;
    detractors: number;
    nps: number | null;
    avgWaiter: number | null;
    avgFood: number | null;
    avgWait: number | null;
    avgAmbience: number | null;
    trend: { weekStart: string; responses: number; nps: number | null }[];
    byWaiter: SurveyWaiterRow[];
    byBranch: { branchId: number; name: string; responses: number; nps: number | null }[];
}

export interface SurveyWaiterRow {
    userId: number;
    name: string;
    responses: number;
    nps: number | null;
    avgWaiter: number | null;
}

export interface SurveyRankingItem {
    rank: number;
    userId: number;
    name: string;
    branchName: string | null;
    responses: number;
    attentionAvg: number;
    score: number;
    nps: number | null;
}

export interface SurveyRanking {
    month: string;
    minResponses: number;
    items: SurveyRankingItem[];
    ineligible: { userId: number; name: string; responses: number }[];
}

export interface SurveyResponseRow {
    id: number;
    createdAt: string;
    branchName: string;
    waiterName: string;
    orderId: number;
    nps: number;
    waiterRating: number | null;
    foodRating: number | null;
    waitRating: number | null;
    ambienceRating: number | null;
    comment: string | null;
    contactPhone: string | null;
}

export interface SurveyResponsesPage {
    items: SurveyResponseRow[];
    total: number;
    page: number;
    pageSize: number;
}

/** NPS >= 50 is healthy, below 0 is a problem. */
export function npsTone(nps: number | null): NpsTone {
    if (nps === null) return 'neutral';
    if (nps >= 50) return 'success';
    if (nps < 0) return 'danger';
    return 'warning';
}

export function monthRange(now = new Date()) {
    return {
        dateFrom: formatLocalDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
        dateTo: formatLocalDateInput(now),
    };
}

export function areaAverages(s: Pick<SurveySummary, 'avgWaiter' | 'avgFood' | 'avgWait' | 'avgAmbience'>) {
    return [
        { key: 'waiter', label: 'Atención', value: s.avgWaiter },
        { key: 'food', label: 'Comida', value: s.avgFood },
        { key: 'wait', label: 'Tiempo de espera', value: s.avgWait },
        { key: 'ambience', label: 'Ambiente', value: s.avgAmbience },
    ];
}

export function trendPoints(trend: SurveySummary['trend']) {
    return trend.map((t) => {
        const [, m, d] = t.weekStart.split('-');
        return { label: `${d}/${m}`, nps: t.nps, responses: t.responses };
    });
}

export function bestWaiter(ranking: SurveyRanking | null): SurveyRankingItem | null {
    return ranking?.items[0] ?? null;
}

export function ineligibleLabel(w: { responses: number; userId?: number; name?: string }, min: number) {
    return `Sin opiniones suficientes (${w.responses}/${min})`;
}

/** Detractors (nps <= 6); the ones the customer left a phone for come first so they can be called back. */
export function detractorAlerts(items: SurveyResponseRow[], limit = 6) {
    return items
        .filter((r) => r.nps <= 6)
        .sort((a, b) => Number(Boolean(b.contactPhone)) - Number(Boolean(a.contactPhone)) || (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, limit);
}

/** Month (YYYY-MM) the ranking covers: the month of the period end, else of its start. */
export function rankingMonth(f: { dateFrom?: string; dateTo?: string }): string | undefined {
    const m = (f.dateTo || f.dateFrom || '').slice(0, 7);
    return /^\d{4}-\d{2}$/.test(m) ? m : undefined;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function monthLabel(month: string) {
    const [y, m] = month.split('-');
    return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

export const fmtAvg = (v: number | null) => (v === null ? '—' : v.toFixed(1));
export const fmtNps = (v: number | null) => (v === null ? '—' : String(v));
