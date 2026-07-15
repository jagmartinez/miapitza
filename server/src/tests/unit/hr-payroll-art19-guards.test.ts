import fs from 'node:fs';
import path from 'node:path';
import {
    assertPayrollPaymentDate,
    coversFiscalYearContinuously,
    elapsedFiscalMonths,
    HrPayrollError,
} from '../../services/hr-payroll.service';

const utc = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('Art. 19 fiscal continuity guards', () => {
    it('counts calendar payroll months, not payroll runs', () => {
        expect(elapsedFiscalMonths(null, utc('2026-01-15'))).toBe(1);
        expect(elapsedFiscalMonths(utc('2026-01-01'), utc('2026-01-31'))).toBe(1);
        expect(elapsedFiscalMonths(utc('2026-09-01'), utc('2026-12-31'))).toBe(4);
    });

    it('accepts only continuous full-year coverage for employer refunds', () => {
        expect(coversFiscalYearContinuously([
            { dateFrom: utc('2026-01-01'), dateTo: utc('2026-06-30') },
            { dateFrom: utc('2026-07-01'), dateTo: utc('2026-12-31') },
        ], 2026)).toBe(true);
        expect(coversFiscalYearContinuously([
            { dateFrom: utc('2026-01-01'), dateTo: utc('2026-06-29') },
            { dateFrom: utc('2026-07-01'), dateTo: utc('2026-12-31') },
        ], 2026)).toBe(false);
    });

    it('fails closed when the real payment date differs from the frozen fiscal date', () => {
        expect(() => assertPayrollPaymentDate(utc('2026-01-31'), utc('2026-01-31'))).not.toThrow();
        try {
            assertPayrollPaymentDate(utc('2026-02-01'), utc('2026-01-31'));
            throw new Error('expected mismatch');
        } catch (error) {
            expect(error).toBeInstanceOf(HrPayrollError);
            expect((error as HrPayrollError).code).toBe('HR_PAYROLL_PAYMENT_DATE_MISMATCH');
        }
    });
});

describe('Art. 19 service boundary contracts', () => {
    const root = path.resolve(__dirname, '../../..');
    const service = fs.readFileSync(path.join(root, 'src/services/hr-payroll.service.ts'), 'utf8');
    const routes = fs.readFileSync(path.join(root, 'src/routes/hr-payroll.routes.ts'), 'utf8');

    it('serializes payroll mutations at company level and blocks chronological inversions', () => {
        const transition = service.slice(service.indexOf('static async transition(companyId'), service.indexOf('private static async publishReceipts'));
        expect(transition.indexOf('await lockPayrollCompany(tx, companyId)')).toBeLessThan(transition.indexOf('lockedRun(tx, companyId'));
        expect(service).toContain('HR_PAYROLL_PAYMENT_ORDER_INVALID');
        expect(service).toContain("{ status: 'DRAFT' }");
        expect(service).toContain("status: { in: ['CALCULATED', 'REVIEW', 'APPROVED'] }");
        expect(service.indexOf("{ status: 'DRAFT' }")).toBeLessThan(service.indexOf("snapshots: { some: { userId: { in: input.userIds } } }"));
    });

    it('requires an auditable manual tax-classification confirmation', () => {
        expect(routes).toContain("'classificationConfirmed'");
        expect(routes).toContain("classificationConfirmed: { type: 'boolean', required: true }");
        expect(service).toContain('HR_PAYROLL_COMPONENT_CLASSIFICATION_CONFIRMATION_REQUIRED');
        expect(service).toContain('classificationConfirmed: true');
    });

    it('exports the reproducible Art. 19 trace instead of only the total deduction', () => {
        for (const field of [
            'statutoryMethodVersion', 'statutoryIncomeTaxMethod', 'statutoryElapsedFiscalMonths',
            'statutoryRegularWithholding', 'statutoryOccasionalWithholding', 'statutoryCreditBalance',
            'statutoryHistoryFingerprint',
        ]) expect(service).toContain(field);
    });
});
