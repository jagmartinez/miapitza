import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { PayrollRunService } from '../../services/hr-payroll.service';

function runFixture() {
    return {
        id: 40, companyId: 4, kind: 'REGULAR', code: 'PAY-01', status: 'CALCULATED', revision: 2, calculationRevision: 2,
        currency: 'NIO', grossIncome: new Prisma.Decimal('1000.00'), totalDeductions: new Prisma.Decimal('100.00'),
        employerContributions: new Prisma.Decimal('0.00'), netPay: new Prisma.Decimal('900.00'), employeeCount: 1,
        configurationRevision: { id: 8, review: { decision: 'VALIDATED' } },
        snapshots: [{ userId: 11 }],
        components: [
            { id: 1, userId: 11, type: 'INCOME', amount: new Prisma.Decimal('1000.00'), reversal: null },
            { id: 2, userId: 11, type: 'DEDUCTION', amount: new Prisma.Decimal('100.00'), reversal: null },
        ],
        employerContributionLines: [], anomalies: [], coverageClaims: [{ userId: 11, release: null }], receipts: [],
    };
}

describe('payroll parallel reconciliation', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    function arrange(run = runFixture()) {
        jest.spyOn(prisma.payrollRun, 'findFirst').mockResolvedValue(run as never);
        jest.spyOn(prisma, '$transaction').mockResolvedValue(undefined as never);
        jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 1 } as never);
    }

    it('returns a reproducible all-green report without asserting legal or production certification', async () => {
        arrange();
        const result = await PayrollRunService.reconcileParallelControl(4, 3, 40, 'REGULAR', {
            expectedGrossIncome: '1000.00', expectedTotalDeductions: '100.00', expectedEmployerContributions: '0.00', expectedNetPay: '900.00',
            expectedEmployeeCount: 1, controlSource: 'Cálculo paralelo revisado', evidenceReference: 'evidence://pay-01',
        });
        expect(result.readyForParallelSignoff).toBe(true);
        expect(result.legalValidationAsserted).toBe(false);
        expect(result.productionCertificationAsserted).toBe(false);
        expect(result.reconciliationHash).toMatch(/^[0-9a-f]{64}$/);
        expect(result.checks.every(check => check.passed)).toBe(true);
    });

    it('reports external differences explicitly instead of accepting a tolerance or fallback', async () => {
        arrange();
        const result = await PayrollRunService.reconcileParallelControl(4, 3, 40, 'REGULAR', {
            expectedGrossIncome: '999.99', expectedTotalDeductions: '100.00', expectedEmployerContributions: '0.00', expectedNetPay: '899.99',
            expectedEmployeeCount: 1, controlSource: 'Cálculo paralelo revisado', evidenceReference: 'evidence://pay-01',
        });
        expect(result.readyForParallelSignoff).toBe(false);
        expect(result.checks.filter(check => !check.passed).map(check => check.code)).toEqual(expect.arrayContaining(['EXTERNAL_GROSS_MATCH', 'EXTERNAL_NET_MATCH']));
    });
});
