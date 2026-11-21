export interface NpsSummary {
    responses: number;
    promoters: number;
    passives: number;
    detractors: number;
    /** round(%promoters - %detractors), -100..100; null when there are no responses. */
    nps: number | null;
}

/** Promoters score 9-10, passives 7-8, detractors 0-6. */
export function npsSummary(scores: number[]): NpsSummary {
    const responses = scores.length;
    const promoters = scores.filter((s) => s >= 9).length;
    const detractors = scores.filter((s) => s <= 6).length;
    const passives = responses - promoters - detractors;
    const nps = responses === 0 ? null : Math.round(((promoters - detractors) / responses) * 100);
    return { responses, promoters, passives, detractors, nps };
}

export const MIN_RANKING_RESPONSES = 10;
export const RANKING_PRIOR_WEIGHT = 10;

export function roundTo(value: number, decimals: number): number {
    const f = 10 ** decimals;
    return Math.round(value * f) / f;
}

/** Mean rounded to `decimals`; null for an empty list. */
export function meanOrNull(values: number[], decimals = 1): number | null {
    return values.length === 0 ? null : roundTo(values.reduce((a, b) => a + b, 0) / values.length, decimals);
}

export interface WaiterRankInput {
    userId: number;
    name: string;
    branchName: string | null;
    /** Responses that carry a waiterRating. */
    responses: number;
    /** Mean waiterRating over those responses. */
    attentionAvg: number;
    nps: number | null;
}

export interface RankedWaiter extends WaiterRankInput {
    rank: number;
    /** Bayesian average (v*R + m*C) / (v + m), 2 decimals. */
    score: number;
}

/**
 * Monthly waiter ranking. C is the weighted mean of every waiter's ratings (the
 * company mean for the scope); waiters under `minResponses` are returned as ineligible.
 */
export function rankWaiters(
    rows: WaiterRankInput[],
    m: number = RANKING_PRIOR_WEIGHT,
    minResponses: number = MIN_RANKING_RESPONSES,
): { items: RankedWaiter[]; ineligible: { userId: number; name: string; responses: number }[] } {
    const total = rows.reduce((a, r) => a + r.responses, 0);
    const company = total === 0 ? 0 : rows.reduce((a, r) => a + r.attentionAvg * r.responses, 0) / total;
    const eligible = rows
        .filter((r) => r.responses >= minResponses)
        .map((r) => ({ ...r, score: roundTo((r.responses * r.attentionAvg + m * company) / (r.responses + m), 2) }))
        .sort((a, b) => b.score - a.score || b.responses - a.responses);
    return {
        items: eligible.map((r, i) => ({ ...r, rank: i + 1 })),
        ineligible: rows
            .filter((r) => r.responses < minResponses)
            .map((r) => ({ userId: r.userId, name: r.name, responses: r.responses }))
            .sort((a, b) => b.responses - a.responses),
    };
}
