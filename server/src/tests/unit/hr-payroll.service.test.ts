import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import {
    allowedPayrollActions,
    assertAguinaldoDependencyFresh,
    assertPayrollTransitionAllowed,
    assertRuleConfigurationMutable,
    assertRuleMetadataEditable,
    assertCompanyTaxProfileReady,
    assertConfigurationMatchesCompanyTaxProfile,
    buildPayrollReceiptPdfModel,
    HrPayrollError,
    PayrollReceiptService,
    compensationMinuteRate,
    reconcilePublishedShiftSummaries,
    normalizeFullCoverageSalary,
    ordinaryMinutesExcludingApprovedOvertime,
    paidReversalInput,
    validateLegalConfiguration,
} from '../../services/hr-payroll.service';
import {
    calculateStatutoryPayroll,
    effectiveIncomeTaxApplicability,
    paymentConceptDefinition,
    progressiveIncomeTax,
    type PayrollStatutoryConfiguration,
    type StatutoryCalculationInput,
} from '../../services/hr-payroll-statutory';

const statutory: PayrollStatutoryConfiguration = {
    companyTaxRegime: { code: 'GENERAL' as const, sourceReference: 'Ley 822', incomeTaxApplicability: 'APPLIES' as const },
    inss: {
        applicability: 'APPLIES' as const, sourceReference: 'INSS 2026', regime: 'INTEGRAL' as const,
        employeeRate: '0.07', employerRateBelowThreshold: '0.215', employerRateAtOrAboveThreshold: '0.225',
        employerSizeThreshold: 50, minimumMonthlyContributionBase: '10000', minimumBaseProration: 'PER_PAY_PERIOD_SERVICE_RATIO' as const,
        annualPeriods: { WEEKLY: 52, BIWEEKLY: 24, MONTHLY: 12 },
    },
    inatec: { applicability: 'APPLIES' as const, sourceReference: 'INATEC 2%', employerRate: '0.02' },
    incomeTax: {
        sourceReference: 'Ley 822 art. 23 y Decreto 01-2013 art. 19', regimeApplicabilityAcknowledged: true as const,
        calculationMethods: {
            fixed: 'FIXED_PERIOD_PROJECTION', salaryChange: 'FIXED_SALARY_CHANGE',
            variable: 'VARIABLE_ACCUMULATED', occasional: 'OCCASIONAL_INCREMENTAL',
        },
        inssEmployeeContributionDeductible: true as const,
        occasionalInssDeductionTreatment: 'DEDUCT_FROM_OCCASIONAL_NET' as const,
        adjustmentMode: 'WITHHOLD_OR_REFUND' as const,
        annualPeriods: { WEEKLY: 52, BIWEEKLY: 24, MONTHLY: 12 },
        brackets: [
            { lowerBound: '0', upperBound: '100000', baseTax: '0', rate: '0', excessOver: '0' },
            { lowerBound: '100000', upperBound: '200000', baseTax: '0', rate: '0.15', excessOver: '100000' },
            { lowerBound: '200000', upperBound: '350000', baseTax: '15000', rate: '0.20', excessOver: '200000' },
            { lowerBound: '350000', upperBound: '500000', baseTax: '45000', rate: '0.25', excessOver: '350000' },
            { lowerBound: '500000', upperBound: null, baseTax: '82500', rate: '0.30', excessOver: '500000' },
        ],
    },
    paymentConceptCatalog: [
        { code: 'INGRESO_ORDINARIO_FIJO', name: 'Ingreso ordinario fijo', type: 'INCOME', socialSecurityApplicable: true, trainingContributionApplicable: true, incomeTaxTreatment: 'REGULAR_FIXED', incomeTaxDeductible: false, sourceReference: 'Regla laboral' },
        { code: 'PERMISO_PAGADO_APROBADO', name: 'Permiso pagado', type: 'INCOME', socialSecurityApplicable: true, trainingContributionApplicable: true, incomeTaxTreatment: 'REGULAR_FIXED', incomeTaxDeductible: false, sourceReference: 'Regla laboral' },
        { code: 'INGRESO_ORDINARIO_VARIABLE', name: 'Ingreso ordinario variable', type: 'INCOME', socialSecurityApplicable: true, trainingContributionApplicable: true, incomeTaxTreatment: 'REGULAR_VARIABLE', incomeTaxDeductible: false, sourceReference: 'Regla laboral' },
        { code: 'HORAS_EXTRA_APROBADAS', name: 'Horas extra', type: 'INCOME', socialSecurityApplicable: true, trainingContributionApplicable: true, incomeTaxTreatment: 'REGULAR_VARIABLE', incomeTaxDeductible: false, sourceReference: 'Regla laboral' },
        { code: 'BONO_OCASIONAL', name: 'Bono ocasional', type: 'INCOME', socialSecurityApplicable: true, trainingContributionApplicable: true, incomeTaxTreatment: 'OCCASIONAL', incomeTaxDeductible: false, sourceReference: 'Regla laboral' },
        { code: 'VACACIONES_PAGADAS', name: 'Vacaciones pagadas', type: 'INCOME', socialSecurityApplicable: false, trainingContributionApplicable: false, incomeTaxTreatment: 'OCCASIONAL', incomeTaxDeductible: false, sourceReference: 'Regla laboral' },
        { code: 'INCENTIVO_OCASIONAL', name: 'Incentivo ocasional', type: 'INCOME', socialSecurityApplicable: false, trainingContributionApplicable: false, incomeTaxTreatment: 'OCCASIONAL', incomeTaxDeductible: false, sourceReference: 'Regla laboral' },
        { code: 'VIATICOS', name: 'Viáticos', type: 'INCOME', socialSecurityApplicable: false, trainingContributionApplicable: false, incomeTaxTreatment: null, incomeTaxDeductible: false, sourceReference: 'Política documentada' },
        { code: 'REEMBOLSO_DEPRECIACION', name: 'Reembolso depreciación', type: 'INCOME', socialSecurityApplicable: false, trainingContributionApplicable: false, incomeTaxTreatment: null, incomeTaxDeductible: false, sourceReference: 'Política documentada' },
        { code: 'FONDO_PENSION_AUTORIZADO', name: 'Fondo autorizado', type: 'DEDUCTION', socialSecurityApplicable: false, trainingContributionApplicable: false, incomeTaxTreatment: null, incomeTaxDeductible: true, sourceReference: 'Deducción autorizada' },
        { code: 'APORTE_AHORRO_AUTORIZADO', name: 'Ahorro autorizado', type: 'DEDUCTION', socialSecurityApplicable: false, trainingContributionApplicable: false, incomeTaxTreatment: null, incomeTaxDeductible: true, sourceReference: 'Deducción autorizada' },
    ],
};

function statutoryInput(overrides: Partial<StatutoryCalculationInput> = {}): StatutoryCalculationInput {
    return {
        inssContributionBase: '0', regularInssContributionBase: '0', occasionalInssContributionBase: '0',
        inatecContributionBase: '0', fixedIncomeTaxGross: '0', variableIncomeTaxGross: '0', occasionalIncomeTaxGross: '0',
        otherIncomeTaxDeductions: '0', priorRegularIncomeTaxNet: '0', priorOccasionalIncomeTaxNet: '0',
        priorRegularIncomeTaxWithheld: '0', priorOccasionalIncomeTaxWithheld: '0',
        currentFixedCompensationAmount: '0', latestFixedCompensationAmount: '0', latestRegularIncomeTaxNet: '0',
        priorFixedSalaryChangeActive: false, priorFixedSalaryChangeAnnualProjection: '0', priorHadVariableIncome: false,
        employerRefundAllowed: false, elapsedFiscalMonths: 1, priorPeriods: 0, payFrequency: 'MONTHLY', employerHeadcount: 10, serviceRatio: '1',
        ...overrides,
    };
}

const legalConfiguration = {
    schema: 'HR_PAYROLL_PARAMETRIC_V4' as const, legallyValidated: true as const, currency: 'NIO',
    regular: { minuteDivisors: { WEEKLY: '2400', BIWEEKLY: '4800', MONTHLY: '9600' }, overtimeMultiplier: '2', paidLeaveUnitMinutes: { DAYS: '480', HOURS: '60', MINUTES: '1' } },
    aguinaldo: { method: 'HISTORICAL_PAID_COMPONENTS' as const, lookbackDays: 365, incomeDivisor: '12', prorationMode: 'NONE' as const, eligibleSources: ['RULE'], roundingScale: 2 as const },
    statutory,
};

describe('HR payroll safety and state machine', () => {
    it('fails closed when a legal configuration is absent or incomplete', () => {
        expect(() => validateLegalConfiguration(null)).toThrow('configuración legal validada');
        expect(() => validateLegalConfiguration({ schema: 'HR_PAYROLL_PARAMETRIC_V3', legallyValidated: true })).toThrow(HrPayrollError);
    });

    it('accepts only an explicit, fully parameterized and legally validated configuration', () => {
        const config = validateLegalConfiguration(legalConfiguration);
        expect(config.currency).toBe('NIO');
        expect(effectiveIncomeTaxApplicability(config.statutory)).toBe('APPLIES');
        expect(paymentConceptDefinition(config.statutory, 'VIATICOS')).toEqual(expect.objectContaining({
            socialSecurityApplicable: false,
            incomeTaxTreatment: null,
        }));
        expect(paymentConceptDefinition(config.statutory, 'REEMBOLSO_DEPRECIACION')).toEqual(expect.objectContaining({
            socialSecurityApplicable: false,
            incomeTaxTreatment: null,
        }));
    });

    it('keeps inactive concepts for history but excludes them from new payroll selection', () => {
        const inactive = {
            ...statutory,
            paymentConceptCatalog: statutory.paymentConceptCatalog.map((concept) => concept.code === 'VIATICOS'
                ? { ...concept, active: false }
                : concept),
        };
        expect(paymentConceptDefinition(inactive, 'VIATICOS')).toBeNull();
        expect(inactive.paymentConceptCatalog.find((concept) => concept.code === 'VIATICOS')).toBeDefined();
    });

    it('fails closed for a pending or stale company fiscal profile', () => {
        const pendingProfile = {
            payrollTaxRegime: 'GENERAL',
            payrollIncomeTaxWithholding: true,
            payrollTaxRegimeReference: 'Perfil pendiente',
            payrollIncomeTaxException: null,
            payrollTaxProfileReady: false,
        };
        expect(() => assertCompanyTaxProfileReady(pendingProfile)).toThrow('Completa y confirma');

        const readyProfile = { ...pendingProfile, payrollTaxProfileReady: true, payrollTaxRegimeReference: 'Constancia DGI 2026' };
        expect(() => assertConfigurationMatchesCompanyTaxProfile(legalConfiguration, readyProfile)).toThrow('cambió');
        expect(() => assertConfigurationMatchesCompanyTaxProfile(legalConfiguration, {
            ...readyProfile,
            payrollTaxRegimeReference: legalConfiguration.statutory.companyTaxRegime.sourceReference,
        })).not.toThrow();
    });

    it('normalizes a frozen V3 configuration for historical reads while requiring V4 for new uploads', () => {
        const legacyIncomeTax: Record<string, unknown> = {
            ...statutory.incomeTax,
            applicability: 'APPLIES',
            regimeIndependenceAcknowledged: true,
            fixedTaxableComponentCodes: ['INGRESO_ORDINARIO_FIJO', 'PERMISO_PAGADO_APROBADO'],
            variableTaxableComponentCodes: ['INGRESO_ORDINARIO_VARIABLE', 'HORAS_EXTRA_APROBADAS'],
            occasionalTaxableComponentCodes: ['BONO_OCASIONAL'],
            authorizedDeductionComponentCodes: ['FONDO_PENSION_AUTORIZADO', 'APORTE_AHORRO_AUTORIZADO'],
        };
        delete legacyIncomeTax.regimeApplicabilityAcknowledged;
        const legacyStatutory: Record<string, unknown> = {
            ...statutory,
            companyTaxRegime: { code: 'GENERAL', sourceReference: 'Ley 822' },
            inss: { ...statutory.inss, contributionComponentCodes: ['INGRESO_ORDINARIO_FIJO', 'INGRESO_ORDINARIO_VARIABLE', 'HORAS_EXTRA_APROBADAS', 'BONO_OCASIONAL'] },
            inatec: { ...statutory.inatec, contributionComponentCodes: ['INGRESO_ORDINARIO_FIJO', 'INGRESO_ORDINARIO_VARIABLE', 'HORAS_EXTRA_APROBADAS', 'BONO_OCASIONAL'] },
            incomeTax: legacyIncomeTax,
        };
        delete legacyStatutory.paymentConceptCatalog;
        const legacy = { ...legalConfiguration, schema: 'HR_PAYROLL_PARAMETRIC_V3', statutory: legacyStatutory };
        const normalized = validateLegalConfiguration(legacy);
        expect(normalized.schema).toBe('HR_PAYROLL_PARAMETRIC_V4');
        expect(normalized.statutory.paymentConceptCatalog).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'INGRESO_ORDINARIO_FIJO', incomeTaxTreatment: 'REGULAR_FIXED' }),
        ]));
        expect(() => validateLegalConfiguration(legacy, { requireCurrentSchema: true })).toThrow('HR_PAYROLL_PARAMETRIC_V4');
    });

    it('normalizes deprecated early-V4 aliases only for immutable historical reads', () => {
        const deprecated = {
            ...legalConfiguration,
            aguinaldo: { ...legalConfiguration.aguinaldo, prorationMode: 'SERVICE_DAYS' },
            statutory: {
                ...statutory,
                paymentConceptCatalog: statutory.paymentConceptCatalog.map(concept => {
                    if (concept.code === 'VIATICOS') return { ...concept, incomeTaxTreatment: 'EXEMPT' };
                    if (concept.type === 'DEDUCTION') return { ...concept, incomeTaxTreatment: 'NONE' };
                    return concept;
                }),
            },
        };
        const normalized = validateLegalConfiguration(deprecated);
        expect(normalized.aguinaldo.prorationMode).toBe('SERVICE_DAYS_RATIO');
        expect(paymentConceptDefinition(normalized.statutory, 'VIATICOS')?.incomeTaxTreatment).toBeNull();
        expect(paymentConceptDefinition(normalized.statutory, 'FONDO_PENSION_AUTORIZADO')?.incomeTaxTreatment).toBeNull();
        expect(() => validateLegalConfiguration(deprecated, { requireCurrentSchema: true })).toThrow('configuración legal validada');
    });
    it('rejects duplicate payment concept codes', () => {
        const ambiguous = {
            ...legalConfiguration,
            statutory: {
                ...statutory,
                paymentConceptCatalog: [...statutory.paymentConceptCatalog, { ...statutory.paymentConceptCatalog[0] }],
            },
        };
        expect(() => validateLegalConfiguration(ambiguous)).toThrow(HrPayrollError);
    });

    it('rejects allocating occasional INSS to the annualized regular net', () => {
        const invalid = {
            ...legalConfiguration,
            statutory: {
                ...statutory,
                incomeTax: { ...statutory.incomeTax, occasionalInssDeductionTreatment: 'DEDUCT_FROM_REGULAR_NET' },
            },
        };
        expect(() => validateLegalConfiguration(invalid)).toThrow(HrPayrollError);
    });

    it('treats HOURLY as amount per hour and SALARY through validated divisors', () => {
        const config = validateLegalConfiguration(legalConfiguration);
        expect(compensationMinuteRate({ compensationType: 'HOURLY', amount: new Prisma.Decimal('120'), payFrequency: 'WEEKLY' }, config).toString()).toBe('2');
        expect(compensationMinuteRate({ compensationType: 'SALARY', amount: new Prisma.Decimal('2400'), payFrequency: 'WEEKLY' }, config).toString()).toBe('1');
    });

    it('keeps a full-attendance salary fixed and excludes approved overtime from ordinary minutes', () => {
        expect(ordinaryMinutesExcludingApprovedOvertime({ ordinaryMinutes: 540, approvedOvertimeMinutes: 60 })).toBe(480);
        expect(normalizeFullCoverageSalary({
            contractualAmount: new Prisma.Decimal('20000'),
            ordinaryEarnings: new Prisma.Decimal('21000'),
            paidLeaveEarnings: new Prisma.Decimal('0'),
            fullScheduledAttendance: true,
            fullyCoveredByPaidLeave: false,
        })).toEqual({
            ordinaryEarnings: new Prisma.Decimal('20000'),
            paidLeaveEarnings: new Prisma.Decimal('0'),
        });
        const capped = normalizeFullCoverageSalary({
            contractualAmount: new Prisma.Decimal('20000'),
            ordinaryEarnings: new Prisma.Decimal('18000'),
            paidLeaveEarnings: new Prisma.Decimal('4000'),
            fullScheduledAttendance: false,
            fullyCoveredByPaidLeave: false,
        });
        expect(capped.ordinaryEarnings.toFixed(2)).toBe('16000.00');
        expect(capped.paidLeaveEarnings.toFixed(2)).toBe('4000.00');
    });

    it('requires every effective published shift scope before normalizing a fixed salary', () => {
        const shifts = Array.from({ length: 21 }, (_, index) => {
            const day = String(index + 1).padStart(2, '0');
            return {
                scheduleId: 10, scheduleRevision: 3, scheduleStatus: 'PUBLISHED', shiftId: 100 + index,
                startAt: `2026-01-${day}T14:00:00.000Z`, endAt: `2026-01-${day}T22:00:00.000Z`,
                breakMinutes: 0, paidBreak: false, branchId: 4,
                timezoneSnapshot: 'America/Managua', branchTimezone: 'America/Managua', localDate: `2026-01-${day}`,
                originalUserId: index === 0 ? 99 : 7, effectiveUserId: 7,
                overrideId: index === 0 ? 500 : null, overrideEffectiveAt: index === 0 ? '2025-12-20T00:00:00.000Z' : null,
            };
        });
        const summaries = shifts.map(shift => ({
            date: new Date(`${shift.localDate}T00:00:00.000Z`), branchId: 4, scopeKey: 'BRANCH:4',
            scheduledMinutes: 480, ordinaryMinutes: 480, approvedOvertimeMinutes: 0,
        }));
        expect(reconcilePublishedShiftSummaries(shifts, summaries)).toEqual({
            expectedScopeCount: 21, incompleteScopes: [], fullScheduledAttendance: true,
        });
        const subset = reconcilePublishedShiftSummaries(shifts, summaries.slice(0, 20));
        expect(subset.incompleteScopes).toEqual(['2026-01-21:BRANCH:4']);
        expect(subset.fullScheduledAttendance).toBe(false);
        const zero = reconcilePublishedShiftSummaries(shifts, [
            { ...summaries[0], scheduledMinutes: 0, ordinaryMinutes: 0 }, ...summaries.slice(1),
        ]);
        expect(zero.incompleteScopes).toContain('2026-01-01:BRANCH:4');
        expect(zero.fullScheduledAttendance).toBe(false);
    });

    it('calculates INSS, INATEC and progressive IR with auditable decimal results', () => {
        const result = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '10000', regularInssContributionBase: '10000', inatecContributionBase: '10000',
            fixedIncomeTaxGross: '10000', currentFixedCompensationAmount: '10000', employerHeadcount: 49,
        }));
        expect(result.employeeInss.toFixed(2)).toBe('700.00');
        expect(result.employerInss.toFixed(2)).toBe('2150.00');
        expect(result.employerInatec.toFixed(2)).toBe('200.00');
        expect(result.annualProjection.toFixed(2)).toBe('111600.00');
        expect(result.currentIncomeTaxWithholding.toFixed(2)).toBe('145.00');
        expect(result.incomeTaxMethod).toBe('FIXED_PERIOD_PROJECTION');
    });

    it('uses accumulated-variable treatment for a partial fixed-salary period instead of annualizing the absence', () => {
        const result = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '15000', regularInssContributionBase: '15000',
            fixedIncomeTaxGross: '15000', currentFixedCompensationAmount: '20000',
            latestFixedCompensationAmount: '20000', latestRegularIncomeTaxNet: '18600',
            priorRegularIncomeTaxNet: '18600', priorRegularIncomeTaxWithheld: '1636.67',
            priorPeriods: 1, elapsedFiscalMonths: 2,
        }));
        expect(result.incomeTaxMethod).toBe('VARIABLE_ACCUMULATED');
        expect(result.annualProjection.toFixed(2)).toBe('195300.00');
    });

    it('keeps a partial period variable when compensation also changed', () => {
        const result = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '15000', regularInssContributionBase: '15000',
            fixedIncomeTaxGross: '15000', currentFixedCompensationAmount: '20000',
            latestFixedCompensationAmount: '10000', latestRegularIncomeTaxNet: '9300',
            priorRegularIncomeTaxNet: '9300', priorRegularIncomeTaxWithheld: '145',
            priorPeriods: 1, elapsedFiscalMonths: 2,
        }));
        expect(result.incomeTaxMethod).toBe('VARIABLE_ACCUMULATED');
        expect(result.currentRegularIncomeTaxNet.toFixed(2)).toBe('13950.00');
        expect(result.annualProjection.toFixed(2)).toBe('139500.00');
    });

    it('treats regular net without fixed compensation as variable', () => {
        const withoutContributions: PayrollStatutoryConfiguration = {
            ...statutory,
            inss: { ...statutory.inss, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
            inatec: { ...statutory.inatec, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
        };
        const result = calculateStatutoryPayroll(withoutContributions, statutoryInput({
            fixedIncomeTaxGross: '5000', currentFixedCompensationAmount: '0',
            elapsedFiscalMonths: 1, payFrequency: 'BIWEEKLY',
        }));
        expect(result.incomeTaxMethod).toBe('VARIABLE_ACCUMULATED');
        expect(result.currentRegularIncomeTaxNet.toFixed(2)).toBe('5000.00');
        expect(result.annualProjection.toFixed(2)).toBe('60000.00');
    });

    it('uses the 50-employee threshold and disables labor IR when the configured simplified regime says it does not apply', () => {
        const simplified = { ...statutory, companyTaxRegime: { code: 'SIMPLIFIED_FIXED_QUOTA' as const, sourceReference: 'Cuota fija', incomeTaxApplicability: 'DOES_NOT_APPLY' as const, incomeTaxExceptionReason: 'Regla validada para régimen simplificado' } };
        const result = calculateStatutoryPayroll(simplified, statutoryInput({
            inssContributionBase: '10000', regularInssContributionBase: '10000', inatecContributionBase: '10000',
            fixedIncomeTaxGross: '10000', currentFixedCompensationAmount: '10000', employerHeadcount: 50,
        }));
        expect(result.employerInssRate.toString()).toBe('0.225');
        expect(result.employerInss.toFixed(2)).toBe('2250.00');
        expect(result.currentIncomeTaxWithholding.toFixed(2)).toBe('0.00');
        expect(result.annualIncomeTax.toFixed(2)).toBe('0.00');
    });

    it('applies every progressive bracket boundary and records, but does not auto-refund, a mid-year credit', () => {
        expect(progressiveIncomeTax('100000', statutory.incomeTax.brackets).tax.toFixed(2)).toBe('0.00');
        expect(progressiveIncomeTax('100000.01', statutory.incomeTax.brackets).tax.toFixed(2)).toBe('0.00');
        expect(progressiveIncomeTax('200000', statutory.incomeTax.brackets).tax.toFixed(2)).toBe('15000.00');
        expect(progressiveIncomeTax('350000', statutory.incomeTax.brackets).tax.toFixed(2)).toBe('45000.00');
        expect(progressiveIncomeTax('500000', statutory.incomeTax.brackets).tax.toFixed(2)).toBe('82500.00');
        const result = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '10000', regularInssContributionBase: '10000', inatecContributionBase: '10000',
            variableIncomeTaxGross: '10000', priorRegularIncomeTaxNet: '9300', priorRegularIncomeTaxWithheld: '1000',
            priorHadVariableIncome: true, elapsedFiscalMonths: 2, priorPeriods: 1,
        }));
        expect(result.currentIncomeTaxWithholding.toFixed(2)).toBe('0.00');
        expect(result.incomeTaxCreditBalance.greaterThan(0)).toBe(true);
        expect(result.incomeTaxRefund.toFixed(2)).toBe('0.00');
    });

    it('deducts only explicitly authorized non-INSS deductions from the IR base', () => {
        const result = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '20000', regularInssContributionBase: '20000', inatecContributionBase: '20000',
            fixedIncomeTaxGross: '20000', otherIncomeTaxDeductions: '1000', currentFixedCompensationAmount: '20000',
        }));
        expect(result.employeeInss.toFixed(2)).toBe('1400.00');
        expect(result.otherIncomeTaxDeductions.toFixed(2)).toBe('1000.00');
        expect(result.currentIncomeTaxNet.toFixed(2)).toBe('17600.00');
        expect(result.currentIncomeTaxWithholding.toFixed(2)).toBe('1436.67');
    });

    it('reconciles cent rounding across fixed monthly and quincenal periods', () => {
        const firstMonthly = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '20000', regularInssContributionBase: '20000',
            fixedIncomeTaxGross: '20000', currentFixedCompensationAmount: '20000',
        }));
        const secondMonthly = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '20000', regularInssContributionBase: '20000',
            fixedIncomeTaxGross: '20000', currentFixedCompensationAmount: '20000', latestFixedCompensationAmount: '20000',
            priorRegularIncomeTaxNet: '18600', latestRegularIncomeTaxNet: '18600', priorRegularIncomeTaxWithheld: firstMonthly.currentIncomeTaxWithholding,
            priorPeriods: 1,
        }));
        expect(firstMonthly.currentIncomeTaxWithholding.toFixed(2)).toBe('1636.67');
        expect(secondMonthly.currentIncomeTaxWithholding.toFixed(2)).toBe('1636.66');
        expect(firstMonthly.currentIncomeTaxWithholding.plus(secondMonthly.currentIncomeTaxWithholding).toFixed(2)).toBe('3273.33');

        const firstQuincenal = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '10000', regularInssContributionBase: '10000', fixedIncomeTaxGross: '10000',
            currentFixedCompensationAmount: '10000', payFrequency: 'BIWEEKLY',
        }));
        const secondQuincenal = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '10000', regularInssContributionBase: '10000', fixedIncomeTaxGross: '10000',
            currentFixedCompensationAmount: '10000', latestFixedCompensationAmount: '10000',
            priorRegularIncomeTaxNet: '9300', latestRegularIncomeTaxNet: '9300', priorRegularIncomeTaxWithheld: firstQuincenal.currentIncomeTaxWithholding,
            priorPeriods: 1, payFrequency: 'BIWEEKLY',
        }));
        expect(firstQuincenal.currentIncomeTaxWithholding.toFixed(2)).toBe('818.33');
        expect(secondQuincenal.currentIncomeTaxWithholding.toFixed(2)).toBe('818.34');
    });

    it('adds the full marginal IR of an occasional payment without contaminating regular accumulation', () => {
        const result = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '50000', regularInssContributionBase: '20000', occasionalInssContributionBase: '30000',
            inatecContributionBase: '50000', fixedIncomeTaxGross: '20000', occasionalIncomeTaxGross: '30000',
            currentFixedCompensationAmount: '20000',
        }));
        expect(result.currentRegularIncomeTaxNet.toFixed(2)).toBe('18600.00');
        expect(result.currentOccasionalIncomeTaxNet.toFixed(2)).toBe('27900.00');
        expect(result.regularIncomeTaxWithholding.toFixed(2)).toBe('1636.67');
        expect(result.occasionalIncomeTaxWithholding.toFixed(2)).toBe('5580.00');
        expect(result.currentIncomeTaxWithholding.toFixed(2)).toBe('7216.67');
        expect(result.accumulatedIncomeTaxNet.toFixed(2)).toBe('18600.00');
    });

    it('keeps both variable quincenas in the same elapsed fiscal month', () => {
        const variableConfig: PayrollStatutoryConfiguration = {
            ...statutory,
            inss: { ...statutory.inss, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
            inatec: { ...statutory.inatec, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
        };
        const firstQuincena = calculateStatutoryPayroll(variableConfig, statutoryInput({
            variableIncomeTaxGross: '4650', elapsedFiscalMonths: 1, payFrequency: 'BIWEEKLY',
        }));
        const secondQuincena = calculateStatutoryPayroll(variableConfig, statutoryInput({
            variableIncomeTaxGross: '4650', priorRegularIncomeTaxNet: '4650', priorHadVariableIncome: true,
            priorRegularIncomeTaxWithheld: firstQuincena.currentIncomeTaxWithholding,
            elapsedFiscalMonths: 1, priorPeriods: 1, payFrequency: 'BIWEEKLY',
        }));
        expect(firstQuincena.incomeTaxMethod).toBe('VARIABLE_ACCUMULATED');
        expect(firstQuincena.elapsedFiscalMonths).toBe(1);
        expect(secondQuincena.elapsedFiscalMonths).toBe(1);
        expect(firstQuincena.annualProjection.toFixed(2)).toBe('55800.00');
        expect(secondQuincena.annualProjection.toFixed(2)).toBe('111600.00');
        expect(secondQuincena.currentIncomeTaxWithholding.toFixed(2)).toBe('145.00');
        expect(() => calculateStatutoryPayroll(variableConfig, statutoryInput({
            variableIncomeTaxGross: '4650', elapsedFiscalMonths: 0.5, payFrequency: 'BIWEEKLY',
        }))).toThrow('conteo entero de meses fiscales');
    });

    it('computes a second occasional payment only over its marginal increment', () => {
        const result = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '30000', regularInssContributionBase: '20000', occasionalInssContributionBase: '10000',
            fixedIncomeTaxGross: '20000', occasionalIncomeTaxGross: '10000', currentFixedCompensationAmount: '20000',
            priorOccasionalIncomeTaxNet: '27900',
        }));
        expect(result.currentOccasionalIncomeTaxNet.toFixed(2)).toBe('9300.00');
        expect(result.occasionalIncomeTaxWithholding.toFixed(2)).toBe('1860.00');
        expect(result.annualIncomeTaxWithOccasional.toFixed(2)).toBe('27080.00');
    });

    it('uses the accumulated average for variable income and carries negative adjustments as credits', () => {
        const variableConfig: PayrollStatutoryConfiguration = {
            ...statutory,
            inss: { ...statutory.inss, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
            inatec: { ...statutory.inatec, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
        };
        const month1 = calculateStatutoryPayroll(variableConfig, statutoryInput({ variableIncomeTaxGross: '10000', elapsedFiscalMonths: 1 }));
        const month2 = calculateStatutoryPayroll(variableConfig, statutoryInput({
            variableIncomeTaxGross: '20000', priorRegularIncomeTaxNet: '10000', priorRegularIncomeTaxWithheld: '250',
            priorHadVariableIncome: true, elapsedFiscalMonths: 2, priorPeriods: 1,
        }));
        const month3 = calculateStatutoryPayroll(variableConfig, statutoryInput({
            variableIncomeTaxGross: '5000', priorRegularIncomeTaxNet: '30000', priorRegularIncomeTaxWithheld: '2000',
            priorHadVariableIncome: true, elapsedFiscalMonths: 3, priorPeriods: 2,
        }));
        const month4 = calculateStatutoryPayroll(variableConfig, statutoryInput({
            variableIncomeTaxGross: '20000', priorRegularIncomeTaxNet: '35000', priorRegularIncomeTaxWithheld: '2000',
            priorHadVariableIncome: true, elapsedFiscalMonths: 4, priorPeriods: 3,
        }));
        expect(month1.currentIncomeTaxWithholding.toFixed(2)).toBe('250.00');
        expect(month2.currentIncomeTaxWithholding.toFixed(2)).toBe('1750.00');
        expect(month3.currentIncomeTaxWithholding.toFixed(2)).toBe('0.00');
        expect(month3.incomeTaxCreditBalance.toFixed(2)).toBe('500.00');
        expect(month3.incomeTaxRefund.toFixed(2)).toBe('0.00');
        expect(month4.currentIncomeTaxWithholding.toFixed(2)).toBe('1250.00');
    });

    it('nets a negative regular adjustment against current occasional IR before carrying a credit', () => {
        const variableConfig: PayrollStatutoryConfiguration = {
            ...statutory,
            inss: { ...statutory.inss, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
            inatec: { ...statutory.inatec, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
        };
        const result = calculateStatutoryPayroll(variableConfig, statutoryInput({
            variableIncomeTaxGross: '5000', occasionalIncomeTaxGross: '10000',
            priorRegularIncomeTaxNet: '30000', priorRegularIncomeTaxWithheld: '2000',
            priorHadVariableIncome: true, elapsedFiscalMonths: 3, priorPeriods: 2,
        }));
        expect(result.regularIncomeTaxWithholding.toFixed(2)).toBe('0.00');
        expect(result.occasionalIncomeTaxWithholding.toFixed(2)).toBe('1000.00');
        expect(result.currentIncomeTaxWithholding.toFixed(2)).toBe('1000.00');
        expect(result.incomeTaxCreditBalance.toFixed(2)).toBe('0.00');
    });

    it('reprojects a fixed salary increase over the remaining fiscal periods', () => {
        const result = calculateStatutoryPayroll(statutory, statutoryInput({
            inssContributionBase: '25000', regularInssContributionBase: '25000', fixedIncomeTaxGross: '25000',
            currentFixedCompensationAmount: '25000', latestFixedCompensationAmount: '15000',
            priorRegularIncomeTaxNet: '83700', priorRegularIncomeTaxWithheld: '5055', priorPeriods: 6,
        }));
        expect(result.incomeTaxMethod).toBe('FIXED_SALARY_CHANGE');
        expect(result.annualProjection.toFixed(2)).toBe('223200.00');
        expect(result.regularAnnualIncomeTax.toFixed(2)).toBe('19640.00');
        expect(result.currentIncomeTaxWithholding.toFixed(2)).toBe('2430.83');
    });

    it('includes prior occasional income and withholding in a fixed salary change', () => {
        const withoutContributions: PayrollStatutoryConfiguration = {
            ...statutory,
            inss: { ...statutory.inss, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
            inatec: { ...statutory.inatec, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
        };
        const result = calculateStatutoryPayroll(withoutContributions, statutoryInput({
            fixedIncomeTaxGross: '20000', currentFixedCompensationAmount: '20000', latestFixedCompensationAmount: '10000',
            priorRegularIncomeTaxNet: '10000', priorOccasionalIncomeTaxNet: '100000',
            priorRegularIncomeTaxWithheld: '250', priorOccasionalIncomeTaxWithheld: '16000', priorPeriods: 1,
        }));
        expect(result.incomeTaxMethod).toBe('FIXED_SALARY_CHANGE');
        expect(result.annualProjection.toFixed(2)).toBe('230000.00');
        expect(result.regularAnnualIncomeTax.toFixed(2)).toBe('21000.00');
        expect(result.annualIncomeTaxWithOccasional.toFixed(2)).toBe('41000.00');
        expect(result.currentIncomeTaxWithholding.toFixed(2)).toBe('2250.00');
    });

    it('permits an employer refund only when the caller confirms the complete annual liquidation', () => {
        const pending = statutoryInput({
            inssContributionBase: '10000', regularInssContributionBase: '10000', variableIncomeTaxGross: '10000',
            priorRegularIncomeTaxNet: '111600', priorRegularIncomeTaxWithheld: '5000',
            priorHadVariableIncome: true, elapsedFiscalMonths: 12, priorPeriods: 11,
        });
        const withoutAuthorization = calculateStatutoryPayroll(statutory, pending);
        const annualLiquidation = calculateStatutoryPayroll(statutory, { ...pending, employerRefundAllowed: true });
        expect(withoutAuthorization.incomeTaxRefund.toFixed(2)).toBe('0.00');
        expect(annualLiquidation.incomeTaxRefund.toFixed(2)).toBe(annualLiquidation.incomeTaxCreditBalance.toFixed(2));
    });

    it('reconciles prior occasional withholding inside the complete annual liquidation', () => {
        const variableConfig: PayrollStatutoryConfiguration = {
            ...statutory,
            inss: { ...statutory.inss, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
        };
        const result = calculateStatutoryPayroll(variableConfig, statutoryInput({
            variableIncomeTaxGross: '10000', priorRegularIncomeTaxNet: '110000', priorOccasionalIncomeTaxNet: '30000',
            priorRegularIncomeTaxWithheld: '4000', priorOccasionalIncomeTaxWithheld: '6000',
            priorHadVariableIncome: true, employerRefundAllowed: true, elapsedFiscalMonths: 12, priorPeriods: 11,
        }));
        expect(result.annualProjection.toFixed(2)).toBe('120000.00');
        expect(result.annualIncomeTaxWithOccasional.toFixed(2)).toBe('7500.00');
        expect(result.currentIncomeTaxWithholding.toFixed(2)).toBe('0.00');
        expect(result.incomeTaxCreditBalance.toFixed(2)).toBe('2500.00');
        expect(result.incomeTaxRefund.toFixed(2)).toBe('2500.00');
    });

    it('uses actual accumulated fixed income for the annual liquidation after an absence', () => {
        const withoutContributions: PayrollStatutoryConfiguration = {
            ...statutory,
            inss: { ...statutory.inss, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
            inatec: { ...statutory.inatec, applicability: 'DOES_NOT_APPLY', exceptionReason: 'Vector neto aislado' },
        };
        const result = calculateStatutoryPayroll(withoutContributions, statutoryInput({
            fixedIncomeTaxGross: '5000', currentFixedCompensationAmount: '10000', latestFixedCompensationAmount: '10000',
            priorRegularIncomeTaxNet: '110000', priorRegularIncomeTaxWithheld: '2750',
            employerRefundAllowed: true, elapsedFiscalMonths: 12, priorPeriods: 11,
        }));
        expect(result.incomeTaxMethod).toBe('VARIABLE_ACCUMULATED');
        expect(result.annualProjection.toFixed(2)).toBe('115000.00');
        expect(result.accumulatedIncomeTaxNet.toFixed(2)).toBe('115000.00');
        expect(result.annualIncomeTax.toFixed(2)).toBe('2250.00');
        expect(result.currentIncomeTaxWithholding.toFixed(2)).toBe('0.00');
        expect(result.incomeTaxRefund.toFixed(2)).toBe('500.00');
    });

    it('reproduces the attached Sep-Dec variable-income example as zero IR under the current 7% employee rate', () => {
        const withoutMinimum = { ...statutory, inss: { ...statutory.inss, minimumMonthlyContributionBase: '0' } };
        const gross = ['6000.74', '9958.68', '9352.22', '8745.76'];
        let priorNet = new Prisma.Decimal(0);
        let priorWithheld = new Prisma.Decimal(0);
        gross.forEach((amount, index) => {
            const result = calculateStatutoryPayroll(withoutMinimum, statutoryInput({
                inssContributionBase: amount, regularInssContributionBase: amount, variableIncomeTaxGross: amount,
                priorRegularIncomeTaxNet: priorNet, priorRegularIncomeTaxWithheld: priorWithheld,
                priorHadVariableIncome: index > 0, elapsedFiscalMonths: index + 1, priorPeriods: index,
            }));
            expect(result.currentIncomeTaxWithholding.toFixed(2)).toBe('0.00');
            priorNet = priorNet.plus(result.currentRegularIncomeTaxNet);
            priorWithheld = priorWithheld.plus(result.currentIncomeTaxWithholding);
        });
        expect(priorNet.toFixed(2)).toBe('31673.38');
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

describe('HR payroll receipt document', () => {
    const input = {
        id: 87,
        runKind: 'REGULAR' as const,
        runCode: 'NOM-2026-07-Q1',
        periodLabel: '01 al 15 de julio de 2026',
        payDate: '2026-07-16',
        currency: 'NIO',
        grossIncome: '34650.00',
        totalDeductions: '8434.50',
        netPay: '26215.50',
        status: 'PUBLISHED',
        legalName: 'Ana López',
        employeeCode: 'EMP-001',
        companyName: 'La Mía Pizza',
        companyRuc: 'J0310000000000',
        components: [
            { code: 'SALARIO', name: 'Salario ordinario', type: 'INCOME' as const, amount: '30000.00' },
            { code: 'HORAS_EXTRA', name: 'Horas extra', type: 'INCOME' as const, amount: '4650.00', reason: '12 horas aprobadas' },
            { code: 'INSS_LABORAL', name: 'INSS laboral', type: 'DEDUCTION' as const, amount: '2425.50' },
            { code: 'IR_LABORAL', name: 'IR laboral', type: 'DEDUCTION' as const, amount: '6009.00' },
        ],
        employerContributions: [
            { code: 'INSS_PATRONAL', name: 'INSS patronal', baseAmount: '34650.00', rate: '0.215', amount: '7449.75' },
            { code: 'INATEC', name: 'INATEC patronal', baseAmount: '34650.00', rate: '0.02', amount: '693.00' },
        ],
    };

    it('structures employee, period, income, deduction, employer contribution and net sections', () => {
        const model = buildPayrollReceiptPdfModel(input);
        expect(model.company).toEqual({ name: 'La Mía Pizza', ruc: 'J0310000000000' });
        expect(model.document.kind).toBe('Nómina ordinaria');
        expect(model.document.verificationCode).toMatch(/^[A-F0-9]{16}$/);
        expect(model.employee).toEqual({ name: 'Ana López', code: 'EMP-001' });
        expect(model.period.runCode).toBe('NOM-2026-07-Q1');
        expect(model.incomes.map(item => item.concept)).toEqual(['Salario ordinario', 'Horas extra']);
        expect(model.incomes[1].reference).toBe('12 horas aprobadas');
        expect(model.deductions.map(item => item.concept)).toEqual(['INSS laboral', 'IR laboral']);
        expect(model.employerContributions.map(item => item.concept)).toEqual(['INSS patronal', 'INATEC patronal']);
        expect(model.employerContributions[0].rate).toBe('21.5%');
        expect(model.totals.net).toContain('26');
        expect(model.notes.join(' ')).toContain('no reducen el neto');
    });

    it('keeps the validation code deterministic and changes it when an issued total changes', () => {
        const original = buildPayrollReceiptPdfModel(input).document.verificationCode;
        expect(buildPayrollReceiptPdfModel(input).document.verificationCode).toBe(original);
        expect(buildPayrollReceiptPdfModel({ ...input, netPay: '26215.51' }).document.verificationCode).not.toBe(original);
    });

    it('renders a valid PDF document with an employee-specific filename', async () => {
        const get = jest.spyOn(PayrollReceiptService, 'get').mockResolvedValue(input as never);
        const result = await PayrollReceiptService.pdf(3, input.id, { publishedOnly: true });
        expect(get).toHaveBeenCalledWith(3, input.id, { publishedOnly: true });
        expect(result.contentType).toBe('application/pdf');
        expect(result.filename).toBe('colilla-EMP-001-87.pdf');
        expect(result.buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
        expect(result.buffer.length).toBeGreaterThan(4_000);
        get.mockRestore();
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
    const statutoryMigration = fs.readFileSync(path.join(root, 'prisma/migrations/20260715_hr_statutory_payroll_v2/migration.sql'), 'utf8');
    const incomeTaxMigration = fs.readFileSync(path.join(root, 'prisma/migrations/20260715_hr_statutory_payroll_v3_art19/migration.sql'), 'utf8');
    const incomeTaxRollback = fs.readFileSync(path.join(root, 'prisma/migrations/20260715_hr_statutory_payroll_v3_art19/rollback.sql'), 'utf8');
    const demoSeed = fs.readFileSync(path.join(root, 'prisma/seed-hr-payroll-demo.ts'), 'utf8');
    const workforce = fs.readFileSync(path.join(root, 'src/services/hr-workforce.service.ts'), 'utf8');
    const benefits = fs.readFileSync(path.join(root, 'src/services/hr-benefits.service.ts'), 'utf8');

    it('matches the frontend endpoints and separates read/manage/approve/self permissions', () => {
        for (const endpoint of ['/company-tax-profile', '/rules', '/rules/:id/clone', '/periods', '/runs', '/aguinaldo/runs', '/me/receipts']) expect(routes).toContain(endpoint);
        for (const action of ['calculate', 'recalculate', 'submit-review', 'approve', 'pay', 'void']) expect(routes).toContain(`/:id/${action}`);
        for (const part of ['anomalies', 'snapshot', 'components', 'receipts', 'export']) expect(routes).toContain(`/:id/${part}`);
        expect(routes).toContain("requirePermission('hr.payroll.read', ROLES.SUPERADMIN)");
        expect(routes).toContain("requirePermission('hr.payroll.manage', ROLES.SUPERADMIN)");
        expect(routes).toContain("requirePermission('hr.payroll.approve', ROLES.SUPERADMIN)");
        expect(routes).toContain("requirePermission('hr.payroll.self'");
        expect(routes).not.toMatch(/router\.delete/i);
        expect(service).toContain("where: { id, companyId }");
        expect(service).toContain('PAYROLL_RULE_CLONE:${id}');
        expect(service).toContain('assertConfigurationMatchesCompanyTaxProfile');
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
        expect(service).toContain('HR_PAYROLL_CROSS_FISCAL_YEAR');
        expect(service).toContain('HR_PAYROLL_FISCAL_PERIOD_COUNT_EXCEEDED');
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

    it('seeds only current legal aliases and appends a corrected immutable revision when needed', () => {
        expect(demoSeed).toContain("prorationMode: 'SERVICE_DAYS_RATIO'");
        expect(demoSeed).not.toContain("prorationMode: 'SERVICE_DAYS'");
        expect(demoSeed).not.toMatch(/incomeTaxTreatment:\\s*'(?:EXEMPT|NONE)'/);
        expect(demoSeed).toContain('where: { ruleVersionId: rule.id, configurationHash }');
        expect(demoSeed).toContain("orderBy: { revision: 'desc' }");
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

    it('materializes statutory bases, employer costs and immutable calculation traces', () => {
        expect(service).toContain("schema: 'HR_PAYROLL_PARAMETRIC_V4'");
        expect(service).toContain('paymentConceptDefinition');
        expect(service).toContain('HR_PAYROLL_PAYMENT_CONCEPT_NOT_CONFIGURED');
        expect(service).toContain('calculateStatutoryPayroll');
        expect(service).toContain('priorStatutoryContext');
        expect(service).toContain('MISSING_INSS_NUMBER');
        expect(service).toContain('MISSING_TAX_IDENTIFICATION');
        expect(service).toContain('UNCLASSIFIED_MANUAL_INCOME');
        expect(service).toContain('INCOMPLETE_PRIOR_STATUTORY_HISTORY');
        expect(service).toContain('HR_PAYROLL_STATUTORY_HISTORY_INCOMPLETE');
        expect(service).toContain('HR_PAYROLL_INCOME_TAX_DEDUCTION_NOT_AUTHORIZED');
        expect(service).toContain('HR_PAYROLL_STATUTORY_SOURCE_IN_USE');
        expect(service).toContain('NON_STANDARD_EMPLOYMENT_STATUTORY_REVIEW');
        expect(service).toContain("requiredText(payload.reference, 'reference', 500)");
        expect(benefits).toContain('incomeTaxDeductible: false');
        expect(schema).toContain('model PayrollEmployerContribution');
        expect(schema).toContain('model PayrollStatutoryCalculation');
        expect(schema).toContain('socialSecurityApplicable');
        expect(schema).toContain('trainingContributionApplicable');
        expect(routes).toContain('/employer-contributions');
        expect(routes).toContain('/statutory-calculations');
        expect(statutoryMigration).toContain('PayrollStatutoryCalculation_no_update');
        expect(statutoryMigration).toContain('PayrollEmployerContribution_no_delete');
        expect(incomeTaxMigration).toContain('incomeTaxTreatment');
        expect(incomeTaxMigration).toContain('incomeTaxMethod');
        expect(incomeTaxMigration).toContain('incomeTaxCreditBalance');
        expect(incomeTaxRollback).toContain('DROP COLUMN `incomeTaxTreatment`');
    });

    it('reverses and reconciles employer contributions instead of leaving an orphaned payroll cost', () => {
        expect(service).toContain('reversedEmployerContributions: run.employerContributions.negated()');
        expect(service).toContain('RUN_EMPLOYER_CONTRIBUTIONS_MATCH');
        expect(service).toContain('EXTERNAL_EMPLOYER_CONTRIBUTIONS_MATCH');
        expect(routes).toContain('expectedEmployerContributions');
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
        const identifiers = [...`${migration}\n${statutoryMigration}\n${incomeTaxMigration}`.matchAll(/`([^`]+)`/g)].map(match => match[1]);
        expect(identifiers.filter(identifier => identifier.length > 64)).toEqual([]);
    });

    it('orders the Art. 19 V3 migration after the statutory V2 tables it alters', () => {
        const migrationNames = fs.readdirSync(path.join(root, 'prisma/migrations'), { withFileTypes: true })
            .filter(item => item.isDirectory())
            .map(item => item.name)
            .sort();
        expect(migrationNames.indexOf('20260715_hr_statutory_payroll_v2')).toBeGreaterThanOrEqual(0);
        expect(migrationNames.indexOf('20260715_hr_statutory_payroll_v3_art19'))
            .toBeGreaterThan(migrationNames.indexOf('20260715_hr_statutory_payroll_v2'));
    });

    it('keeps the PayrollRun shape check compatible with its MySQL foreign key', () => {
        expect(migration).toContain('PayrollRun_shape_ck');
        expect(migration).toMatch(/PayrollRun_periodId_fkey[^\n]+ON UPDATE RESTRICT/);
        expect(schema).toMatch(/period\s+PayrollPeriod\?\s+@relation\([^\n]+onUpdate: Restrict\)/);
    });

    it('sets no-store and removes internal trace from self DTOs', () => {
        expect(routes).toContain("Cache-Control', 'no-store");
        expect(service).toContain('trace: selfSafe ? []');
        expect(controller).toContain('selfSafe: true');
    });
});
