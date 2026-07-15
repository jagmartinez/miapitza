import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import {
    addBenefitMonths,
    allowedDeductionActions,
    allowedLoanActions,
    allowedTravelActions,
    buildPrincipalOnlySchedule,
    projectBenefitDeductions,
    reconcileTravelAmounts,
} from '../../services/hr-benefits.service';

describe('HR benefits state machines and monetary derivations', () => {
    it('exposes only lifecycle-valid travel actions', () => {
        expect(allowedTravelActions('DRAFT')).toEqual(['SUBMIT', 'CANCEL']);
        expect(allowedTravelActions('SUBMITTED')).toEqual(['APPROVE', 'REJECT', 'CANCEL']);
        expect(allowedTravelActions('ADVANCED')).toEqual(['START_SETTLEMENT', 'REVERSE']);
        expect(allowedTravelActions('SETTLED')).toEqual(['REVERSE']);
        expect(allowedTravelActions('REVERSED')).toEqual([]);
    });

    it('exposes only lifecycle-valid loan and deduction actions', () => {
        expect(allowedLoanActions('REQUESTED')).toEqual(['APPROVE', 'REJECT', 'CANCEL']);
        expect(allowedLoanActions('DISBURSED')).toEqual(['REGISTER_PAYMENT', 'REVERSE']);
        expect(allowedLoanActions('PAID')).toEqual(['CLOSE', 'REVERSE']);
        expect(allowedLoanActions('REVERSED')).toEqual([]);
        expect(allowedDeductionActions('DRAFT')).toEqual(['ACTIVATE', 'CANCEL']);
        expect(allowedDeductionActions('PAUSED')).toEqual(['RESUME', 'CANCEL', 'REVERSE']);
        expect(allowedDeductionActions('REVERSED')).toEqual([]);
    });

    it('builds an exact principal-only schedule without inventing a charge or rate', () => {
        const rows = buildPrincipalOnlySchedule('100.00', 3, new Date('2026-01-31T00:00:00.000Z'));
        expect(rows.map(row => row.scheduledPrincipal.toFixed(2))).toEqual(['33.33', '33.33', '33.34']);
        expect(rows.reduce((sum, row) => sum.plus(row.scheduledTotal), new Prisma.Decimal(0)).toFixed(2)).toBe('100.00');
        expect(rows.every(row => row.scheduledCharge.isZero())).toBe(true);
        expect(rows.map(row => row.dueDate.toISOString().slice(0, 10))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    });

    it('clamps month-end dates deterministically', () => {
        expect(addBenefitMonths(new Date('2024-01-31T00:00:00.000Z'), 1).toISOString().slice(0, 10)).toBe('2024-02-29');
        expect(addBenefitMonths(new Date('2026-03-31T00:00:00.000Z'), 1).toISOString().slice(0, 10)).toBe('2026-04-30');
    });

    it('reconciles employee return and reimbursement with Decimal', () => {
        const returned = reconcileTravelAmounts('100.00', ['20.00', '30.00']);
        expect(returned.employeeReturn.toFixed(2)).toBe('50.00');
        expect(returned.employeeReimbursement.toFixed(2)).toBe('0.00');
        const reimbursed = reconcileTravelAmounts('40.00', ['70.50']);
        expect(reimbursed.employeeReturn.toFixed(2)).toBe('0.00');
        expect(reimbursed.employeeReimbursement.toFixed(2)).toBe('30.50');
    });

    it('blocks and deduplicates a payroll projection when an active deduction has another currency', async () => {
        const payrollAnomaly = {
            findFirst: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 91 }),
            create: jest.fn().mockResolvedValue({ id: 91 }),
        };
        const tx = {
            payrollRun: { findFirst: jest.fn().mockResolvedValue({ kind: 'REGULAR' }) },
            hrDeduction: { findMany: jest.fn().mockResolvedValue([{
                id: 77,
                code: 'DED-USD-77',
                employeeId: 12,
                remainingAmount: new Prisma.Decimal('40.00'),
                versions: [{
                    id: 9,
                    currency: 'USD',
                    priority: 100,
                    applicableAmount: new Prisma.Decimal('10.00'),
                    perPeriodLimit: new Prisma.Decimal('10.00'),
                }],
            }]) },
            payrollComponent: {
                aggregate: jest.fn().mockResolvedValue({ _sum: { amount: new Prisma.Decimal('0.00') } }),
                create: jest.fn(),
            },
            payrollAnomaly,
        };

        const input = { companyId: 4, runId: 22, userId: 8, currency: 'NIO', cutoff: new Date('2026-07-14T00:00:00.000Z') };
        await projectBenefitDeductions(tx as unknown as Prisma.TransactionClient, input);
        await projectBenefitDeductions(tx as unknown as Prisma.TransactionClient, input);

        expect(tx.payrollComponent.create).not.toHaveBeenCalled();
        expect(payrollAnomaly.create).toHaveBeenCalledTimes(1);
        expect(payrollAnomaly.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            companyId: 4,
            runId: 22,
            userId: 8,
            employeeId: 12,
            code: 'BENEFIT_CURRENCY_MISMATCH_D77',
            severity: 'BLOCKING',
            blocking: true,
        }) });
    });
});

describe('HR benefits API, persistence and security contract', () => {
    const root = path.resolve(__dirname, '../../..');
    const routes = fs.readFileSync(path.join(root, 'src/routes/hr-benefits.routes.ts'), 'utf8');
    const controller = fs.readFileSync(path.join(root, 'src/controllers/hr-benefits.controller.ts'), 'utf8');
    const service = fs.readFileSync(path.join(root, 'src/services/hr-benefits.service.ts'), 'utf8');
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
    const migration = fs.readFileSync(path.join(root, 'prisma/migrations/20260713_hr_06_benefits_loans_deductions/migration.sql'), 'utf8');

    it('implements every owner and self-service endpoint consumed by the frontend', () => {
        for (const endpoint of ['/travel-requests', '/loan-requests', '/loans', '/deductions', '/me/travel-requests', '/me/loan-requests', '/me/loans', '/me/deductions']) expect(routes).toContain(endpoint);
        for (const action of ['approve', 'reject', 'advance', 'start-settlement', 'settle', 'payments', 'disburse', 'close', 'activate', 'pause', 'resume', 'cancel', 'reverse']) expect(routes).toContain(action);
        expect(routes).not.toMatch(/router\.delete/i);
    });

    it('separates Owner read/manage/approve permissions from internal self-service', () => {
        for (const permission of ['hr.benefits.read', 'hr.benefits.manage', 'hr.benefits.approve', 'hr.benefits.self']) expect(routes).toContain(permission);
        expect(controller).toContain("accountType !== 'INTERNAL'");
        expect(controller).toContain('assertBenefitsSelf');
        expect(service).toContain("accountType: 'INTERNAL'");
        expect(service).toContain("status: { in: ['ACTIVE', 'ON_LEAVE'] }");
    });

    it('uses durable idempotency, serializable transactions and revision CAS', () => {
        expect(schema).toContain('model HrBenefitIdempotencyRecord');
        expect(schema).toContain('@@unique([companyId, key])');
        expect(service).toContain('Prisma.TransactionIsolationLevel.Serializable');
        expect(service).toContain('requestHash');
        expect(service).toContain("revision: { increment: 1 }");
        expect(service).toContain('HR_BENEFITS_REVISION_CONFLICT');
    });

    it('keeps ledgers, traces, schedules and versions immutable at database level', () => {
        for (const name of ['HrTravelLedgerEntry', 'HrLoanLedgerEntry', 'HrDeductionApplication', 'HrBenefitTrace', 'HrLoanScheduleVersion', 'HrLoanInstallment', 'HrDeductionVersion']) {
            expect(migration).toContain(`${name}_no_update`);
            expect(migration).toContain(`${name}_no_delete`);
        }
        expect(schema).toContain('reversedEntryId');
        expect(service).toContain("type: 'REVERSAL'");
    });

    it('fails closed for unverified evidence identifiers', () => {
        expect(service).toContain('HR_BENEFITS_EVIDENCE_REPOSITORY_REQUIRED');
        expect(service).toContain('evidenceId se rechaza de forma cerrada');
        expect(schema).toContain('evidenceId');
    });

    it('projects payroll deductions with immutable source trace and commits only on payment', () => {
        expect(service).toContain('projectBenefitDeductions');
        expect(service).toContain('commitBenefitDeductions');
        expect(service).toContain('reverseBenefitDeductions');
        expect(service).toContain("source: 'BENEFIT_DEDUCTION'");
        expect(service).toContain('HR_BENEFITS_PAYROLL_SOURCE_STALE');
        expect(service).toContain('BENEFIT_CURRENCY_MISMATCH_D');
        expect(service).toContain("severity: 'BLOCKING'");
        expect(schema).toContain('@@unique([deductionId, payrollRunId, kind])');
    });

    it('stores all monetary state as Decimal and guards positive amounts in SQL', () => {
        for (const model of ['HrTravelRequest', 'HrTravelExpense', 'HrLoan', 'HrLoanInstallment', 'HrLoanLedgerEntry', 'HrDeductionVersion', 'HrDeductionApplication']) expect(schema).toContain(`model ${model}`);
        expect(service).toContain('new Prisma.Decimal');
        expect(service).not.toMatch(/parseFloat\(/);
        expect(migration).toContain('CHECK (`requestedAmount` > 0');
    });
});
