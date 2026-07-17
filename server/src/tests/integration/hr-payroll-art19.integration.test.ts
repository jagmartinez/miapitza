import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import prisma from '../../utils/prisma';
import { PayrollRunService } from '../../services/hr-payroll.service';

const utc = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('HR payroll Art. 19 transactional lifecycle (integration)', () => {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
    let companyId = 0;
    let branchId = 0;
    let roleId = 0;
    let employeeId = 0;
    let employeeUserId = 0;
    let periodId = 0;
    let attendancePeriodId = 0;
    let ruleId = 0;
    let configurationRevisionId = 0;
    let runId = 0;
    let januaryScheduleId = 0;
    const actorIds: number[] = [];

    beforeAll(async () => {
        const company = await prisma.company.create({ data: {
            name: `HR Art19 ${suffix}`,
            payrollTaxRegime: 'GENERAL',
            payrollIncomeTaxWithholding: true,
            payrollTaxRegimeReference: 'Ley 822',
            payrollTaxProfileReady: true,
        } });
        companyId = company.id;
        const branch = await prisma.branch.create({ data: {
            companyId, name: `HR branch ${suffix}`, code: `HR-${suffix}`, timezone: 'America/Managua',
        } });
        branchId = branch.id;
        const role = await prisma.role.create({ data: { companyId, name: `HR_ART19_${suffix}` } });
        roleId = role.id;

        for (let index = 1; index <= 4; index += 1) {
            const actor = await prisma.user.create({ data: {
                companyId, branchId, roleId, name: `HR actor ${index}`,
                email: `hr-art19-actor-${index}-${suffix}@example.test`, username: `hr_art19_actor_${index}_${suffix}`,
                password: 'integration-only', mustChangePassword: false, status: 'ACTIVE',
            } });
            actorIds.push(actor.id);
        }
        const employeeUser = await prisma.user.create({ data: {
            companyId, branchId, roleId, name: 'Colaborador Art19',
            email: `hr-art19-employee-${suffix}@example.test`, username: `hr_art19_employee_${suffix}`,
            password: 'integration-only', mustChangePassword: false, status: 'ACTIVE', accountType: 'INTERNAL',
        } });
        employeeUserId = employeeUser.id;
        const employee = await prisma.employee.create({ data: {
            companyId, userId: employeeUserId, employeeCode: `E-${suffix}`, legalName: 'Colaborador Art19',
            socialSecurityNumber: `INSS-${suffix}`, taxId: `RUC-${suffix}`,
            hireDate: utc('2025-01-01'), employmentType: 'FULL_TIME', status: 'ACTIVE',
        } });
        employeeId = employee.id;
        const contract = await prisma.employmentContract.create({ data: {
            companyId, employeeId, contractNumber: `C-${suffix}`, employmentType: 'FULL_TIME',
            startDate: utc('2025-01-01'), status: 'ACTIVE', signedAt: utc('2025-01-01'),
        } });
        await prisma.compensationHistory.create({ data: {
            companyId, employeeId, contractId: contract.id, changedById: actorIds[0],
            compensationType: 'SALARY', payFrequency: 'MONTHLY', amount: '20000', currency: 'NIO',
            effectiveFrom: utc('2025-01-01'), reason: 'Salario fijo para vector Art19',
        } });

        const attendancePeriod = await prisma.attendancePeriod.create({ data: {
            companyId, dateFrom: utc('2026-01-01'), dateTo: utc('2026-01-31'), timezone: 'America/Managua',
            status: 'CLOSED', revision: 1, payrollEligible: true, createdById: actorIds[0],
            closedById: actorIds[0], closedAt: utc('2026-01-31'), lastActionReason: 'Cierre integración Art19',
        } });
        attendancePeriodId = attendancePeriod.id;
        const januarySchedule = await prisma.weeklySchedule.create({ data: {
            companyId, weekStart: utc('2026-01-01'), version: 1, revision: 1, status: 'PUBLISHED',
            publicationKey: `ART19-JAN-${suffix}`, createdById: actorIds[0], publishedById: actorIds[0],
            publishedAt: utc('2025-12-20'), notes: 'Evidencia publicada Art19 enero',
        } });
        januaryScheduleId = januarySchedule.id;
        const overriddenShift = await prisma.scheduledShift.create({ data: {
            companyId, scheduleId: januaryScheduleId, userId: actorIds[0], branchId,
            startAt: new Date('2026-01-01T14:00:00.000Z'), endAt: new Date('2026-01-01T22:00:00.000Z'),
            timezoneSnapshot: 'America/Managua', breakMinutes: 0, paidBreak: false, status: 'SCHEDULED',
        } });
        const overrideRequest = await prisma.shiftSwapRequest.create({ data: {
            companyId, scheduleId: januaryScheduleId, requesterShiftId: overriddenShift.id,
            requestedById: actorIds[0], targetUserId: employeeUserId, status: 'APPROVED',
            reason: 'Vector de asignación efectiva Art19', targetRespondedAt: utc('2025-12-19'),
            decidedById: actorIds[1], decidedAt: utc('2025-12-20'), decisionNotes: 'Override aprobado',
        } });
        await prisma.shiftAssignmentOverride.create({ data: {
            companyId, scheduledShiftId: overriddenShift.id, assignedUserId: employeeUserId,
            swapRequestId: overrideRequest.id, assignedById: actorIds[1], effectiveAt: utc('2025-12-20'),
        } });
        await prisma.scheduledShift.createMany({ data: Array.from({ length: 20 }, (_, index) => {
            const day = String(index + 2).padStart(2, '0');
            return {
                companyId, scheduleId: januaryScheduleId, userId: employeeUserId, branchId,
                startAt: new Date(`2026-01-${day}T14:00:00.000Z`), endAt: new Date(`2026-01-${day}T22:00:00.000Z`),
                timezoneSnapshot: 'America/Managua', breakMinutes: 0, paidBreak: false, status: 'SCHEDULED' as const,
            };
        }) });
        // 21 jornadas (10,080 min) prueban que el salario mensual fijo no se infla
        // contra el divisor paramétrico de 9,600 min; las horas ordinarias deben
        // normalizarse al monto contractual de C$20,000.
        await prisma.attendanceDailySummary.createMany({ data: Array.from({ length: 21 }, (_, index) => ({
            companyId, userId: employeeUserId, branchId, scopeKey: `BRANCH:${branchId}`,
            date: utc(`2026-01-${String(index + 1).padStart(2, '0')}`), timezone: 'America/Managua',
            periodId: attendancePeriodId, scheduledMinutes: 480, ordinaryMinutes: 480, sourceRevision: 1,
        })) });

        const payrollPeriod = await prisma.payrollPeriod.create({ data: {
            companyId, code: `ENE-2026-${suffix}`, dateFrom: utc('2026-01-01'), dateTo: utc('2026-01-31'),
            payDate: utc('2026-01-31'), timezone: 'America/Managua', status: 'OPEN', revision: 0,
            reason: 'Período integración Art19', createdById: actorIds[0],
        } });
        periodId = payrollPeriod.id;

        const configuration = {
            schema: 'HR_PAYROLL_PARAMETRIC_V4', legallyValidated: true, currency: 'NIO',
            regular: {
                minuteDivisors: { WEEKLY: '2400', BIWEEKLY: '4800', FORTNIGHTLY: '4800', MONTHLY: '9600' },
                overtimeMultiplier: '2', paidLeaveUnitMinutes: { DAYS: '480', HOURS: '60', MINUTES: '1' },
            },
            aguinaldo: {
                method: 'HISTORICAL_PAID_COMPONENTS', lookbackDays: 365, incomeDivisor: '12',
                prorationMode: 'NONE', eligibleSources: ['RULE'], roundingScale: 2,
            },
            statutory: {
                companyTaxRegime: { code: 'GENERAL', sourceReference: 'Ley 822', incomeTaxApplicability: 'APPLIES' },
                inss: {
                    applicability: 'APPLIES', sourceReference: 'INSS 2026', regime: 'INTEGRAL',
                    employeeRate: '0.07', employerRateBelowThreshold: '0.215', employerRateAtOrAboveThreshold: '0.225',
                    employerSizeThreshold: 50, minimumMonthlyContributionBase: '10000', minimumBaseProration: 'PER_PAY_PERIOD_SERVICE_RATIO',
                    annualPeriods: { WEEKLY: 52, BIWEEKLY: 24, FORTNIGHTLY: 26, MONTHLY: 12 },
                },
                inatec: {
                    applicability: 'APPLIES', sourceReference: 'INATEC 2%', employerRate: '0.02',
                },
                incomeTax: {
                    sourceReference: 'Ley 822 art. 23; Decreto 01-2013 art. 19',
                    regimeApplicabilityAcknowledged: true,
                    calculationMethods: {
                        fixed: 'FIXED_PERIOD_PROJECTION', salaryChange: 'FIXED_SALARY_CHANGE',
                        variable: 'VARIABLE_ACCUMULATED', occasional: 'OCCASIONAL_INCREMENTAL',
                    },
                    inssEmployeeContributionDeductible: true,
                    occasionalInssDeductionTreatment: 'DEDUCT_FROM_OCCASIONAL_NET', adjustmentMode: 'WITHHOLD_OR_REFUND',
                    annualPeriods: { WEEKLY: 52, BIWEEKLY: 24, FORTNIGHTLY: 26, MONTHLY: 12 },
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
                    { code: 'VIATICOS', name: 'Viáticos', type: 'INCOME', socialSecurityApplicable: false, trainingContributionApplicable: false, incomeTaxTreatment: null, incomeTaxDeductible: false, sourceReference: 'Política documentada' },
                    { code: 'REEMBOLSO_DEPRECIACION', name: 'Reembolso depreciación', type: 'INCOME', socialSecurityApplicable: false, trainingContributionApplicable: false, incomeTaxTreatment: null, incomeTaxDeductible: false, sourceReference: 'Política documentada' },
                    { code: 'FONDO_PENSION_AUTORIZADO', name: 'Fondo autorizado', type: 'DEDUCTION', socialSecurityApplicable: false, trainingContributionApplicable: false, incomeTaxTreatment: null, incomeTaxDeductible: true, sourceReference: 'Deducción autorizada' },
                    { code: 'APORTE_AHORRO_AUTORIZADO', name: 'Ahorro autorizado', type: 'DEDUCTION', socialSecurityApplicable: false, trainingContributionApplicable: false, incomeTaxTreatment: null, incomeTaxDeductible: true, sourceReference: 'Deducción autorizada' },
                ],
            },
        };
        const rule = await prisma.payrollRuleVersion.create({ data: {
            companyId, name: `Nicaragua Art19 ${suffix}`, version: 1, status: 'DRAFT',
            effectiveFrom: utc('2026-01-01'), sourceReference: 'Ley 822 y Decreto 01-2013', createdById: actorIds[0],
        } });
        ruleId = rule.id;
        const configRevision = await prisma.payrollRuleConfigurationRevision.create({ data: {
            companyId, ruleVersionId: ruleId, revision: 1, configuration,
            configurationHash: 'a'.repeat(64), sourceReference: 'Ley 822 y Decreto 01-2013',
            evidenceReference: `integration:${suffix}`, uploadReason: 'Vector transaccional Art19', uploadedById: actorIds[0],
        } });
        configurationRevisionId = configRevision.id;
        await prisma.payrollRuleConfigurationReview.create({ data: {
            companyId, configurationRevisionId, decision: 'VALIDATED', reason: 'Control dual integración', reviewerId: actorIds[1],
        } });
        await prisma.payrollRuleVersion.update({ where: { id: ruleId }, data: {
            status: 'ACTIVE', activeConfigurationRevisionId: configurationRevisionId,
            validatedById: actorIds[1], validatedAt: new Date(), activatedAt: new Date(), revision: 1,
        } });
    });

    afterAll(async () => {
        if (!companyId) return;
        // Migrated production schemas enforce append-only statutory traces. The
        // harness drops this whole unique database after Jest exits.
        if (process.env.INTEGRATION_DATABASE_LIFECYCLE === 'DISPOSABLE_MIGRATED') return;
        await prisma.payrollComponentReversal.deleteMany({ where: { companyId } });
        await prisma.payrollCoverageRelease.deleteMany({ where: { companyId } });
        await prisma.payrollPaymentRecord.deleteMany({ where: { companyId } });
        await prisma.payrollEmployerContribution.deleteMany({ where: { companyId } });
        await prisma.payrollStatutoryCalculation.deleteMany({ where: { companyId } });
        await prisma.payrollAttendanceDependency.deleteMany({ where: { companyId } });
        await prisma.payrollCoverageClaim.deleteMany({ where: { companyId } });
        await prisma.payrollComponent.deleteMany({ where: { companyId } });
        await prisma.payrollReceipt.deleteMany({ where: { companyId } });
        await prisma.payrollRunReversal.deleteMany({ where: { companyId } });
        await prisma.payrollTrace.deleteMany({ where: { companyId } });
        await prisma.payrollAnomaly.deleteMany({ where: { companyId } });
        await prisma.payrollSnapshotLine.deleteMany({ where: { companyId } });
        await prisma.payrollIdempotencyRecord.deleteMany({ where: { companyId } });
        await prisma.payrollRun.deleteMany({ where: { companyId } });
        await prisma.payrollPeriod.deleteMany({ where: { companyId } });
        if (ruleId) await prisma.payrollRuleVersion.update({ where: { id: ruleId }, data: { activeConfigurationRevisionId: null } });
        await prisma.payrollRuleConfigurationReview.deleteMany({ where: { companyId } });
        await prisma.payrollRuleConfigurationRevision.deleteMany({ where: { companyId } });
        await prisma.payrollRuleVersion.deleteMany({ where: { companyId } });
        await prisma.attendanceDailySummary.deleteMany({ where: { companyId } });
        await prisma.attendancePeriod.deleteMany({ where: { companyId } });
        await prisma.shiftAssignmentOverride.deleteMany({ where: { companyId } });
        await prisma.shiftSwapReservation.deleteMany({ where: { companyId } });
        await prisma.shiftSwapRequest.deleteMany({ where: { companyId } });
        await prisma.scheduledShift.deleteMany({ where: { companyId } });
        await prisma.weeklySchedule.deleteMany({ where: { companyId } });
        await prisma.compensationHistory.deleteMany({ where: { companyId } });
        await prisma.employmentContract.deleteMany({ where: { companyId } });
        await prisma.employee.deleteMany({ where: { companyId } });
        await prisma.user.deleteMany({ where: { companyId } });
        await prisma.role.deleteMany({ where: { companyId } });
        await prisma.branch.deleteMany({ where: { companyId } });
        await prisma.company.delete({ where: { id: companyId } });
    });

    it('blocks a fixed salary when one effective published shift has no daily summary', async () => {
        const omitted = await prisma.attendanceDailySummary.findFirstOrThrow({
            where: { companyId, userId: employeeUserId, periodId: attendancePeriodId, date: utc('2026-01-21') },
        });
        await prisma.attendanceDailySummary.delete({ where: { id: omitted.id } });
        let incompleteRunId = 0;
        try {
            const created = await PayrollRunService.createRegular(companyId, actorIds[0], {
                periodId, ruleVersionId: ruleId, reason: 'Vector negativo de cobertura de turnos',
            }, `hr-art19-incomplete-create-${suffix}`) as unknown as { id: number };
            incompleteRunId = created.id;
            await PayrollRunService.transition(companyId, actorIds[0], incompleteRunId, 'REGULAR', 'calculate', {
                expectedRevision: 0, confirmed: true, reason: 'Calcular con un resumen omitido',
            }, `hr-art19-incomplete-calculate-${suffix}`);
            expect(await prisma.payrollAnomaly.findFirst({
                where: { companyId, runId: incompleteRunId, code: 'INCOMPLETE_ATTENDANCE_SUMMARIES', blocking: true, resolvedAt: null },
            })).not.toBeNull();
            await expect(PayrollRunService.transition(companyId, actorIds[0], incompleteRunId, 'REGULAR', 'submit-review', {
                expectedRevision: 1, confirmed: true, reason: 'No debe avanzar con evidencia incompleta',
            }, `hr-art19-incomplete-review-${suffix}`)).rejects.toMatchObject({ code: 'HR_PAYROLL_BLOCKING_ANOMALIES' });
            await PayrollRunService.transition(companyId, actorIds[1], incompleteRunId, 'REGULAR', 'void', {
                expectedRevision: 1, confirmed: true, reason: 'Liberar vector negativo',
            }, `hr-art19-incomplete-void-${suffix}`);
        } finally {
            await prisma.attendanceDailySummary.create({ data: {
                companyId: omitted.companyId, userId: omitted.userId, branchId: omitted.branchId,
                scopeKey: omitted.scopeKey, date: omitted.date, timezone: omitted.timezone,
                periodId: omitted.periodId, scheduledMinutes: omitted.scheduledMinutes,
                ordinaryMinutes: omitted.ordinaryMinutes, breakMinutes: omitted.breakMinutes,
                lateMinutes: omitted.lateMinutes, earlyDepartureMinutes: omitted.earlyDepartureMinutes,
                candidateOvertimeMinutes: omitted.candidateOvertimeMinutes,
                approvedOvertimeMinutes: omitted.approvedOvertimeMinutes, sourceRevision: omitted.sourceRevision,
            } });
        }
    });

    it('calculates, approves, pays, voids and exports one immutable statutory trace', async () => {
        const created = await PayrollRunService.createRegular(companyId, actorIds[0], {
            periodId, ruleVersionId: ruleId, reason: 'Crear ciclo Art19 de integración',
        }, `hr-art19-create-${suffix}`) as unknown as { id: number; revision: number };
        runId = created.id;

        const calculated = await PayrollRunService.transition(companyId, actorIds[0], runId, 'REGULAR', 'calculate', {
            expectedRevision: 0, confirmed: true, reason: 'Calcular Art19',
        }, `hr-art19-calculate-${suffix}`) as unknown as { revision: number };
        expect(calculated.revision).toBe(1);

        await prisma.weeklySchedule.update({ where: { id: januaryScheduleId }, data: {
            status: 'SUPERSEDED', supersededAt: new Date(),
        } });
        await expect(PayrollRunService.transition(companyId, actorIds[0], runId, 'REGULAR', 'submit-review', {
            expectedRevision: 1, confirmed: true, reason: 'No debe avanzar con horario supersedido',
        }, `hr-art19-stale-schedule-${suffix}`)).rejects.toMatchObject({ code: 'HR_PAYROLL_SCHEDULE_SOURCE_STALE' });
        await prisma.weeklySchedule.update({ where: { id: januaryScheduleId }, data: {
            status: 'PUBLISHED', supersededAt: null,
        } });

        const statutory = await prisma.payrollStatutoryCalculation.findUniqueOrThrow({
            where: { runId_calculationRevision_userId: { runId, calculationRevision: 1, userId: employeeUserId } },
        });
        expect(statutory.methodVersion).toBe('ART19_V3');
        expect(statutory.incomeTaxMethod).toBe('FIXED_PERIOD_PROJECTION');
        expect(statutory.currentRegularIncomeTaxNet.toFixed(2)).toBe('18600.00');
        expect(statutory.annualProjection.toFixed(2)).toBe('223200.00');
        expect(statutory.currentIncomeTaxWithheld.toFixed(2)).toBe('1636.67');
        expect(statutory.elapsedFiscalMonths).toBe(1);
        expect(statutory.configurationRevisionId).toBe(configurationRevisionId);
        expect(statutory.bracketSnapshot).toEqual(expect.objectContaining({ regular: expect.any(Object), effective: expect.any(Object) }));

        const blockingAnomalies = await prisma.payrollAnomaly.findMany({
            where: { companyId, runId, blocking: true, resolvedAt: null },
            select: { code: true, message: true }, orderBy: { id: 'asc' },
        });
        expect(blockingAnomalies).toEqual([]);

        await expect(PayrollRunService.addComponent(companyId, actorIds[0], runId, 'REGULAR', {
            userId: employeeUserId, code: 'VIATICOS', type: 'INCOME', inputAmount: '1000',
            taxable: false, incomeTaxDeductible: false, socialSecurityApplicable: true,
            trainingContributionApplicable: false, classificationConfirmed: true,
            reason: 'Intento con clasificación alterada', reference: 'viatico:error',
        }, `hr-art19-viatico-invalid-${suffix}`)).rejects.toMatchObject({ code: 'HR_PAYROLL_COMPONENT_CLASSIFICATION_MISMATCH' });

        await PayrollRunService.addComponent(companyId, actorIds[0], runId, 'REGULAR', {
            userId: employeeUserId, code: 'VIATICOS', type: 'INCOME', inputAmount: '1000',
            taxable: false, incomeTaxDeductible: false, socialSecurityApplicable: false,
            trainingContributionApplicable: false, classificationConfirmed: true,
            reason: 'Viático documentado no sujeto', reference: 'viatico:documentado',
        }, `hr-art19-viatico-${suffix}`);
        await PayrollRunService.addComponent(companyId, actorIds[0], runId, 'REGULAR', {
            userId: employeeUserId, code: 'REEMBOLSO_DEPRECIACION', type: 'INCOME', inputAmount: '500',
            taxable: false, incomeTaxDeductible: false, socialSecurityApplicable: false,
            trainingContributionApplicable: false, classificationConfirmed: true,
            reason: 'Reembolso de depreciación documentado', reference: 'depreciacion:documentada',
        }, `hr-art19-depreciacion-${suffix}`);
        const excludedConcepts = await prisma.payrollComponent.findMany({
            where: { runId, userId: employeeUserId, code: { in: ['VIATICOS', 'REEMBOLSO_DEPRECIACION'] } },
            orderBy: { code: 'asc' },
        });
        expect(excludedConcepts).toHaveLength(2);
        expect(excludedConcepts.every(component => component.socialSecurityApplicable === false && component.taxable === false)).toBe(true);
        const recalculatedAfterExcludedPayments = await prisma.payrollStatutoryCalculation.findUniqueOrThrow({
            where: { runId_calculationRevision_userId: { runId, calculationRevision: 3, userId: employeeUserId } },
        });
        expect(recalculatedAfterExcludedPayments.employeeInss.toFixed(2)).toBe('1400.00');
        expect(recalculatedAfterExcludedPayments.currentIncomeTaxWithheld.toFixed(2)).toBe('1636.67');

        await PayrollRunService.transition(companyId, actorIds[0], runId, 'REGULAR', 'submit-review', {
            expectedRevision: 3, confirmed: true, reason: 'Enviar a revisión',
        }, `hr-art19-review-${suffix}`);
        await PayrollRunService.transition(companyId, actorIds[1], runId, 'REGULAR', 'approve', {
            expectedRevision: 4, confirmed: true, reason: 'Aprobar control dual',
        }, `hr-art19-approve-${suffix}`);
        const unresolvedEarlierPeriod = await prisma.payrollPeriod.create({ data: {
            companyId, code: `DIC-2025-PENDIENTE-${suffix}`, dateFrom: utc('2025-12-01'), dateTo: utc('2025-12-31'),
            payDate: utc('2025-12-31'), timezone: 'America/Managua', status: 'OPEN', revision: 0,
            reason: 'Vector DRAFT anterior sin snapshot', createdById: actorIds[0],
        } });
        const unresolvedEarlierRun = await prisma.payrollRun.create({ data: {
            companyId, kind: 'REGULAR', code: `DIC-DRAFT-${suffix}`, status: 'DRAFT', periodId: unresolvedEarlierPeriod.id,
            ruleVersionId: ruleId, revision: 0, lastReason: 'Vector DRAFT anterior sin universo congelado', createdById: actorIds[0],
        } });
        await expect(PayrollRunService.transition(companyId, actorIds[2], runId, 'REGULAR', 'pay', {
            expectedRevision: 5, confirmed: true, reason: 'Intento con DRAFT anterior sin snapshot',
            paymentReference: `PAY-DRAFT-ORDER-${suffix}`, paymentDate: '2026-01-31', paymentMethod: 'TRANSFER',
            evidenceReference: `bank-draft-order:${suffix}`,
        }, `hr-art19-pay-draft-order-${suffix}`)).rejects.toMatchObject({ code: 'HR_PAYROLL_PAYMENT_ORDER_INVALID' });
        await prisma.payrollRun.delete({ where: { id: unresolvedEarlierRun.id } });
        await prisma.payrollPeriod.delete({ where: { id: unresolvedEarlierPeriod.id } });

        const laterPeriod = await prisma.payrollPeriod.create({ data: {
            companyId, code: `FEB-2026-${suffix}`, dateFrom: utc('2026-02-01'), dateTo: utc('2026-02-28'),
            payDate: utc('2026-02-28'), timezone: 'America/Managua', status: 'OPEN', revision: 0,
            reason: 'Vector de pago fuera de orden', createdById: actorIds[0],
        } });
        const laterPaidRun = await prisma.payrollRun.create({ data: {
            companyId, kind: 'REGULAR', code: `FEB-PAID-${suffix}`, status: 'PAID', periodId: laterPeriod.id,
            ruleVersionId: ruleId, configurationRevisionId, revision: 1, calculationRevision: 1,
            employeeCount: 1, lastReason: 'Vector fuera de orden', createdById: actorIds[0], paidById: actorIds[2], paidAt: new Date(),
        } });
        await prisma.payrollSnapshotLine.create({ data: {
            companyId, runId: laterPaidRun.id, userId: employeeUserId, employeeId, branchId,
            ordinaryMinutes: 0, approvedOvertimeMinutes: 0, payFrequency: 'MONTHLY', currency: 'NIO',
            sourceTrace: {}, coverageFrom: utc('2026-02-01'), coverageTo: utc('2026-02-28'),
            summaryRevisions: [], contractSegments: [], compensationSegments: [], aguinaldoIncomeSegments: [],
        } });
        await expect(PayrollRunService.transition(companyId, actorIds[2], runId, 'REGULAR', 'pay', {
            expectedRevision: 5, confirmed: true, reason: 'Intento fuera de orden',
            paymentReference: `PAY-ORDER-${suffix}`, paymentDate: '2026-01-31', paymentMethod: 'TRANSFER',
            evidenceReference: `bank-order:${suffix}`,
        }, `hr-art19-pay-order-${suffix}`)).rejects.toMatchObject({ code: 'HR_PAYROLL_PAYMENT_ORDER_INVALID' });
        await prisma.payrollSnapshotLine.deleteMany({ where: { runId: laterPaidRun.id } });
        await prisma.payrollRun.delete({ where: { id: laterPaidRun.id } });
        await prisma.payrollPeriod.delete({ where: { id: laterPeriod.id } });

        await expect(PayrollRunService.transition(companyId, actorIds[2], runId, 'REGULAR', 'pay', {
            expectedRevision: 5, confirmed: true, reason: 'Fecha fiscal incorrecta',
            paymentReference: `PAY-BAD-${suffix}`, paymentDate: '2026-02-01', paymentMethod: 'TRANSFER',
            evidenceReference: `bank-bad:${suffix}`,
        }, `hr-art19-pay-bad-${suffix}`)).rejects.toMatchObject({ code: 'HR_PAYROLL_PAYMENT_DATE_MISMATCH' });
        await PayrollRunService.transition(companyId, actorIds[2], runId, 'REGULAR', 'pay', {
            expectedRevision: 5, confirmed: true, reason: 'Pagar ciclo validado',
            paymentReference: `PAY-${suffix}`, paymentDate: '2026-01-31', paymentMethod: 'TRANSFER',
            evidenceReference: `bank:${suffix}`,
        }, `hr-art19-pay-${suffix}`);

        const paidReceipt = await prisma.payrollReceipt.findUniqueOrThrow({ where: { runId_userId: { runId, userId: employeeUserId } } });
        expect(paidReceipt.status).toBe('PUBLISHED');
        expect(paidReceipt.netPay.toFixed(2)).toBe('18463.33');

        const febAttendance = await prisma.attendancePeriod.create({ data: {
            companyId, dateFrom: utc('2026-02-01'), dateTo: utc('2026-02-28'), timezone: 'America/Managua',
            status: 'CLOSED', revision: 1, payrollEligible: true, createdById: actorIds[0],
            closedById: actorIds[0], closedAt: utc('2026-02-28'), lastActionReason: 'Cierre febrero Art19',
        } });
        const februarySchedule = await prisma.weeklySchedule.create({ data: {
            companyId, weekStart: utc('2026-02-01'), version: 1, revision: 1, status: 'PUBLISHED',
            publicationKey: `ART19-FEB-${suffix}`, createdById: actorIds[0], publishedById: actorIds[0],
            publishedAt: utc('2026-01-25'), notes: 'Evidencia publicada Art19 febrero',
        } });
        await prisma.scheduledShift.createMany({ data: Array.from({ length: 20 }, (_, index) => {
            const day = String(index + 1).padStart(2, '0');
            return {
                companyId, scheduleId: februarySchedule.id, userId: employeeUserId, branchId,
                startAt: new Date(`2026-02-${day}T14:00:00.000Z`), endAt: new Date(`2026-02-${day}T22:00:00.000Z`),
                timezoneSnapshot: 'America/Managua', breakMinutes: 0, paidBreak: false, status: 'SCHEDULED' as const,
            };
        }) });
        await prisma.attendanceDailySummary.createMany({ data: Array.from({ length: 20 }, (_, index) => ({
            companyId, userId: employeeUserId, branchId, scopeKey: `BRANCH:${branchId}`,
            date: utc(`2026-02-${String(index + 1).padStart(2, '0')}`), timezone: 'America/Managua',
            periodId: febAttendance.id, scheduledMinutes: 480, ordinaryMinutes: 480, sourceRevision: 1,
        })) });
        const febPeriod = await prisma.payrollPeriod.create({ data: {
            companyId, code: `FEB-REAL-2026-${suffix}`, dateFrom: utc('2026-02-01'), dateTo: utc('2026-02-28'),
            payDate: utc('2026-02-28'), timezone: 'America/Managua', status: 'OPEN', revision: 0,
            reason: 'Segundo período real Art19', createdById: actorIds[0],
        } });
        const febRun = await PayrollRunService.createRegular(companyId, actorIds[0], {
            periodId: febPeriod.id, ruleVersionId: ruleId, reason: 'Crear febrero dependiente de enero',
        }, `hr-art19-feb-create-${suffix}`) as unknown as { id: number };
        await PayrollRunService.transition(companyId, actorIds[0], febRun.id, 'REGULAR', 'calculate', {
            expectedRevision: 0, confirmed: true, reason: 'Calcular febrero con histórico enero',
        }, `hr-art19-feb-calculate-${suffix}`);
        const febStatutory = await prisma.payrollStatutoryCalculation.findUniqueOrThrow({
            where: { runId_calculationRevision_userId: { runId: febRun.id, calculationRevision: 1, userId: employeeUserId } },
        });
        expect(febStatutory.incomeTaxMethod).toBe('FIXED_PERIOD_PROJECTION');
        expect(febStatutory.priorIncomeTaxNet.toFixed(2)).toBe('18600.00');
        expect(febStatutory.elapsedFiscalMonths).toBe(2);
        expect(febStatutory.currentIncomeTaxWithheld.toFixed(2)).toBe('1636.66');
        expect(await prisma.payrollAnomaly.count({ where: { runId: febRun.id, blocking: true, resolvedAt: null } })).toBe(0);

        await expect(PayrollRunService.transition(companyId, actorIds[3], runId, 'REGULAR', 'void', {
            expectedRevision: 6, confirmed: true, reason: 'Intento de anular fuente con febrero activo',
            reversalReference: `VOID-BLOCK-${suffix}`, reversalDate: '2026-02-01', reversalMethod: 'BANK_REVERSAL',
            evidenceReference: `bank-block:${suffix}`,
        }, `hr-art19-void-block-${suffix}`)).rejects.toMatchObject({ code: 'HR_PAYROLL_STATUTORY_SOURCE_IN_USE' });
        await PayrollRunService.transition(companyId, actorIds[3], febRun.id, 'REGULAR', 'void', {
            expectedRevision: 1, confirmed: true, reason: 'Anular primero febrero dependiente',
        }, `hr-art19-feb-void-${suffix}`);

        await PayrollRunService.transition(companyId, actorIds[3], runId, 'REGULAR', 'void', {
            expectedRevision: 6, confirmed: true, reason: 'Reverso integral de control',
            reversalReference: `VOID-${suffix}`, reversalDate: '2026-02-01', reversalMethod: 'BANK_REVERSAL',
            evidenceReference: `bank-reversal:${suffix}`,
        }, `hr-art19-void-${suffix}`);

        const [voidedRun, voidedReceipt, reversals, exportResult] = await Promise.all([
            prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } }),
            prisma.payrollReceipt.findUniqueOrThrow({ where: { runId_userId: { runId, userId: employeeUserId } } }),
            prisma.payrollComponentReversal.findMany({ where: { companyId, runId } }),
            PayrollRunService.export(companyId, runId, 'REGULAR', 'csv'),
        ]);
        expect(voidedRun.status).toBe('VOID');
        expect(voidedReceipt.status).toBe('VOID');
        expect(reversals.length).toBeGreaterThanOrEqual(5);
        const csv = exportResult.buffer.toString('utf8');
        expect(csv).toContain('statutoryMethodVersion');
        expect(csv).toContain('ART19_V3');
        expect(csv).toContain('FIXED_PERIOD_PROJECTION');
        expect(csv).toContain('statutoryHistoryFingerprint');
    });
});
