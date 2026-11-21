import { describe, expect, it } from 'vitest';
import {
    areaAverages, bestWaiter, detractorAlerts, ineligibleLabel, monthRange, npsTone, sortByResponses, trendPoints,
    type SurveyResponseRow,
} from './surveyReport';

const row = (id: number, nps: number, extra: Partial<SurveyResponseRow> = {}): SurveyResponseRow => ({
    id, createdAt: `2026-11-${String(10 + id).padStart(2, '0')}T12:00:00Z`, branchName: 'Centro', waiterName: 'Ana', orderId: id,
    nps, waiterRating: null, foodRating: null, waitRating: null, ambienceRating: null, comment: null, contactPhone: null, ...extra,
});

describe('surveyReport helpers', () => {
    it('sets the NPS tone: >=50 success, <0 danger, otherwise warning, null neutral', () => {
        expect(npsTone(50)).toBe('success');
        expect(npsTone(49)).toBe('warning');
        expect(npsTone(0)).toBe('warning');
        expect(npsTone(-1)).toBe('danger');
        expect(npsTone(null)).toBe('neutral');
    });

    it('defaults the period to the current month', () => {
        expect(monthRange(new Date(2026, 10, 20))).toEqual({ dateFrom: '2026-11-01', dateTo: '2026-11-20' });
    });

    it('lists the four area averages side by side', () => {
        const areas = areaAverages({ avgWaiter: 4.5, avgFood: 4, avgWait: null, avgAmbience: 3.2 });
        expect(areas.map((a) => a.label)).toEqual(['Atención', 'Comida', 'Tiempo de espera', 'Ambiente']);
        expect(areas.map((a) => a.value)).toEqual([4.5, 4, null, 3.2]);
    });

    it('builds weekly trend points', () => {
        const pts = trendPoints([{ weekStart: '2026-11-09', responses: 4, nps: 25 }, { weekStart: '2026-11-16', responses: 2, nps: null }]);
        expect(pts).toEqual([{ label: '09/11', nps: 25, responses: 4 }, { label: '16/11', nps: null, responses: 2 }]);
    });

    it('takes the best waiter from rank 1 and labels ineligible ones with N/10', () => {
        const ranking = { month: '2026-11', minResponses: 10, items: [{ rank: 1, userId: 1, name: 'Ana', branchName: null, responses: 12, attentionAvg: 4.8, score: 4.7, nps: 80 }], ineligible: [] };
        expect(bestWaiter(ranking)?.name).toBe('Ana');
        expect(bestWaiter({ ...ranking, items: [] })).toBeNull();
        expect(ineligibleLabel({ userId: 2, name: 'Luis', responses: 4 }, 10)).toBe('Sin opiniones suficientes (4/10)');
    });

    it('sorts waiters by responses descending', () => {
        const sorted = sortByResponses([
            { userId: 1, name: 'A', responses: 2, nps: 0, avgWaiter: null },
            { userId: 2, name: 'B', responses: 9, nps: 0, avgWaiter: null },
        ]);
        expect(sorted.map((w) => w.userId)).toEqual([2, 1]);
    });

    it('alerts only detractors (nps <= 6) with contact phone first', () => {
        const alerts = detractorAlerts([row(1, 3), row(2, 9), row(3, 6, { contactPhone: '555-1234' }), row(4, 0, { contactPhone: '555-9' })]);
        expect(alerts.map((a) => a.id)).toEqual([4, 3, 1]);
    });
});
