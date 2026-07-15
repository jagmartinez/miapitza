import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import {
    allowedPayrollActions,
    assertAguinaldoDependencyFresh,
    assertPayrollTransitionAllowed,
    assertRuleConfigurationMutable,
    assertRuleMetadataEditable,
    HrPayrollError,
    compensationMinuteRate,
    paidReversalInput,
    validateLegalConfiguration,
} from '../../services/hr-payroll.service';

describe('HR payroll safety and state machine', () => {
    it('fails closed when a legal configuration is absent or incomplete', () => {
        expect(() => validateLegalConfiguration(null)).toThrow('configuración legal validada');
        expect(() => validateLegalConfiguration({ schema: 'HR_PAYROLL_PARAMETRIC_V1', legallyValidated: true })).toThrow(HrPayrollError);
    });

    it('accepts only an explicit, fully parameterized and legally validated configuration', () => {
        expect(validateLegalConfiguration({
            schema: 'HR_PAYROLL_PARAMETRIC_V1', legallyValidated: true, currency: 'NIO',
            regular: {
                minuteDivisors: { WEEKLY: '2880', BIWEEKLY: '5760', MONTHLY: '12000' }, overtimeMultiplier: '2.0',
                paidLeaveUnitMinutes: { DAYS: '480', HOURS: '60', MINUTES: '1' },
            },
            aguinaldo: { method: 'HISTORICAL_PAID_COMPONENTS', lookbackDays: 365, incomeDivisor: '12', prorationMode: 'SERVICE_DAYS_RATIO', eligibleSources: ['RULE', 'OVERTIME', 'LEAVE'], roundingScale: 2 },
        }).currency).toBe('NIO');
    });

    it('treats HOURLY as amount per hour and SALARY through validated divisors', () => {
        const config = validateLegalConfiguration({ schema: 'HR_PAYROLL_PARAMETRIC_V1', legallyValidated: true, currency: 'NIO', regular: { minuteDivisors: { WEEKLY: '2400', BIWEEKLY: '4800', MONTHLY: '9600' }, overtimeMultiplier: '2', paidLeaveUnitMinutes: { DAYS: '480', HOURS: '60', MINUTES: '1' } }, aguinaldo: { method: 'HISTORICAL_PAID_COMPONENTS', lookbackDays: 365, incomeDivisor: '12', prorationMode: 'NONE', eligibleSources: ['RULE'], roundingScale: 2 } });
        expect(compensationMinuteRate({ compensationType: 'HOURLY', amount: new Prisma.Decimal('120'), payFrequency: 'WEEKLY' }, config).toString()).toBe('2');
        expect(compensationMinuteRate({ compensationType: 'SALARY', amount: new Prisma.Decimal('2400'), payFrequency: 'WEEKLY' }, config).toString()).toBe('1');
    });

    it('exposes only valid actions for each immutable lifecycle state', () => {
        expect(allowedPayrollActions('DRAFT')).toEqual(['CALCULATE', 'VOID']);
        expect(allowedPayrollActions('CALCULATED')).toEqual(['RECALCULATE', 'SUBMIT_REVIEW', 'VOID']);
        expect(allowedPayrollActions('REVIEW')).toEqual(['APPROVE', 'VOID']);
        expect(allowedPayrollActions('APPROVED')).toEqual(['MARK_PAID', 'VOID']);
        expect(allowedPayrollActions('PAID')).toEqual(['VOID']);
        expect(allowedPayrollActions('VOID')).toEqual([]);
    });

    it('blocks state mismatches and unresolved blocking anomalies', () => {
        expect(() => assertPayrollTransitionAllowed({ status: 'DRAFT', action: 'approve', actorId: 9 })).toThrow('estado actual');
        expect(() => assertPayrollTransitionAllowed({ status: 'CALCULATED', action: 'submit-review', actorId: 9, blockingAnomalies: 1 })).toThrow('BLOCKING');
    });

    it('enforces segregation for approval and payment', () => {
        expect(() => assertPayrollTransitionAllowed({ status: 'REVIEW', action: 'approve', actorId: 9, calculatedById: 9 })).toThrow('Segregación');
        expect(() => assertPayrollTransitionAllowed({ status: 'APPROVED', action: 'pay', actorId: 9, reviewSubmittedById: 9, approvedById: 8 })).toThrow('Segregación');
        expect(() => assertPayrollTransitionAllowed({ status: 'APPROVED', action: 'pay', actorId: 10, calculatedById: 7, reviewSubmittedById: 8, approvedById: 9 })).not.toThrow();
    });

    it('freezes metadata once a DRAFT rule has a validated configuration', () => {
        expect(() => assertRuleMetadataEditable({ status: 'DRAFT', activeConfigurationRevisionId: 44, validatedById: 8, validatedAt: new Date() })).toThrow('congelados');
        expect(() => assertRuleMetadataEditable({ status: 'DRAFT', activeConfigurationRevisionId: null, validatedById: null, validatedAt: null })).not.toThrow();
    });

    it('freezes configuration uploads and reviews once the DRAFT rule is validated', () => {
        const validated = { status: 'DRAFT' as const, activeConfigurationRevisionId: 44, validatedById: 8, validatedAt: new Date() };
        expect(() => assertRuleConfigurationMutable(validated)).toThrow('nueva versión');
        expect(() => assertRuleConfigurationMutable({ status: 'DRAFT', activeConfigurationRevisionId: null, validatedById: null, validatedAt: null })).not.toThrow();
    });

    it('requires an independent actor and complete evidence to void PAID', () => {
        expect(() => assertPayrollTransitionAllowed({ status: 'PAID', action: 'void', actorId: 9, approvedById: 9, paidById: 10 })).toThrow('Segregación');
        expect(() => assertPayrollTransitionAllowed({ status: 'PAID', action: 'void', actorId: 10, approvedById: 9, paidById: 10 })).toThrow('Segregación');
        expect(() => assertPayrollTransitionAllowed({ status: 'PAID', action: 'void', actorId: 11, approvedById: 9, paidById: 10 })).not.toThrow();
        expect(() => paidReversalInput({ reversalReference: 'REV-1' })).toThrow('reversalDate');
        expect(paidReversalInput({ reversalReference: 'REV-1', reversalDate: '2026-07-14', reversalMethod: 'BANK_REVERSAL', evidenceReference: 'evidence://rev-1' }).reversalDate.toISOString().slice(0, 10)).toBe('2026-07-14');
    });

    it('fails closed when a normalized aguinaldo source changes or is reversed', () => {
        const fresh = {
            componentId: 81, linksValid: true,
            captured: { runRevision: 5, runStatus: 'PAID', runCurrency: 'NIO', componentAmount: '1500.00', receiptStatus: 'PUBLISHED', componentReversed: false, runReversed: false },
            current: { runRevision: 5, runStatus: 'PAID', runCurrency: 'NIO', componentAmount: '1500.00', receiptStatus: 'PUBLISHED', componentReversed: false, runReversed: false },
        };
        expect(() => assertAguinaldoDependencyFresh(fresh)).not.toThrow();
        expect(() => assertAguinaldoDependencyFresh({ ...fresh, current: { ...fresh.current, componentAmount: '1500.01' } })).toThrow('fuente histórica');
        expect(() => assertAguinaldoDependencyFresh({ ...fresh, current: { ...fresh.current, runReversed: true } })).toThrow(HrPayrollError);
    });
});

describe('HR payroll persistence and route contract', () => {
    const root = path.resolve(__dirname, '../../..');
    const routes = fs.readFileSync(path.join(root, 'src/routes/hr-payroll.routes.ts'), 'utf8');
    const controller = fs.readFileSync(path.join(root, 'src/controllers/hr-payroll.controller.ts'), 'utf8');
    const service = fs.readFileSync(path.join(root, 'src/services/hr-payroll.service.ts'), 'utf8');
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
    const migration = fs.readFileSync(path.join(root, 'prisma/migrations/20260713_hr_05_payroll_aguinaldo/migration.sql'), 'utf8');
    const rollback = fs.readFileSync(path.join(root, 'prisma/migrations/20260713_hr_05_payroll_aguinaldo/rollback.sql'), 'utf8');
    const workforce = fs.readFileSync(path.join(root, 'src/services/hr-workforce.service.ts'), 'utf8');

    it('matches the frontend endpoints and separates read/manage/approve/self permissions', () => {
        for (const endpoint of ['/rules', '/periods', '/runs', '/aguinaldo/runs', '/me/receipts']) expect(routes).toContain(endpoint);
        for (const action of ['calculate', 'recalculate', 'submit-review', 'approve', 'pay', 'void']) expect(routes).toContain(`/:id/${action}`);
        for (const part of ['anomalies', 'snapshot', 'components', 'receipts', 'export']) expect(routes).toContain(`/:id/${part}`);
        expect(routes).toContain("requirePermission('hr.payroll.read', ROLES.SUPERADMIN)");
        expect(routes).toContain("requirePermission('hr.payroll.manage', ROLES.SUPERADMIN)");
        expect(routes).toContain("requirePermission('hr.payroll.approve', ROLES.SUPERADMIN)");
        expect(routes).toContain("requirePermission('hr.payroll.self'");
        expect(routes).not.toMatch(/router\.delete/i);
    });

    it('keeps self-service internal, employee-linked, published-only and tenant scoped', () => {
        expect(controller).toContain("accountType !== 'INTERNAL'");
        expect(controller).toContain('!req.user!.employeeId');
        expect(service).toContain("status: 'PUBLISHED'");
        expect(service).toContain('companyId, userId');
    });

    it('requires a closed payroll-eligible attendance period and freezes source trace', () => {
        expect(service).toContain("status: 'CLOSED', payrollEligible: true");
        expect(service).toContain('HR_PAYROLL_ATTENDANCE_PERIOD_NOT_ELIGIBLE');
        expect(service).toContain('sourceTrace:');
        expect(service).toContain('approvedLeaves:');
        expect(schema).toContain('@@unique([runId, userId])');
        expect(schema).toContain('compensationHistoryId');
    });

    it('persists durable idempotency and append-only trace protections', () => {
        expect(schema).toContain('model PayrollIdempotencyRecord');
        expect(schema).toContain('@@unique([companyId, key])');
        expect(migration).toContain('PayrollTrace_no_update');
        expect(migration).toContain('PayrollTrace_no_delete');
        expect(service).toContain('requestHash');
        expect(service).toContain('Prisma.TransactionIsolationLevel.Serializable');
        expect(schema).toContain('model PayrollRunReversal');
        expect(service).toContain('reversedNetPay: run.netPay.negated()');
    });

    it('uses Prisma Decimal for every monetary derivation and does not expose rule configuration', () => {
        expect(service).toContain('new Prisma.Decimal');
        expect(service).not.toMatch(/parseFloat\(|Number\(.*amount/);
        expect(service).toContain('configuration: undefined');
        expect(routes).toContain('/configuration-revisions');
        expect(routes).toContain('/configuration-reviews');
    });

    it('implements immutable dual-control legal configuration revisions', () => {
        expect(routes).toContain("router.get('/rules/:id/configuration-revisions'");
        expect(controller).toContain('PayrollRuleService.listConfigurationRevisions');
        expect(service).toContain("status: item.review?.decision ?? 'UPLOADED'");
        expect(schema).toContain('model PayrollRuleConfigurationRevision');
        expect(schema).toContain('model PayrollRuleConfigurationReview');
        expect(service).toContain('HR_PAYROLL_DUAL_CONTROL_REQUIRED');
        expect(service).toContain('HR_PAYROLL_VALIDATED_RULE_IMMUTABLE');
        expect(service).toContain("review?.decision !== 'VALIDATED'");
        expect(migration).toContain('PayrollRuleConfigurationRevision_no_update');
        expect(migration).toContain('PayrollRuleConfigurationReview_no_delete');
    });

    it('applies the validated-rule lock to both configuration upload and review paths', () => {
        const uploadPath = service.slice(service.indexOf('static async uploadConfiguration'), service.indexOf('static async listConfigurationRevisions'));
        const reviewPath = service.slice(service.indexOf('static async reviewConfiguration'), service.indexOf('static async transition(id: number'));
        expect(uploadPath).toContain('assertRuleConfigurationMutable(rule)');
        expect(reviewPath).toContain('assertRuleConfigurationMutable(rule)');
    });

    it('freezes attendance dependencies and blocks reopening while a run is live', () => {
        expect(schema).toContain('model PayrollAttendanceDependency');
        expect(schema).toContain('summaryRevisions');
        expect(service).toContain('revalidateFrozenSources');
        expect(service).toContain('HR_PAYROLL_SOURCE_STALE');
        expect(workforce).toContain('HR_PERIOD_USED_BY_PAYROLL');
    });

    it('uses historical paid income for aguinaldo and durable coverage claims', () => {
        expect(service).toContain("method: 'HISTORICAL_PAID_COMPONENTS'");
        expect(service).toContain("run: { kind: 'REGULAR', status: 'PAID'");
        expect(service).toContain('MISSING_AGUINALDO_HISTORY');
        expect(schema).toContain('model PayrollCoverageClaim');
        expect(schema).toContain('model PayrollCoverageRelease');
        expect(service).toContain('DUPLICATE_COVERAGE');
        expect(schema).toContain('model PayrollAguinaldoSourceDependency');
        expect(schema).toContain('capturedComponentAmount');
        expect(service).toContain('HR_PAYROLL_AGUINALDO_SOURCE_STALE');
        expect(service).toContain('HR_PAYROLL_AGUINALDO_SOURCE_IN_USE');
        expect(service).toContain('payrollAguinaldoSourceDependency.create');
        expect(migration).toContain('PayrollAguinaldoDependency_no_update');
        expect(rollback).toContain('DROP TABLE IF EXISTS `PayrollAguinaldoSourceDependency`');
    });

    it('integrates benefits only into regular calculation and requires evidenced payment', () => {
        expect(service).toContain("if (kind === 'REGULAR') await projectBenefitDeductions");
        expect(service).toContain('await commitBenefitDeductions');
        expect(service).toContain('await reverseBenefitDeductions');
        for (const field of ['paymentReference', 'paymentDate', 'paymentMethod', 'evidenceReference']) expect(routes).toContain(field);
        expect(schema).toContain('model PayrollPaymentRecord');
    });

    it('keeps reversals and permission rollback safe and append-only', () => {
        expect(schema).toContain('model PayrollComponentReversal');
        expect(migration).toContain('PayrollComponentReversal_no_update');
        for (const field of ['reversalReference', 'reversalDate', 'reversalMethod', 'evidenceReference']) {
            expect(routes).toContain(field);
            expect(schema).toContain(field);
        }
        expect(service.indexOf('payrollRunReversal.create')).toBeLessThan(service.indexOf('await reverseBenefitDeductions'));
        expect(rollback).not.toContain('DELETE FROM `Permission`');
        expect(rollback).not.toContain('DELETE pr FROM `_PermissionToRole`');
    });

    it('keeps every payroll migration identifier within the MySQL 64-character limit', () => {
        const identifiers = [...migration.matchAll(/`([^`]+)`/g)].map(match => match[1]);
        expect(identifiers.filter(identifier => identifier.length > 64)).toEqual([]);
    });

    it('sets no-store and removes internal trace from self DTOs', () => {
        expect(routes).toContain("Cache-Control', 'no-store");
        expect(service).toContain('trace: selfSafe ? []');
        expect(controller).toContain('selfSafe: true');
    });
});
