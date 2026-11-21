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
