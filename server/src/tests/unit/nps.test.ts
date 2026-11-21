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
