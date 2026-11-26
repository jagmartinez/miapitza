import { describe, expect, it } from '@jest/globals';
import { npsSummary } from '../../utils/nps';

describe('npsSummary', () => {
    it('is null without responses', () => {
        expect(npsSummary([])).toEqual({ responses: 0, promoters: 0, passives: 0, detractors: 0, nps: null });
    });
    it('splits promoters, passives and detractors', () => {
        expect(npsSummary([10, 9, 8, 7, 6, 0])).toEqual({ responses: 6, promoters: 2, passives: 2, detractors: 2, nps: 0 });
    });
    it('all promoters is 100', () => { expect(npsSummary([10, 10, 10]).nps).toBe(100); });
    it('a single zero is -100', () => { expect(npsSummary([0]).nps).toBe(-100); });
    it('rounds to an integer', () => { expect(npsSummary([9, 9, 6]).nps).toBe(33); });
});

import { rankWaiters } from '../../utils/nps';

describe('rankWaiters', () => {
    const row = (userId: number, responses: number, attentionAvg: number) =>
        ({ userId, name: `W${userId}`, branchName: 'B', responses, attentionAvg, nps: 50 });

    it('excludes waiters under 10 responses and lists them as ineligible', () => {
        const r = rankWaiters([row(1, 40, 4.8), row(2, 2, 5)]);
        expect(r.items.map((i) => i.userId)).toEqual([1]);
        expect(r.ineligible).toEqual([{ userId: 2, name: 'W2', responses: 2 }]);
    });
    it('bayesian score pulls small samples toward the company mean', () => {
        // C = (40*4.8 + 10*5 + 10*3) / 60 = 4.5333
        const r = rankWaiters([row(1, 40, 4.8), row(2, 10, 5), row(3, 10, 3)]);
        expect(r.items.map((i) => [i.userId, i.rank, i.score])).toEqual([[2, 1, 4.77], [1, 2, 4.75], [3, 3, 3.77]]);
    });
    it('ties on score break by responses desc', () => {
        const r = rankWaiters([row(1, 10, 4), row(2, 20, 4)]);
        expect(r.items.map((i) => i.userId)).toEqual([2, 1]);
    });
    it('empty input', () => { expect(rankWaiters([])).toEqual({ items: [], ineligible: [] }); });
});
