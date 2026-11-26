import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('cash close and table consolidation API contracts', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'api.ts'), 'utf8');
    const cashShiftPageSource = fs.readFileSync(
        path.resolve(__dirname, '../pages/CashShift.tsx'),
        'utf8',
    );
    const appSource = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
    const legacyReviewSource = fs.readFileSync(
        path.resolve(__dirname, '../components/LegacyConsolidationReview.tsx'),
        'utf8',
    );
    const tablesPageSource = fs.readFileSync(
        path.resolve(__dirname, '../pages/Tables.tsx'),
        'utf8',
    );

    it('routes the only internal cash-shift page through the authoritative arqueo close', () => {
        expect(source).not.toContain('api.post(`/cash-shifts/${id}/close`');
        expect(source).toContain('api.post(`/cash-arqueo/${shiftId}/close`');
        expect(cashShiftPageSource).not.toContain('cashShiftsAPI.close');
        expect(cashShiftPageSource).toContain('cashArqueoAPI.closeShift(Number(id)');
        expect(appSource).toContain('path="/cash-shifts/:id"');
        expect(appSource).toContain('<CashShiftPage />');
    });

    it('can rediscover and reverse an active consolidation after a reload', () => {
        expect(source).toContain("api.get('/tables/consolidations/active'");
        expect(source).toContain('api.post(`/tables/consolidations/${id}/reverse`');
        expect(source).toContain("'X-Idempotency-Key': data.reversalKey");
    });

    it('exposes historical residuals as review-only and never as an automatic reversal', () => {
        expect(source).toContain("api.get('/tables/consolidations/legacy-inventory'");
        expect(source).toContain('/legacy-inventory/${encodeURIComponent(candidateKey)}/mark');
        expect(legacyReviewSource).toContain('Estos registros son históricos y no reversibles desde esta pantalla');
        expect(legacyReviewSource).toContain('No restaura órdenes, productos,');
        expect(legacyReviewSource).toContain('pagos ni mesas');
        expect(legacyReviewSource).toContain('Registrar revisión sin reversar');
        expect(legacyReviewSource).toContain('candidate.currentEvidenceReviewed');
        expect(legacyReviewSource).toContain('Registrar nueva revisión de la evidencia actual');
        expect(legacyReviewSource).toContain('candidate.review.revision');
        expect(legacyReviewSource).toContain('candidate.reviewHistoryCount');
        expect(legacyReviewSource).not.toContain('reverseConsolidation');
        expect(tablesPageSource).toContain('candidate.currentEvidenceReviewed');
        expect(tablesPageSource).not.toContain('candidate.reversible !== false || candidate.review');
    });
});
