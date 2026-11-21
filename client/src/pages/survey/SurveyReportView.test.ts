import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SurveyReportView, { type SurveyReportViewProps } from './SurveyReportView';
import type { SurveyResponseRow } from '../../utils/surveyReport';

const resp = (id: number, nps: number, extra: Partial<SurveyResponseRow> = {}): SurveyResponseRow => ({
    id, createdAt: '2026-11-12T12:00:00Z', branchName: 'Centro', waiterName: 'Ana', orderId: id, nps,
    waiterRating: 5, foodRating: 4, waitRating: 3, ambienceRating: 4, comment: null, contactPhone: null, ...extra,
});

const base = (): SurveyReportViewProps => ({
    summary: {
        responses: 20, promoters: 14, passives: 3, detractors: 3, nps: 55,
        avgWaiter: 4.6, avgFood: 4.1, avgWait: 3.4, avgAmbience: 4.3,
        trend: [{ weekStart: '2026-11-02', responses: 8, nps: 40 }, { weekStart: '2026-11-09', responses: 12, nps: 66 }],
        byWaiter: [
            { userId: 1, name: 'Ana', responses: 5, nps: 60, avgWaiter: 4.8 },
            { userId: 2, name: 'Luis', responses: 15, nps: 50, avgWaiter: 4.4 },
        ],
        byBranch: [{ branchId: 1, name: 'Centro', responses: 12, nps: 60 }, { branchId: 2, name: 'Norte', responses: 8, nps: 45 }],
    },
    ranking: {
        month: '2026-11', minResponses: 10,
        items: [{ rank: 1, userId: 2, name: 'Luis', branchName: 'Centro', responses: 15, attentionAvg: 4.4, score: 4.3, nps: 50 }],
        ineligible: [{ userId: 1, name: 'Ana', responses: 5 }],
    },
    alerts: [resp(1, 2, { contactPhone: '555-1234', comment: 'Tardaron mucho' })],
    responses: { items: [resp(1, 2, { contactPhone: '555-1234', comment: 'Tardaron mucho' })], total: 1, page: 1, pageSize: 20 },
    detractorsOnly: false,
    onToggleDetractors: () => undefined,
    onPageChange: () => undefined,
    showBranches: true,
});

const html = (p: SurveyReportViewProps) => renderToStaticMarkup(createElement(SurveyReportView, p));

describe('SurveyReportView', () => {
    it('shows NPS, responses and four area averages for the period', () => {
        const out = html(base());
        expect(out).toContain('kpi-success');
        for (const label of ['NPS', 'Respuestas', 'Atención', 'Comida', 'Tiempo de espera', 'Ambiente']) expect(out).toContain(label);
        expect(out).toContain('>55<');
        expect(out).toContain('>20<');
        expect(out).toContain('4.6');
    });

    it('highlights the best waiter of the month and lists ineligible ones with N/10', () => {
        const out = html(base());
        expect(out).toContain('Mejor mesero del mes');
        expect(out).toMatch(/Mejor mesero del mes[\s\S]*Luis/);
        expect(out).toContain('Sin opiniones suficientes (5/10)');
    });

    it('renders the weekly NPS trend', () => {
        const out = html(base());
        expect(out).toContain('Tendencia semanal de NPS');
        expect(out).toContain('aria-label="Tendencia semanal de NPS"');
    });

    it('lists the by-waiter table sorted by responses', () => {
        const out = html(base());
        const table = out.slice(out.indexOf('aria-label="Resultados por mesero"'));
        expect(table.indexOf('Luis')).toBeGreaterThan(-1);
        expect(table.indexOf('Luis')).toBeLessThan(table.indexOf('Ana'));
    });

    it('shows detractor alerts with the contact phone and the Solo detractores toggle', () => {
        const out = html(base());
        expect(out).toContain('Alertas de detractores');
        expect(out).toContain('555-1234');
        expect(out).toContain('Tardaron mucho');
        expect(out).toContain('Solo detractores');
    });

    it('compares branches only when more than one is present', () => {
        expect(html(base())).toContain('Comparativo por sucursal');
        expect(html({ ...base(), showBranches: false })).not.toContain('Comparativo por sucursal');
    });

    it('empty period shows Sin respuestas en el período', () => {
        const p = base();
        p.summary = { ...p.summary, responses: 0, promoters: 0, passives: 0, detractors: 0, nps: null, avgWaiter: null, avgFood: null, avgWait: null, avgAmbience: null, trend: [], byWaiter: [], byBranch: [] };
        p.ranking = { month: '2026-11', minResponses: 10, items: [], ineligible: [] };
        p.alerts = [];
        p.responses = { items: [], total: 0, page: 1, pageSize: 20 };
        expect(html(p)).toContain('Sin respuestas en el período');
    });
});
