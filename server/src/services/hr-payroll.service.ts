import { createHash } from 'node:crypto';
import { Prisma, type PayrollRuleStatus, type PayrollRunKind, type PayrollRunStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import prisma from '../utils/prisma';
import { scheduledWorkMinutes } from '../utils/hr-shift-minutes';
import { isValidTimeZone, zonedDateKey } from '../utils/timezone';
import { AuditLogService } from './audit-log.service';
import { commitBenefitDeductions, projectBenefitDeductions, reverseBenefitDeductions } from './hr-benefits.service';
import {
    calculateStatutoryPayroll,
    effectiveIncomeTaxApplicability,
    paymentConceptDefinition,
    type IncomeTaxTreatment,
    type PayrollPaymentConceptDefinition,
    type PayrollStatutoryConfiguration,
    type StatutoryPayFrequency,
    validateStatutoryConfiguration,
} from './hr-payroll-statutory';

type Db = Prisma.TransactionClient | typeof prisma;
type JsonObject = Record<string, unknown>;
type InputMap = Record<string, unknown>;

export class HrPayrollError extends Error {
    constructor(message: string, public readonly statusCode = 400, public readonly code = 'HR_PAYROLL_INVALID') {
        super(message);
    }
}

function requiredText(value: unknown, field: string, max = 2000): string {
    if (typeof value !== 'string' || !value.trim()) throw new HrPayrollError(`${field} es requerido`);
    const result = value.trim();
    if (result.length > max) throw new HrPayrollError(`${field} excede ${max} caracteres`);
    return result;
}

function optionalText(value: unknown, max = 2000): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new HrPayrollError('El valor debe ser texto');
    const result = value.trim();
    if (result.length > max) throw new HrPayrollError(`El valor excede ${max} caracteres`);
    return result || null;
}

function positiveId(value: unknown, field: string): number {
    const result = Number(value);
    if (!Number.isInteger(result) || result <= 0) throw new HrPayrollError(`${field} debe ser un entero positivo`);
    return result;
}

function dateValue(value: unknown, field: string): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new HrPayrollError(`${field} debe usar YYYY-MM-DD`);
    }
    const result = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value) {
        throw new HrPayrollError(`${field} no es una fecha válida`);
    }
    return result;
}

function dateKey(value: Date): string { return value.toISOString().slice(0, 10); }

function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as JsonObject).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function hashPayload(value: unknown): string {
    return createHash('sha256').update(stable(value)).digest('hex');
}

function money(value: Prisma.Decimal.Value): Prisma.Decimal {
    try {
        return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    } catch {
        throw new HrPayrollError('El monto monetario no es válido');
    }
}

function nonNegativeMoney(value: unknown, field: string): Prisma.Decimal {
    const text = requiredText(value, field, 40);
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new HrPayrollError(`${field} debe ser decimal positivo con máximo dos decimales`);
    const result = money(text);
    if (result.isNegative()) throw new HrPayrollError(`${field} no puede ser negativo`);
    return result;
}

export type LegalConfiguration = {
    schema: 'HR_PAYROLL_PARAMETRIC_V4';
    legallyValidated: true;
    currency: string;
    regular: {
        minuteDivisors: Record<'WEEKLY' | 'BIWEEKLY' | 'FORTNIGHTLY' | 'MONTHLY', string>;
        overtimeMultiplier: string;
        paidLeaveUnitMinutes: Record<'DAYS' | 'HOURS' | 'MINUTES', string>;
    };
    fxRates?: Record<string, { rate: string; version: string; sourceReference: string }>;
    aguinaldo: {
        method: 'HISTORICAL_PAID_COMPONENTS';
        lookbackDays: number;
        incomeDivisor: string;
        prorationMode: 'NONE' | 'SERVICE_DAYS_RATIO';
        eligibleSources: string[];
        roundingScale: 2;
    };
    statutory: PayrollStatutoryConfiguration;
};

type LegacyV3StatutoryConfiguration = Omit<PayrollStatutoryConfiguration, 'companyTaxRegime' | 'inss' | 'inatec' | 'incomeTax' | 'paymentConceptCatalog'> & {
    companyTaxRegime: Omit<PayrollStatutoryConfiguration['companyTaxRegime'], 'incomeTaxApplicability' | 'incomeTaxExceptionReason'>;
    inss: PayrollStatutoryConfiguration['inss'] & { contributionComponentCodes?: string[] };
    inatec: PayrollStatutoryConfiguration['inatec'] & { contributionComponentCodes?: string[] };
    incomeTax: PayrollStatutoryConfiguration['incomeTax'] & {
        applicability?: 'APPLIES' | 'DOES_NOT_APPLY';
        exceptionReason?: string;
        regimeIndependenceAcknowledged?: true;
        fixedTaxableComponentCodes?: string[];
        variableTaxableComponentCodes?: string[];
        occasionalTaxableComponentCodes?: string[];
        authorizedDeductionComponentCodes?: string[];
    };
};

function normalizeDeprecatedV4Aliases(value: unknown): unknown {
    const config = value as JsonObject | null;
    if (!config || config.schema !== 'HR_PAYROLL_PARAMETRIC_V4') return value;
    const regular = config.regular as JsonObject | undefined;
    const minuteDivisors = regular?.minuteDivisors as JsonObject | undefined;
    const aguinaldo = config.aguinaldo as JsonObject | undefined;
    const statutory = config.statutory as JsonObject | undefined;
    const inss = statutory?.inss as JsonObject | undefined;
    const inssAnnualPeriods = inss?.annualPeriods as JsonObject | undefined;
    const incomeTax = statutory?.incomeTax as JsonObject | undefined;
    const incomeTaxAnnualPeriods = incomeTax?.annualPeriods as JsonObject | undefined;
    const catalog = statutory?.paymentConceptCatalog;
    const deprecatedProration = aguinaldo?.prorationMode === 'SERVICE_DAYS';
    const conceptsWithoutState = Array.isArray(catalog) && catalog.some(item => typeof (item as JsonObject | null)?.active !== 'boolean');
    const deprecatedTreatments = Array.isArray(catalog) && catalog.some(item => {
        const treatment = (item as JsonObject | null)?.incomeTaxTreatment;
        return treatment === 'EXEMPT' || treatment === 'NONE';
    });
    const missingFortnightly = minuteDivisors?.FORTNIGHTLY === undefined ||
        inssAnnualPeriods?.FORTNIGHTLY === undefined || incomeTaxAnnualPeriods?.FORTNIGHTLY === undefined;
    if (!deprecatedProration && !deprecatedTreatments && !conceptsWithoutState && !missingFortnightly) return value;
    return {
        ...config,
        regular: regular ? {
            ...regular,
            minuteDivisors: minuteDivisors ? {
                ...minuteDivisors,
                FORTNIGHTLY: minuteDivisors.FORTNIGHTLY ?? minuteDivisors.BIWEEKLY ?? '4800',
            } : minuteDivisors,
        } : regular,
        aguinaldo: aguinaldo ? {
            ...aguinaldo,
            prorationMode: deprecatedProration ? 'SERVICE_DAYS_RATIO' : aguinaldo.prorationMode,
        } : aguinaldo,
        statutory: statutory ? {
            ...statutory,
            inss: inss ? {
                ...inss,
                annualPeriods: inssAnnualPeriods ? {
                    ...inssAnnualPeriods,
                    FORTNIGHTLY: inssAnnualPeriods.FORTNIGHTLY ?? 26,
                } : inssAnnualPeriods,
            } : inss,
            incomeTax: incomeTax ? {
                ...incomeTax,
                annualPeriods: incomeTaxAnnualPeriods ? {
                    ...incomeTaxAnnualPeriods,
                    FORTNIGHTLY: incomeTaxAnnualPeriods.FORTNIGHTLY ?? 26,
                } : incomeTaxAnnualPeriods,
            } : incomeTax,
            paymentConceptCatalog: Array.isArray(catalog) ? catalog.map(item => {
                const concept = item as JsonObject;
                return {
                    ...concept,
                    active: typeof concept.active === 'boolean' ? concept.active : true,
                    incomeTaxTreatment: concept.incomeTaxTreatment === 'EXEMPT' || concept.incomeTaxTreatment === 'NONE'
                        ? null
                        : concept.incomeTaxTreatment,
                };
            }) : catalog,
        } : statutory,
    };
}

function normalizeLegacyConfiguration(value: unknown, allowDeprecatedV4Aliases = true): unknown {
    if (allowDeprecatedV4Aliases && (value as { schema?: unknown } | null)?.schema === 'HR_PAYROLL_PARAMETRIC_V4') {
        return normalizeDeprecatedV4Aliases(value);
    }
    const legacy = value as { schema?: string; statutory?: LegacyV3StatutoryConfiguration } & JsonObject;
    if (legacy?.schema !== 'HR_PAYROLL_PARAMETRIC_V3' || !legacy.statutory) return value;
    const statutory = legacy.statutory;
    const legacyInss = statutory.inss;
    const legacyInatec = statutory.inatec;
    const legacyIncomeTax = statutory.incomeTax;
    const inssCodes = legacyInss.contributionComponentCodes ?? [];
    const inatecCodes = legacyInatec.contributionComponentCodes ?? [];
    const fixedCodes = legacyIncomeTax.fixedTaxableComponentCodes ?? [];
    const variableCodes = legacyIncomeTax.variableTaxableComponentCodes ?? [];
    const occasionalCodes = legacyIncomeTax.occasionalTaxableComponentCodes ?? [];
    const deductibleCodes = legacyIncomeTax.authorizedDeductionComponentCodes ?? [];
    const allCodes = [...new Set([...inssCodes, ...inatecCodes, ...fixedCodes, ...variableCodes, ...occasionalCodes, ...deductibleCodes])];
    const paymentConceptCatalog: PayrollPaymentConceptDefinition[] = allCodes.map(code => {
        const incomeTaxTreatment: IncomeTaxTreatment | null = fixedCodes.includes(code) ? 'REGULAR_FIXED'
            : variableCodes.includes(code) ? 'REGULAR_VARIABLE'
                : occasionalCodes.includes(code) ? 'OCCASIONAL' : null;
        const type = deductibleCodes.includes(code) ? 'DEDUCTION' as const : 'INCOME' as const;
        return {
            code,
            name: code,
            active: true,
            type,
            socialSecurityApplicable: type === 'INCOME' && inssCodes.includes(code),
            trainingContributionApplicable: type === 'INCOME' && inatecCodes.includes(code),
            incomeTaxTreatment: type === 'INCOME' ? incomeTaxTreatment : null,
            incomeTaxDeductible: type === 'DEDUCTION',
            sourceReference: type === 'DEDUCTION' || incomeTaxTreatment ? legacyIncomeTax.sourceReference : legacyInss.sourceReference,
        };
    });
    const inss = { ...legacyInss };
    const inatec = { ...legacyInatec };
    const incomeTax = { ...legacyIncomeTax, regimeApplicabilityAcknowledged: true as const };
    delete inss.contributionComponentCodes;
    delete inatec.contributionComponentCodes;
    delete incomeTax.applicability;
    delete incomeTax.exceptionReason;
    delete incomeTax.regimeIndependenceAcknowledged;
    delete incomeTax.fixedTaxableComponentCodes;
    delete incomeTax.variableTaxableComponentCodes;
    delete incomeTax.occasionalTaxableComponentCodes;
    delete incomeTax.authorizedDeductionComponentCodes;
    return normalizeDeprecatedV4Aliases({
        ...legacy,
        schema: 'HR_PAYROLL_PARAMETRIC_V4',
        statutory: {
            companyTaxRegime: {
                ...statutory.companyTaxRegime,
                incomeTaxApplicability: legacyIncomeTax.applicability,
                incomeTaxExceptionReason: legacyIncomeTax.applicability === 'DOES_NOT_APPLY' ? legacyIncomeTax.exceptionReason : undefined,
            },
            inss,
            inatec,
            incomeTax,
            paymentConceptCatalog,
        },
    });
}

function positiveDecimalText(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return false;
    return new Prisma.Decimal(value).greaterThan(0);
}

export function validateLegalConfiguration(value: unknown, options: { requireCurrentSchema?: boolean } = {}): LegalConfiguration {
    if (options.requireCurrentSchema && (value as { schema?: unknown } | null)?.schema !== 'HR_PAYROLL_PARAMETRIC_V4') {
        throw new HrPayrollError('Las configuraciones nuevas deben usar el catálogo paramétrico HR_PAYROLL_PARAMETRIC_V4', 409, 'HR_PAYROLL_CURRENT_CONFIGURATION_REQUIRED');
    }
    const config = normalizeLegacyConfiguration(value, options.requireCurrentSchema !== true) as Partial<LegalConfiguration> | null;
    const divisors = config?.regular?.minuteDivisors;
    if (
        !config || config.schema !== 'HR_PAYROLL_PARAMETRIC_V4' || config.legallyValidated !== true ||
        typeof config.currency !== 'string' || !/^[A-Z]{3}$/.test(config.currency) ||
        !divisors || !positiveDecimalText(divisors.WEEKLY) || !positiveDecimalText(divisors.BIWEEKLY) ||
        !positiveDecimalText(divisors.FORTNIGHTLY) ||
        !positiveDecimalText(divisors.MONTHLY) || !positiveDecimalText(config.regular?.overtimeMultiplier) ||
        !positiveDecimalText(config.regular?.paidLeaveUnitMinutes?.DAYS) ||
        !positiveDecimalText(config.regular?.paidLeaveUnitMinutes?.HOURS) ||
        !positiveDecimalText(config.regular?.paidLeaveUnitMinutes?.MINUTES) ||
        config.aguinaldo?.method !== 'HISTORICAL_PAID_COMPONENTS' ||
        !positiveDecimalText(config.aguinaldo?.incomeDivisor) ||
        !['NONE', 'SERVICE_DAYS_RATIO'].includes(String(config.aguinaldo?.prorationMode)) ||
        !Array.isArray(config.aguinaldo?.eligibleSources) || config.aguinaldo!.eligibleSources.length === 0 ||
        config.aguinaldo?.eligibleSources.some(source => typeof source !== 'string' || !source.trim()) ||
        config.aguinaldo?.roundingScale !== 2 || !Number.isInteger(config.aguinaldo?.lookbackDays) ||
        Number(config.aguinaldo?.lookbackDays) < 1 || Number(config.aguinaldo?.lookbackDays) > 731 ||
        !validateStatutoryConfiguration(config.statutory) ||
        (config.fxRates !== undefined && Object.entries(config.fxRates).some(([currency, rate]) =>
            !/^[A-Z]{3}$/.test(currency) || !positiveDecimalText(rate?.rate) || !rate?.version?.trim() || !rate?.sourceReference?.trim()))
    ) {
        throw new HrPayrollError(
            'La regla no tiene una configuración legal validada. Parametrice y valide técnicamente la regla antes de activarla o calcular.',
            409,
            'HR_PAYROLL_LEGAL_CONFIGURATION_REQUIRED',
        );
    }
    return config as LegalConfiguration;
}

function configurationSummary(config: LegalConfiguration, hash: string): string {
    return `Esquema ${config.schema}; régimen ${config.statutory.companyTaxRegime.code}; moneda ${config.currency}; INSS ${config.statutory.inss.applicability}; INATEC ${config.statutory.inatec.applicability}; IR laboral ${effectiveIncomeTaxApplicability(config.statutory)}; conceptos ${config.statutory.paymentConceptCatalog.length}; hash ${hash.slice(0, 12)}`;
}

function convertCurrency(amount: Prisma.Decimal, from: string, config: LegalConfiguration): { amount: Prisma.Decimal; trace: JsonObject } {
    if (from === config.currency) return { amount, trace: { from, to: config.currency, rate: '1', version: 'IDENTITY' } };
    const fx = config.fxRates?.[from];
    if (!fx) throw new HrPayrollError(`La moneda ${from} requiere una tasa FX versionada hacia ${config.currency}`, 409, 'HR_PAYROLL_FX_REQUIRED');
    return { amount: amount.times(fx.rate), trace: { from, to: config.currency, rate: fx.rate, version: fx.version, sourceReference: fx.sourceReference } };
}

export function allowedPayrollActions(status: PayrollRunStatus): string[] {
    if (status === 'DRAFT') return ['CALCULATE', 'VOID'];
    if (status === 'CALCULATED') return ['RECALCULATE', 'SUBMIT_REVIEW', 'VOID'];
    if (status === 'REVIEW') return ['APPROVE', 'VOID'];
    if (status === 'APPROVED') return ['MARK_PAID', 'VOID'];
    if (status === 'PAID') return ['VOID'];
    return [];
}

export function assertPayrollTransitionAllowed(input: {
    status: PayrollRunStatus;
    action: string;
    blockingAnomalies?: number;
    actorId: number;
    calculatedById?: number | null;
    reviewSubmittedById?: number | null;
    approvedById?: number | null;
    paidById?: number | null;
}): void {
    const expected: Record<string, PayrollRunStatus> = { 'submit-review': 'CALCULATED', approve: 'REVIEW', pay: 'APPROVED' };
    if (input.action === 'void') {
        if (!['DRAFT', 'CALCULATED', 'REVIEW', 'APPROVED', 'PAID'].includes(input.status)) throw new HrPayrollError('La corrida no puede anularse en su estado actual', 409);
    } else if (input.status !== expected[input.action]) {
        throw new HrPayrollError(`La transición ${input.action} no corresponde al estado actual`, 409);
    }
    if ((input.blockingAnomalies ?? 0) > 0 && ['submit-review', 'approve', 'pay'].includes(input.action)) {
        throw new HrPayrollError('Existen anomalías BLOCKING sin resolver', 409, 'HR_PAYROLL_BLOCKING_ANOMALIES');
    }
    if (input.action === 'approve' && (input.calculatedById === input.actorId || input.reviewSubmittedById === input.actorId)) {
        throw new HrPayrollError('Segregación de funciones: quien calculó o envió a revisión no puede aprobar', 409, 'HR_PAYROLL_DUTY_SEGREGATION');
    }
    if (input.action === 'pay' && (input.approvedById === input.actorId || input.calculatedById === input.actorId || input.reviewSubmittedById === input.actorId)) {
        throw new HrPayrollError('Segregación de funciones: quien calculó, revisó o aprobó no puede marcar pagada', 409, 'HR_PAYROLL_DUTY_SEGREGATION');
    }
    if (input.action === 'void' && input.status === 'PAID' && (input.paidById === input.actorId || input.approvedById === input.actorId)) {
        throw new HrPayrollError('Segregación de funciones: quien aprobó o marcó pagada no puede anular una nómina PAID', 409, 'HR_PAYROLL_DUTY_SEGREGATION');
    }
}

type RuleValidationLock = { status: PayrollRuleStatus; activeConfigurationRevisionId?: number | null; validatedAt?: Date | null; validatedById?: number | null };

export function assertRuleConfigurationMutable(rule: RuleValidationLock): void {
    if (rule.status !== 'DRAFT') throw new HrPayrollError('Sólo una regla DRAFT puede editarse', 409, 'HR_PAYROLL_RULE_IMMUTABLE');
    if (rule.activeConfigurationRevisionId || rule.validatedAt || rule.validatedById) {
        throw new HrPayrollError('La regla DRAFT ya fue validada; su configuración y metadatos quedan congelados y cualquier cambio requiere una nueva versión', 409, 'HR_PAYROLL_VALIDATED_RULE_IMMUTABLE');
    }
}

export function assertRuleMetadataEditable(rule: RuleValidationLock): void {
    assertRuleConfigurationMutable(rule);
}

export function paidReversalInput(payload: unknown) {
    const input = payload as Record<string, unknown>;
    return {
        reversalReference: requiredText(input.reversalReference, 'reversalReference', 160),
        reversalDate: dateValue(input.reversalDate, 'reversalDate'),
        reversalMethod: requiredText(input.reversalMethod, 'reversalMethod', 80),
        evidenceReference: requiredText(input.evidenceReference, 'evidenceReference', 500),
    };
}

export function assertAguinaldoDependencyFresh(input: {
    componentId: number;
    linksValid: boolean;
    captured: { runRevision: number; runStatus: string; runCurrency: string; componentAmount: Prisma.Decimal.Value; receiptStatus: string; componentReversed: boolean; runReversed: boolean };
    current: { runRevision: number; runStatus: string; runCurrency: string; componentAmount: Prisma.Decimal.Value; receiptStatus: string; componentReversed: boolean; runReversed: boolean };
}): void {
    const stale = !input.linksValid || input.captured.runStatus !== 'PAID' || input.current.runStatus !== 'PAID' ||
        input.current.runRevision !== input.captured.runRevision || input.current.runCurrency !== input.captured.runCurrency ||
        !new Prisma.Decimal(input.current.componentAmount).equals(input.captured.componentAmount) ||
        input.captured.receiptStatus !== 'PUBLISHED' || input.current.receiptStatus !== 'PUBLISHED' ||
        input.captured.componentReversed || input.captured.runReversed || input.current.componentReversed || input.current.runReversed;
    if (stale) throw new HrPayrollError(`La fuente histórica ${input.componentId} cambió, fue anulada o dejó de estar publicada`, 409, 'HR_PAYROLL_AGUINALDO_SOURCE_STALE');
}

const actorSelect = { id: true, name: true, username: true } as const;
const userSelect = { id: true, name: true, username: true } as const;

const runInclude = {
    period: true,
    ruleVersion: { include: { createdBy: { select: actorSelect } } },
    calculatedBy: { select: actorSelect }, reviewSubmittedBy: { select: actorSelect },
    approvedBy: { select: actorSelect }, paidBy: { select: actorSelect }, voidedBy: { select: actorSelect },
    _count: { select: { anomalies: true } },
} as const;

function serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function presentRule<T extends object>(rule: T) {
    return serialize({ ...rule, configuration: undefined });
}

type RunWithRelations = Prisma.PayrollRunGetPayload<{ include: typeof runInclude }> & {
    anomalyCount?: number;
    blockingAnomalyCount?: number;
};

function presentRun(run: RunWithRelations) {
    return serialize({
        ...run,
        ruleVersion: run.ruleVersion ? presentRule(run.ruleVersion) : run.ruleVersion,
        branchIds: undefined,
        employeeIds: undefined,
        allowedActions: allowedPayrollActions(run.status),
        totals: {
            currency: run.currency,
            grossIncome: run.grossIncome,
            totalDeductions: run.totalDeductions,
            employerContributions: run.employerContributions,
            netPay: run.netPay,
            employeeCount: run.employeeCount,
        },
        anomalyCount: run._count?.anomalies ?? run.anomalyCount ?? 0,
        blockingAnomalyCount: run.blockingAnomalyCount ?? 0,
        _count: undefined,
    });
}

async function loadRun(companyId: number, id: number, kind: PayrollRunKind, db: Db = prisma) {
    const run = await db.payrollRun.findFirst({ where: { id, companyId, kind }, include: runInclude });
    if (!run) throw new HrPayrollError('Corrida de nómina no encontrada', 404, 'HR_PAYROLL_RUN_NOT_FOUND');
    const blockingAnomalyCount = await db.payrollAnomaly.count({ where: { runId: id, companyId, blocking: true, resolvedAt: null } });
    return presentRun({ ...run, blockingAnomalyCount });
}

async function serializable<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await prisma.$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue;
            throw error;
        }
    }
    throw new HrPayrollError('No se pudo serializar la operación', 409, 'HR_PAYROLL_CONCURRENT_WRITE');
}

async function idempotent<T>(companyId: number, keyValue: string, operation: string, payload: unknown, execute: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const key = requiredText(keyValue, 'Idempotency-Key', 128);
    const requestHash = hashPayload(payload);
    const replay = async (): Promise<T | null> => {
        const record = await prisma.payrollIdempotencyRecord.findUnique({ where: { companyId_key: { companyId, key } } });
        if (!record) return null;
        if (record.operation !== operation || record.requestHash !== requestHash) {
            throw new HrPayrollError('Idempotency-Key ya fue utilizado con otro payload u operación', 409, 'IDEMPOTENCY_CONFLICT');
        }
        if (record.response === null) throw new HrPayrollError('La operación idempotente sigue en proceso', 409, 'IDEMPOTENCY_IN_PROGRESS');
        return record.response as T;
    };
    const existing = await replay();
    if (existing) return existing;
    try {
        return await serializable(async tx => {
            const record = await tx.payrollIdempotencyRecord.create({ data: { companyId, key, operation, requestHash } });
            const value = await execute(tx);
            const response = serialize(value) as Prisma.InputJsonValue;
            await tx.payrollIdempotencyRecord.update({ where: { id: record.id }, data: { response } });
            return value;
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const result = await replay();
            if (result) return result;
        }
        throw error;
    }
}

function paging(input: InputMap) {
    const page = Math.max(1, Number(input.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(input.limit) || 25));
    return { page, pageSize, skip: (page - 1) * pageSize };
}

function transitionInput(payload: InputMap) {
    return {
        reason: requiredText(payload.reason, 'reason'),
        expectedRevision: Number(payload.expectedRevision),
        confirmed: payload.confirmed === true,
    };
}

async function lockedRun(tx: Prisma.TransactionClient, companyId: number, id: number, kind: PayrollRunKind) {
    const rows = await tx.$queryRaw<Array<{ id: number; status: PayrollRunStatus; revision: number }>>(Prisma.sql`
        SELECT id, status, revision FROM PayrollRun
        WHERE id = ${id} AND companyId = ${companyId} AND kind = ${kind}
        FOR UPDATE
    `);
    if (!rows[0]) throw new HrPayrollError('Corrida de nómina no encontrada', 404, 'HR_PAYROLL_RUN_NOT_FOUND');
    return rows[0];
}

async function lockPayrollCompany(tx: Prisma.TransactionClient, companyId: number) {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT id FROM Company
        WHERE id = ${companyId}
        FOR UPDATE
    `);
    if (!rows[0]) throw new HrPayrollError('Empresa no encontrada', 404, 'COMPANY_NOT_FOUND');
}

function assertRegularFiscalPeriod(period: { dateFrom: Date; dateTo: Date; payDate: Date }) {
    const year = period.dateFrom.getUTCFullYear();
    if (period.dateTo.getUTCFullYear() !== year || period.payDate.getUTCFullYear() !== year) {
        throw new HrPayrollError(
            'La cobertura y la fecha de pago deben pertenecer al mismo año fiscal',
            409,
            'HR_PAYROLL_CROSS_FISCAL_YEAR',
        );
    }
}

async function assertRevision(run: { revision: number }, expectedRevision: number) {
    if (!Number.isInteger(expectedRevision) || run.revision !== expectedRevision) {
        throw new HrPayrollError('La corrida cambió; actualice la vista antes de continuar', 409, 'HR_PAYROLL_REVISION_CONFLICT');
    }
}

async function trace(tx: Prisma.TransactionClient, data: { companyId: number; runId: number; event: string; actorId?: number; reason?: string; fromStatus?: string; toStatus?: string; revision: number; metadata?: Prisma.InputJsonValue }) {
    await tx.payrollTrace.create({ data });
}

const companyTaxProfileSelect = {
    payrollTaxRegime: true,
    payrollIncomeTaxWithholding: true,
    payrollTaxRegimeReference: true,
    payrollIncomeTaxException: true,
    payrollTaxProfileReady: true,
} satisfies Prisma.CompanySelect;

type CompanyTaxProfileRecord = Prisma.CompanyGetPayload<{ select: typeof companyTaxProfileSelect }>;

async function companyTaxProfileRecord(db: Db, companyId: number): Promise<CompanyTaxProfileRecord> {
    const profile = await db.company.findUnique({ where: { id: companyId }, select: companyTaxProfileSelect });
    if (!profile) throw new HrPayrollError('Empresa no encontrada', 404, 'COMPANY_NOT_FOUND');
    return profile;
}

export function assertCompanyTaxProfileReady(profile: CompanyTaxProfileRecord): void {
    if (
        !profile.payrollTaxProfileReady ||
        !profile.payrollTaxRegimeReference?.trim() ||
        (!profile.payrollIncomeTaxWithholding && !profile.payrollIncomeTaxException?.trim())
    ) {
        throw new HrPayrollError('Completa y confirma el perfil fiscal de la empresa antes de continuar', 409, 'COMPANY_TAX_PROFILE_REQUIRED');
    }
}

export function assertConfigurationMatchesCompanyTaxProfile(config: LegalConfiguration, profile: CompanyTaxProfileRecord): void {
    assertCompanyTaxProfileReady(profile);
    const expectedApplicability = profile.payrollIncomeTaxWithholding ? 'APPLIES' : 'DOES_NOT_APPLY';
    if (
        config.statutory.companyTaxRegime.code !== profile.payrollTaxRegime ||
        config.statutory.companyTaxRegime.incomeTaxApplicability !== expectedApplicability ||
        config.statutory.companyTaxRegime.sourceReference !== profile.payrollTaxRegimeReference ||
        (expectedApplicability === 'DOES_NOT_APPLY' && config.statutory.companyTaxRegime.incomeTaxExceptionReason !== profile.payrollIncomeTaxException)
    ) {
        throw new HrPayrollError('El perfil fiscal de la empresa cambió; clona la versión y vuelve a validarla', 409, 'COMPANY_TAX_PROFILE_MISMATCH');
    }
}

export class PayrollRuleService {
    static async companyTaxProfile(companyId: number) {
        const company = await prisma.company.findUnique({
            where: { id: companyId },
            select: {
                id: true,
                name: true,
                payrollTaxRegime: true,
                payrollIncomeTaxWithholding: true,
                payrollTaxRegimeReference: true,
                payrollIncomeTaxException: true,
                payrollTaxProfileReady: true,
                updatedAt: true,
            },
        });
        if (!company) throw new HrPayrollError('Empresa no encontrada', 404, 'COMPANY_NOT_FOUND');
        return serialize({
            companyId: company.id,
            companyName: company.name,
            taxRegime: company.payrollTaxRegime,
            incomeTaxWithholding: company.payrollIncomeTaxWithholding,
            sourceReference: company.payrollTaxRegimeReference,
            incomeTaxException: company.payrollIncomeTaxException,
            ready: company.payrollTaxProfileReady,
            updatedAt: company.updatedAt,
        });
    }

    static async list(companyId: number, filters: InputMap) {
        const p = paging(filters);
        const where: Prisma.PayrollRuleVersionWhereInput = { companyId, status: filters.status || undefined };
        const [items, total] = await Promise.all([
            prisma.payrollRuleVersion.findMany({ where, include: { createdBy: { select: actorSelect } }, orderBy: [{ name: 'asc' }, { version: 'desc' }], skip: p.skip, take: p.pageSize }),
            prisma.payrollRuleVersion.count({ where }),
        ]);
        return { items: items.map(presentRule), pagination: { page: p.page, pageSize: p.pageSize, total, totalPages: Math.ceil(total / p.pageSize) } };
    }

    static async create(companyId: number, actorId: number, payload: InputMap, key: string) {
        return idempotent(companyId, key, 'PAYROLL_RULE_CREATE', { actorId, payload }, async tx => {
            const name = requiredText(payload.name, 'name', 120);
            const effectiveFrom = dateValue(payload.effectiveFrom, 'effectiveFrom');
            const effectiveTo = payload.effectiveTo ? dateValue(payload.effectiveTo, 'effectiveTo') : null;
            if (effectiveTo && effectiveTo < effectiveFrom) throw new HrPayrollError('effectiveTo no puede ser anterior a effectiveFrom');
            const latest = await tx.payrollRuleVersion.findFirst({ where: { companyId, name }, orderBy: { version: 'desc' }, select: { version: true } });
            const result = await tx.payrollRuleVersion.create({ data: {
                companyId, createdById: actorId, name, version: (latest?.version ?? 0) + 1,
                effectiveFrom, effectiveTo, sourceReference: requiredText(payload.sourceReference, 'sourceReference', 500),
                description: optionalText(payload.description), status: 'DRAFT',
            }, include: { createdBy: { select: actorSelect } } });
            await AuditLogService.log({ companyId, userId: actorId, entityType: 'PayrollRuleVersion', entityId: result.id, action: 'CREATE', details: { name, version: result.version, sourceReference: result.sourceReference } }, tx);
            return presentRule(result);
        });
    }

    static async clone(id: number, companyId: number, actorId: number, payload: InputMap, key: string) {
        return idempotent(companyId, key, `PAYROLL_RULE_CLONE:${id}`, { actorId, payload }, async tx => {
            const source = await tx.payrollRuleVersion.findFirst({
                where: { id, companyId },
                include: { activeConfigurationRevision: true },
            });
            if (!source) throw new HrPayrollError('Regla no encontrada', 404, 'HR_PAYROLL_RULE_NOT_FOUND');
            if (!source.activeConfigurationRevision || !source.activeConfigurationRevisionId) {
                throw new HrPayrollError('Sólo puede clonarse una versión con configuración validada', 409, 'HR_PAYROLL_VALIDATED_CONFIGURATION_REQUIRED');
            }
            const expectedRevision = Number(payload.expectedRevision);
            if (!Number.isInteger(expectedRevision) || expectedRevision !== source.revision) {
                throw new HrPayrollError('La regla cambió; actualice la vista', 409, 'HR_PAYROLL_REVISION_CONFLICT');
            }
            const companyProfile = await companyTaxProfileRecord(tx, companyId);
            assertCompanyTaxProfileReady(companyProfile);
            const sourceConfig = validateLegalConfiguration(source.activeConfigurationRevision.configuration);
            const companyTaxRegime = {
                code: companyProfile.payrollTaxRegime as PayrollStatutoryConfiguration['companyTaxRegime']['code'],
                sourceReference: companyProfile.payrollTaxRegimeReference,
                incomeTaxApplicability: companyProfile.payrollIncomeTaxWithholding ? 'APPLIES' as const : 'DOES_NOT_APPLY' as const,
                ...(companyProfile.payrollIncomeTaxWithholding
                    ? {}
                    : { incomeTaxExceptionReason: companyProfile.payrollIncomeTaxException! }),
            };
            const clonedConfig = validateLegalConfiguration({
                ...sourceConfig,
                statutory: { ...sourceConfig.statutory, companyTaxRegime },
            }, { requireCurrentSchema: true });
            const name = requiredText(payload.name, 'name', 120);
            const effectiveFrom = dateValue(payload.effectiveFrom, 'effectiveFrom');
            const effectiveTo = payload.effectiveTo ? dateValue(payload.effectiveTo, 'effectiveTo') : null;
            if (effectiveTo && effectiveTo < effectiveFrom) throw new HrPayrollError('effectiveTo no puede ser anterior a effectiveFrom');
            const latest = await tx.payrollRuleVersion.findFirst({ where: { companyId, name }, orderBy: { version: 'desc' }, select: { version: true } });
            const rule = await tx.payrollRuleVersion.create({ data: {
                companyId,
                createdById: actorId,
                name,
                version: (latest?.version ?? 0) + 1,
                effectiveFrom,
                effectiveTo,
                sourceReference: requiredText(payload.sourceReference, 'sourceReference', 500),
                description: optionalText(payload.description),
                status: 'DRAFT',
            }, include: { createdBy: { select: actorSelect } } });
            const configurationHash = hashPayload(clonedConfig);
            const clonedRevision = await tx.payrollRuleConfigurationRevision.create({ data: {
                companyId,
                ruleVersionId: rule.id,
                revision: 1,
                configuration: clonedConfig as unknown as Prisma.InputJsonValue,
                configurationHash,
                sourceReference: source.activeConfigurationRevision.sourceReference,
                evidenceReference: source.activeConfigurationRevision.evidenceReference,
                uploadReason: `Borrador clonado desde ${source.name} v${source.version}; requiere revisión antes de activarse`,
                uploadedById: actorId,
            } });
            await AuditLogService.log({
                companyId,
                userId: actorId,
                entityType: 'PayrollRuleVersion',
                entityId: rule.id,
                action: 'CREATE',
                details: {
                    operation: 'CLONE_TO_DRAFT',
                    sourceRuleVersionId: source.id,
                    sourceConfigurationRevisionId: source.activeConfigurationRevisionId,
                    clonedConfigurationRevisionId: clonedRevision.id,
                    configurationHash,
                },
            }, tx);
            return presentRule(rule);
        });
    }

    static async update(id: number, companyId: number, actorId: number, payload: InputMap, key: string) {
        return idempotent(companyId, key, `PAYROLL_RULE_UPDATE:${id}`, { actorId, payload }, async tx => {
            const current = await tx.payrollRuleVersion.findFirst({ where: { id, companyId } });
            if (!current) throw new HrPayrollError('Regla no encontrada', 404, 'HR_PAYROLL_RULE_NOT_FOUND');
            assertRuleMetadataEditable(current);
            const effectiveFrom = dateValue(payload.effectiveFrom, 'effectiveFrom');
            const effectiveTo = payload.effectiveTo ? dateValue(payload.effectiveTo, 'effectiveTo') : null;
            if (effectiveTo && effectiveTo < effectiveFrom) throw new HrPayrollError('effectiveTo no puede ser anterior a effectiveFrom');
            const updated = await tx.payrollRuleVersion.updateMany({ where: { id, companyId, revision: current.revision, status: 'DRAFT' }, data: {
                name: requiredText(payload.name, 'name', 120), effectiveFrom, effectiveTo,
                sourceReference: requiredText(payload.sourceReference, 'sourceReference', 500), description: optionalText(payload.description),
                revision: { increment: 1 },
            } });
            if (updated.count !== 1) throw new HrPayrollError('La regla cambió concurrentemente', 409, 'HR_PAYROLL_REVISION_CONFLICT');
            await AuditLogService.log({ companyId, userId: actorId, entityType: 'PayrollRuleVersion', entityId: id, action: 'UPDATE', details: { operation: 'EDIT_DRAFT', fromRevision: current.revision, toRevision: current.revision + 1 } }, tx);
            return presentRule(await tx.payrollRuleVersion.findUniqueOrThrow({ where: { id }, include: { createdBy: { select: actorSelect } } }));
        });
    }

    static async uploadConfiguration(id: number, companyId: number, actorId: number, payload: InputMap, key: string) {
        return idempotent(companyId, key, `PAYROLL_RULE_CONFIG_UPLOAD:${id}`, { actorId, payload }, async tx => {
            const rule = await tx.payrollRuleVersion.findFirst({ where: { id, companyId } });
            if (!rule) throw new HrPayrollError('Regla no encontrada', 404, 'HR_PAYROLL_RULE_NOT_FOUND');
            assertRuleConfigurationMutable(rule);
            const expectedRevision = Number(payload.expectedRevision);
            if (!Number.isInteger(expectedRevision) || expectedRevision !== rule.revision) throw new HrPayrollError('La regla cambió; actualice la vista', 409, 'HR_PAYROLL_REVISION_CONFLICT');
            const config = validateLegalConfiguration(payload.configuration, { requireCurrentSchema: true });
            const companyProfile = await companyTaxProfileRecord(tx, companyId);
            assertConfigurationMatchesCompanyTaxProfile(config, companyProfile);
            const configurationHash = hashPayload(config);
            const latest = await tx.payrollRuleConfigurationRevision.findFirst({ where: { ruleVersionId: id }, orderBy: { revision: 'desc' }, select: { revision: true } });
            const revision = (latest?.revision ?? 0) + 1;
            const item = await tx.payrollRuleConfigurationRevision.create({ data: {
                companyId, ruleVersionId: id, revision, configuration: config as unknown as Prisma.InputJsonValue, configurationHash,
                sourceReference: requiredText(payload.sourceReference, 'sourceReference', 500), evidenceReference: requiredText(payload.evidenceReference, 'evidenceReference', 500),
                uploadReason: requiredText(payload.reason, 'reason'), uploadedById: actorId,
            } });
            const changed = await tx.payrollRuleVersion.updateMany({ where: { id, companyId, status: 'DRAFT', revision: expectedRevision }, data: { revision: { increment: 1 } } });
            if (changed.count !== 1) throw new HrPayrollError('La regla cambió concurrentemente', 409, 'HR_PAYROLL_REVISION_CONFLICT');
            await AuditLogService.log({ companyId, userId: actorId, entityType: 'PayrollRuleConfigurationRevision', entityId: item.id, action: 'CREATE', details: { ruleVersionId: id, revision, configurationHash, sourceReference: item.sourceReference, evidenceReference: item.evidenceReference } }, tx);
            return serialize({ id: item.id, ruleVersionId: id, revision, configuration: config, configurationHash, sourceReference: item.sourceReference, evidenceReference: item.evidenceReference, uploadedById: actorId, uploadedAt: item.uploadedAt, status: 'UPLOADED' });
        });
    }

    static async listConfigurationRevisions(id: number, companyId: number) {
        if (!await prisma.payrollRuleVersion.findFirst({ where: { id, companyId }, select: { id: true } })) throw new HrPayrollError('Regla no encontrada', 404, 'HR_PAYROLL_RULE_NOT_FOUND');
        const items = await prisma.payrollRuleConfigurationRevision.findMany({ where: { companyId, ruleVersionId: id }, include: {
            uploadedBy: { select: actorSelect }, review: { include: { reviewer: { select: actorSelect } } },
        }, orderBy: { revision: 'desc' } });
        return serialize(items.map(item => ({
            id: item.id, ruleVersionId: item.ruleVersionId, revision: item.revision, configurationHash: item.configurationHash,
            configuration: validateLegalConfiguration(item.configuration),
            sourceReference: item.sourceReference, evidenceReference: item.evidenceReference, uploadReason: item.uploadReason,
            uploadedAt: item.uploadedAt, uploadedBy: item.uploadedBy, status: item.review?.decision ?? 'UPLOADED',
            reviewedAt: item.review?.reviewedAt ?? null, reviewer: item.review?.reviewer ?? null, reviewReason: item.review?.reason ?? null,
        })));
    }

    static async reviewConfiguration(id: number, companyId: number, actorId: number, payload: InputMap, key: string) {
        return idempotent(companyId, key, `PAYROLL_RULE_CONFIG_REVIEW:${id}`, { actorId, payload }, async tx => {
            const rule = await tx.payrollRuleVersion.findFirst({ where: { id, companyId } });
            if (!rule) throw new HrPayrollError('Regla no encontrada', 404, 'HR_PAYROLL_RULE_NOT_FOUND');
            assertRuleConfigurationMutable(rule);
            const expectedRevision = Number(payload.expectedRevision);
            if (!Number.isInteger(expectedRevision) || expectedRevision !== rule.revision) throw new HrPayrollError('La regla cambió; actualice la vista', 409, 'HR_PAYROLL_REVISION_CONFLICT');
            const configurationRevisionId = positiveId(payload.configurationRevisionId, 'configurationRevisionId');
            const configuration = await tx.payrollRuleConfigurationRevision.findFirst({ where: { id: configurationRevisionId, ruleVersionId: id, companyId }, include: { review: true } });
            if (!configuration) throw new HrPayrollError('Revisión de configuración no encontrada', 404, 'HR_PAYROLL_CONFIGURATION_NOT_FOUND');
            if (configuration.review) throw new HrPayrollError('La configuración ya fue revisada', 409, 'HR_PAYROLL_CONFIGURATION_ALREADY_REVIEWED');
            if (configuration.uploadedById === actorId) throw new HrPayrollError('Control dual: el cargador no puede validar su propia configuración', 409, 'HR_PAYROLL_DUAL_CONTROL_REQUIRED');
            const config = validateLegalConfiguration(configuration.configuration, { requireCurrentSchema: true });
            const decision = payload.decision === 'REJECTED' ? 'REJECTED' : payload.decision === 'VALIDATED' ? 'VALIDATED' : (() => { throw new HrPayrollError('decision debe ser VALIDATED o REJECTED'); })();
            if (decision === 'VALIDATED') {
                assertConfigurationMatchesCompanyTaxProfile(config, await companyTaxProfileRecord(tx, companyId));
            }
            await tx.payrollRuleConfigurationReview.create({ data: { companyId, configurationRevisionId, decision, reason: requiredText(payload.reason, 'reason'), reviewerId: actorId } });
            const update: Prisma.PayrollRuleVersionUncheckedUpdateManyInput = decision === 'VALIDATED' ? {
                activeConfigurationRevisionId: configurationRevisionId, configurationSummary: configurationSummary(config, configuration.configurationHash), validatedById: actorId, validatedAt: new Date(), revision: { increment: 1 },
            } : { revision: { increment: 1 } };
            const changed = await tx.payrollRuleVersion.updateMany({ where: { id, companyId, status: 'DRAFT', revision: expectedRevision }, data: update });
            if (changed.count !== 1) throw new HrPayrollError('La regla cambió concurrentemente', 409, 'HR_PAYROLL_REVISION_CONFLICT');
            await AuditLogService.log({ companyId, userId: actorId, entityType: 'PayrollRuleConfigurationReview', entityId: configurationRevisionId, action: 'CREATE', details: { ruleVersionId: id, decision, configurationHash: configuration.configurationHash } }, tx);
            return serialize({ configurationRevisionId, decision, reviewerId: actorId, configurationHash: configuration.configurationHash });
        });
    }

    static async transition(id: number, companyId: number, actorId: number, action: 'activate' | 'retire', payload: InputMap, key: string) {
        return idempotent(companyId, key, `PAYROLL_RULE_${action.toUpperCase()}:${id}`, { actorId, payload }, async tx => {
            const input = transitionInput(payload);
            if (!input.confirmed) throw new HrPayrollError('Debe confirmar la transición');
            const current = await tx.payrollRuleVersion.findFirst({ where: { id, companyId } });
            if (!current) throw new HrPayrollError('Regla no encontrada', 404, 'HR_PAYROLL_RULE_NOT_FOUND');
            if (current.revision !== input.expectedRevision) throw new HrPayrollError('La regla cambió; actualice la vista', 409, 'HR_PAYROLL_REVISION_CONFLICT');
            if (action === 'activate') {
                if (current.status !== 'DRAFT') throw new HrPayrollError('Sólo una regla DRAFT puede activarse', 409);
                if (!current.activeConfigurationRevisionId) throw new HrPayrollError('La regla requiere una configuración revisada y VALIDATED', 409, 'HR_PAYROLL_VALIDATED_CONFIGURATION_REQUIRED');
                const validated = await tx.payrollRuleConfigurationRevision.findFirst({ where: { id: current.activeConfigurationRevisionId, companyId, ruleVersionId: id, review: { decision: 'VALIDATED' } } });
                if (!validated) throw new HrPayrollError('La revisión legal VALIDATED no está disponible', 409, 'HR_PAYROLL_VALIDATED_CONFIGURATION_REQUIRED');
                const validatedConfig = validateLegalConfiguration(validated.configuration, { requireCurrentSchema: true });
                assertConfigurationMatchesCompanyTaxProfile(validatedConfig, await companyTaxProfileRecord(tx, companyId));
                const overlap = await tx.payrollRuleVersion.findFirst({ where: { companyId, id: { not: id }, status: 'ACTIVE', effectiveFrom: { lte: current.effectiveTo ?? new Date('9999-12-31') }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: current.effectiveFrom } }] }, select: { id: true, name: true } });
                if (overlap) throw new HrPayrollError(`Existe otra regla ACTIVE superpuesta: ${overlap.name}`, 409, 'HR_PAYROLL_ACTIVE_RULE_OVERLAP');
                await tx.payrollRuleVersion.update({ where: { id }, data: { status: 'ACTIVE', revision: { increment: 1 }, activatedAt: new Date() } });
            } else {
                if (current.status !== 'ACTIVE') throw new HrPayrollError('Sólo una regla ACTIVE puede retirarse', 409);
                await tx.payrollRuleVersion.update({ where: { id }, data: { status: 'RETIRED', revision: { increment: 1 }, retiredAt: new Date() } });
            }
            await AuditLogService.log({ companyId, userId: actorId, entityType: 'PayrollRuleVersion', entityId: id, action: 'UPDATE', details: { operation: action.toUpperCase(), reason: input.reason, fromStatus: current.status } }, tx);
            return presentRule(await tx.payrollRuleVersion.findUniqueOrThrow({ where: { id }, include: { createdBy: { select: actorSelect } } }));
        });
    }
}

export class PayrollPeriodService {
    static async list(companyId: number, filters: InputMap) {
        const p = paging(filters);
        const where: Prisma.PayrollPeriodWhereInput = { companyId, status: filters.status || undefined };
        const [items, total] = await Promise.all([
            prisma.payrollPeriod.findMany({ where, orderBy: { dateFrom: 'desc' }, skip: p.skip, take: p.pageSize }), prisma.payrollPeriod.count({ where }),
        ]);
        return { items: serialize(items), pagination: { page: p.page, pageSize: p.pageSize, total, totalPages: Math.ceil(total / p.pageSize) } };
    }

    static async create(companyId: number, actorId: number, payload: InputMap, key: string) {
        return idempotent(companyId, key, 'PAYROLL_PERIOD_CREATE', { actorId, payload }, async tx => {
            const dateFrom = dateValue(payload.dateFrom, 'dateFrom'); const dateTo = dateValue(payload.dateTo, 'dateTo');
            const payDate = dateValue(payload.payDate, 'payDate');
            if (dateTo < dateFrom) throw new HrPayrollError('dateTo no puede ser anterior a dateFrom');
            if (payDate < dateFrom) throw new HrPayrollError('payDate no puede ser anterior al inicio del período');
            if (dateFrom.getUTCFullYear() !== dateTo.getUTCFullYear() || dateTo.getUTCFullYear() !== payDate.getUTCFullYear()) {
                throw new HrPayrollError('El período y su fecha de pago deben pertenecer al mismo año fiscal', 409, 'HR_PAYROLL_CROSS_FISCAL_YEAR');
            }
            const timezone = optionalText(payload.timezone, 64) || 'America/Managua';
            if (!isValidTimeZone(timezone)) throw new HrPayrollError('timezone no es una zona IANA válida');
            const overlap = await tx.payrollPeriod.findFirst({ where: { companyId, status: { not: 'VOID' }, dateFrom: { lte: dateTo }, dateTo: { gte: dateFrom } }, select: { id: true, code: true } });
            if (overlap) throw new HrPayrollError(`El período se superpone con ${overlap.code}`, 409, 'HR_PAYROLL_PERIOD_OVERLAP');
            const period = await tx.payrollPeriod.create({ data: {
                companyId, code: requiredText(payload.code, 'code', 64), dateFrom, dateTo, payDate, timezone,
                reason: requiredText(payload.reason, 'reason'), createdById: actorId, status: 'OPEN',
            } });
            await AuditLogService.log({ companyId, userId: actorId, entityType: 'PayrollPeriod', entityId: period.id, action: 'CREATE', details: { code: period.code, dateFrom: dateKey(dateFrom), dateTo: dateKey(dateTo), payDate: dateKey(payDate) } }, tx);
            return serialize(period);
        });
    }
}

async function ensureActiveRule(tx: Prisma.TransactionClient, companyId: number, ruleVersionId: number, referenceDate: Date) {
    const rule = await tx.payrollRuleVersion.findFirst({ where: { id: ruleVersionId, companyId, status: 'ACTIVE', effectiveFrom: { lte: referenceDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: referenceDate } }] }, include: { activeConfigurationRevision: { include: { review: true } } } });
    if (!rule) throw new HrPayrollError('La regla no está ACTIVE o no aplica a la fecha de corte', 409, 'HR_PAYROLL_RULE_NOT_ACTIVE');
    if (!rule.activeConfigurationRevision || rule.activeConfigurationRevision.review?.decision !== 'VALIDATED') throw new HrPayrollError('La regla ACTIVE no tiene configuración legal VALIDATED', 409, 'HR_PAYROLL_VALIDATED_CONFIGURATION_REQUIRED');
    const config = validateLegalConfiguration(rule.activeConfigurationRevision.configuration);
    assertConfigurationMatchesCompanyTaxProfile(config, await companyTaxProfileRecord(tx, companyId));
    return { rule, configurationRevision: rule.activeConfigurationRevision, config };
}

async function addAnomaly(tx: Prisma.TransactionClient, data: { companyId: number; runId: number; employeeId?: number; userId?: number; code: string; message: string; severity?: 'INFO' | 'WARNING' | 'BLOCKING' }) {
    const severity = data.severity ?? 'BLOCKING';
    await tx.payrollAnomaly.create({ data: { ...data, severity, blocking: severity === 'BLOCKING' } });
}

function dateDays(from: Date, to: Date): number { return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1; }
function maxDate(a: Date, b: Date): Date { return a > b ? a : b; }
function minDate(a: Date, b: Date): Date { return a < b ? a : b; }
function intervalHasGap<T>(items: T[], from: Date, to: Date, start: (item: T) => Date, end: (item: T) => Date | null): boolean {
    let coveredThrough = new Date(from.getTime() - 86_400_000);
    for (const item of items) {
        if (start(item).getTime() > coveredThrough.getTime() + 86_400_000) return true;
        coveredThrough = end(item) ? maxDate(coveredThrough, end(item)!) : to;
        if (coveredThrough >= to) return false;
    }
    return coveredThrough < to;
}

async function hardenedCandidates(tx: Prisma.TransactionClient, companyId: number, branchIds: number[] | null, employeeIds: number[] | null, from: Date, to: Date) {
    return tx.employee.findMany({ where: {
        companyId, hireDate: { lte: to }, OR: [{ terminationDate: null }, { terminationDate: { gte: from } }],
        status: { in: ['ACTIVE', 'ON_LEAVE', 'TERMINATED'] },
        user: { accountType: 'INTERNAL' }, id: employeeIds?.length ? { in: employeeIds } : undefined,
        branchAssignments: branchIds?.length ? { some: { branchId: { in: branchIds }, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] } } : undefined,
    }, include: { user: { select: { ...userSelect, branchId: true } } } });
}

async function reserveCoverage(tx: Prisma.TransactionClient, input: { companyId: number; runId: number; userId: number; kind: PayrollRunKind; from: Date; to: Date }) {
    const duplicate = await tx.payrollCoverageClaim.findFirst({ where: {
        companyId: input.companyId, runId: { not: input.runId }, userId: input.userId, kind: input.kind,
        coverageFrom: { lte: input.to }, coverageTo: { gte: input.from }, release: null, run: { status: { not: 'VOID' } },
    }, select: { runId: true } });
    if (duplicate) return duplicate;
    const coverageKey = hashPayload({ kind: input.kind, from: dateKey(input.from), to: dateKey(input.to) });
    const existing = await tx.payrollCoverageClaim.findUnique({ where: { runId_userId_kind_coverageKey: { runId: input.runId, userId: input.userId, kind: input.kind, coverageKey } }, include: { release: true } });
    if (!existing) await tx.payrollCoverageClaim.create({ data: { companyId: input.companyId, runId: input.runId, userId: input.userId, kind: input.kind, coverageFrom: input.from, coverageTo: input.to, coverageKey } });
    return null;
}

export function compensationMinuteRate(item: { compensationType: string; amount: Prisma.Decimal; payFrequency: 'WEEKLY' | 'BIWEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' }, config: LegalConfiguration) {
    return item.compensationType === 'HOURLY' ? item.amount.dividedBy(60) : item.amount.dividedBy(config.regular.minuteDivisors[item.payFrequency]);
}

export function ordinaryMinutesExcludingApprovedOvertime(input: { ordinaryMinutes: number; approvedOvertimeMinutes: number }): number {
    return Math.max(0, input.ordinaryMinutes - input.approvedOvertimeMinutes);
}

export function normalizeFullCoverageSalary(input: {
    contractualAmount: Prisma.Decimal;
    ordinaryEarnings: Prisma.Decimal;
    paidLeaveEarnings: Prisma.Decimal;
    fullScheduledAttendance: boolean;
    fullyCoveredByPaidLeave: boolean;
}): { ordinaryEarnings: Prisma.Decimal; paidLeaveEarnings: Prisma.Decimal } {
    const contractualAmount = money(input.contractualAmount);
    if (input.fullScheduledAttendance) {
        return { ordinaryEarnings: contractualAmount, paidLeaveEarnings: new Prisma.Decimal(0) };
    }
    if (input.fullyCoveredByPaidLeave) {
        return { ordinaryEarnings: new Prisma.Decimal(0), paidLeaveEarnings: contractualAmount };
    }
    const paidLeaveEarnings = money(Prisma.Decimal.min(contractualAmount, Prisma.Decimal.max(0, input.paidLeaveEarnings)));
    const ordinaryEarnings = money(Prisma.Decimal.min(
        Prisma.Decimal.max(0, contractualAmount.minus(paidLeaveEarnings)),
        Prisma.Decimal.max(0, input.ordinaryEarnings),
    ));
    return { ordinaryEarnings, paidLeaveEarnings };
}

export type EffectivePublishedShiftEvidence = {
    scheduleId: number;
    scheduleRevision: number;
    scheduleStatus: string;
    shiftId: number;
    startAt: string;
    endAt: string;
    breakMinutes: number;
    paidBreak: boolean;
    branchId: number;
    timezoneSnapshot: string;
    branchTimezone: string;
    localDate: string;
    originalUserId: number;
    effectiveUserId: number;
    overrideId: number | null;
    overrideEffectiveAt: string | null;
};

type AttendanceCoverageSummary = {
    date: Date;
    branchId: number | null;
    scopeKey: string;
    scheduledMinutes: number | null;
    ordinaryMinutes: number;
    approvedOvertimeMinutes: number;
};

export function reconcilePublishedShiftSummaries(
    shifts: EffectivePublishedShiftEvidence[],
    summaries: AttendanceCoverageSummary[],
) {
    const expectedByScope = new Map<string, number>();
    for (const shift of shifts) {
        const expectedMinutes = scheduledWorkMinutes(shift);
        const key = `${shift.localDate}:BRANCH:${shift.branchId}`;
        expectedByScope.set(key, (expectedByScope.get(key) ?? 0) + expectedMinutes);
    }
    const summaryByScope = new Map(summaries.map(summary => [
        `${dateKey(summary.date)}:${summary.scopeKey}`,
        summary,
    ]));
    const incompleteScopes: string[] = [];
    let fullyAttended = expectedByScope.size > 0;
    for (const [key, expectedMinutes] of expectedByScope) {
        const summary = summaryByScope.get(key);
        const sourceComplete = expectedMinutes > 0 && summary?.branchId !== null &&
            summary?.scheduledMinutes === expectedMinutes;
        if (!sourceComplete) incompleteScopes.push(key);
        if (!sourceComplete || ordinaryMinutesExcludingApprovedOvertime(summary!) < expectedMinutes) fullyAttended = false;
    }
    return {
        expectedScopeCount: expectedByScope.size,
        incompleteScopes,
        fullScheduledAttendance: fullyAttended && incompleteScopes.length === 0,
    };
}

function publishedShiftFingerprint(shifts: EffectivePublishedShiftEvidence[]) {
    return hashPayload(shifts);
}

async function effectivePublishedShiftEvidence(
    tx: Prisma.TransactionClient,
    input: { companyId: number; userId: number; from: Date; to: Date },
): Promise<EffectivePublishedShiftEvidence[]> {
    const broadFrom = new Date(input.from.getTime() - 2 * 86_400_000);
    const broadTo = new Date(input.to.getTime() + 2 * 86_400_000);
    const shifts = await tx.scheduledShift.findMany({
        where: {
            companyId: input.companyId,
            status: 'SCHEDULED',
            schedule: { status: 'PUBLISHED' },
            startAt: { gte: broadFrom, lt: broadTo },
            OR: [
                { userId: input.userId, assignmentOverride: null },
                { assignmentOverride: { assignedUserId: input.userId } },
            ],
        },
        select: {
            id: true, userId: true, branchId: true, startAt: true, endAt: true,
            breakMinutes: true, paidBreak: true, timezoneSnapshot: true,
            schedule: { select: { id: true, revision: true, status: true } },
            branch: { select: { timezone: true } },
            assignmentOverride: { select: { id: true, assignedUserId: true, effectiveAt: true } },
        },
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
    const fromKey = dateKey(input.from);
    const toKey = dateKey(input.to);
    return shifts.map(shift => {
        const effectiveUserId = shift.assignmentOverride?.assignedUserId ?? shift.userId;
        const localDate = zonedDateKey(shift.startAt, shift.branch.timezone);
        return {
            scheduleId: shift.schedule.id,
            scheduleRevision: shift.schedule.revision,
            scheduleStatus: shift.schedule.status,
            shiftId: shift.id,
            startAt: shift.startAt.toISOString(),
            endAt: shift.endAt.toISOString(),
            breakMinutes: shift.breakMinutes,
            paidBreak: shift.paidBreak,
            branchId: shift.branchId,
            timezoneSnapshot: shift.timezoneSnapshot,
            branchTimezone: shift.branch.timezone,
            localDate,
            originalUserId: shift.userId,
            effectiveUserId,
            overrideId: shift.assignmentOverride?.id ?? null,
            overrideEffectiveAt: shift.assignmentOverride?.effectiveAt.toISOString() ?? null,
        };
    }).filter(shift => shift.effectiveUserId === input.userId && shift.localDate >= fromKey && shift.localDate <= toKey)
        .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.shiftId - b.shiftId);
}

function statutoryFlags(code: string, config: LegalConfiguration) {
    const concept = paymentConceptDefinition(config.statutory, code);
    const incomeTaxTreatment = concept?.type === 'INCOME' ? concept.incomeTaxTreatment : null;
    return {
        taxable: incomeTaxTreatment !== null,
        incomeTaxTreatment,
        incomeTaxDeductible: concept?.type === 'DEDUCTION' ? concept.incomeTaxDeductible : false,
        socialSecurityApplicable: concept?.type === 'INCOME' ? concept.socialSecurityApplicable : false,
        trainingContributionApplicable: concept?.type === 'INCOME' ? concept.trainingContributionApplicable : false,
    };
}

async function employerHeadcountAt(tx: Prisma.TransactionClient, companyId: number, from: Date, to: Date) {
    return tx.employee.count({ where: {
        companyId, hireDate: { lte: to },
        OR: [{ terminationDate: null }, { terminationDate: { gte: from } }],
        user: { accountType: 'INTERNAL' },
    } });
}

async function priorStatutoryContext(tx: Prisma.TransactionClient, input: {
    companyId: number;
    runId: number;
    userId: number;
    periodFrom: Date;
}) {
    const yearStart = new Date(Date.UTC(input.periodFrom.getUTCFullYear(), 0, 1));
    const candidates = await tx.payrollRun.findMany({
        where: {
            companyId: input.companyId, id: { not: input.runId }, kind: 'REGULAR',
            period: { dateFrom: { gte: yearStart }, dateTo: { lt: input.periodFrom } },
            snapshots: { some: { userId: input.userId } },
        },
        include: {
            period: { select: { id: true, code: true, dateFrom: true, dateTo: true, payDate: true } },
            reversals: { select: { id: true } },
            statutoryCalculations: {
                where: { userId: input.userId },
                select: {
                    calculationRevision: true, methodVersion: true, incomeTaxMethod: true, companyTaxRegime: true, payFrequency: true,
                    annualPeriods: true, currentRegularIncomeTaxNet: true,
                    regularIncomeTaxWithheld: true, occasionalIncomeTaxWithheld: true, incomeTaxRefund: true, variableIncomeTaxGross: true,
                    fixedCompensationAmount: true, annualProjection: true, currentOccasionalIncomeTaxNet: true,
                },
            },
            components: {
                where: { userId: input.userId },
                include: { reversal: { select: { id: true, amount: true } } },
                orderBy: { id: 'asc' },
            },
        },
        orderBy: [{ period: { dateTo: 'asc' } }, { id: 'asc' }],
    });
    const fingerprint = hashPayload(candidates.map(run => ({
        id: run.id, revision: run.revision, calculationRevision: run.calculationRevision,
        status: run.status, periodId: run.periodId, periodFrom: run.period ? dateKey(run.period.dateFrom) : null,
        periodTo: run.period ? dateKey(run.period.dateTo) : null, reversed: run.reversals.length > 0,
        statutoryCalculations: run.statutoryCalculations.map(item => ({
            calculationRevision: item.calculationRevision, methodVersion: item.methodVersion,
            incomeTaxMethod: item.incomeTaxMethod, companyTaxRegime: item.companyTaxRegime, payFrequency: item.payFrequency, annualPeriods: item.annualPeriods,
            currentRegularIncomeTaxNet: item.currentRegularIncomeTaxNet.toFixed(2),
            regularIncomeTaxWithheld: item.regularIncomeTaxWithheld.toFixed(2), incomeTaxRefund: item.incomeTaxRefund.toFixed(2),
            occasionalIncomeTaxWithheld: item.occasionalIncomeTaxWithheld.toFixed(2),
            variableIncomeTaxGross: item.variableIncomeTaxGross.toFixed(2), fixedCompensationAmount: item.fixedCompensationAmount.toFixed(2),
            annualProjection: item.annualProjection.toFixed(2), currentOccasionalIncomeTaxNet: item.currentOccasionalIncomeTaxNet.toFixed(2),
        })).sort((a, b) => a.calculationRevision - b.calculationRevision),
        components: run.components.map(component => ({
            id: component.id, code: component.code, type: component.type, source: component.source,
            amount: component.amount.toFixed(2), taxable: component.taxable,
            incomeTaxTreatment: component.incomeTaxTreatment,
            incomeTaxDeductible: component.incomeTaxDeductible,
            socialSecurityApplicable: component.socialSecurityApplicable,
            trainingContributionApplicable: component.trainingContributionApplicable,
            reversed: Boolean(component.reversal),
        })),
    })));
    const eligible = candidates.filter(run => run.status === 'PAID' && run.reversals.length === 0);
    const incompleteRuns = eligible.filter(run =>
        !run.calculationRevision ||
        !run.statutoryCalculations.some(item => item.calculationRevision === run.calculationRevision && item.methodVersion === 'ART19_V3' &&
            ['FIXED_PERIOD_PROJECTION', 'FIXED_SALARY_CHANGE', 'VARIABLE_ACCUMULATED'].includes(item.incomeTaxMethod)) ||
        run.components.some(component => !component.reversal && (
            (component.type === 'INCOME' && (
                component.taxable === null ||
                (component.taxable === true && component.incomeTaxTreatment === null) ||
                (component.taxable === false && component.incomeTaxTreatment !== null) ||
                component.socialSecurityApplicable === null ||
                component.trainingContributionApplicable === null
            )) ||
            (component.type === 'DEDUCTION' && component.source !== 'STATUTORY' && component.incomeTaxDeductible === null)
        )),
    );
    let priorRegularIncomeTaxNet = new Prisma.Decimal(0);
    let priorRegularIncomeTaxWithheld = new Prisma.Decimal(0);
    let priorOccasionalIncomeTaxWithheld = new Prisma.Decimal(0);
    let priorOccasionalIncomeTaxNet = new Prisma.Decimal(0);
    let latestFixedCompensationAmount = new Prisma.Decimal(0);
    let latestRegularIncomeTaxNet = new Prisma.Decimal(0);
    let priorFixedSalaryChangeActive = false;
    let priorFixedSalaryChangeAnnualProjection = new Prisma.Decimal(0);
    let priorHadVariableIncome = false;
    const priorCoverageIntervals: Array<{ dateFrom: Date; dateTo: Date }> = [];
    const priorPayFrequencies = new Set<string>();
    const priorAnnualPeriods = new Set<number>();
    const priorCompanyTaxRegimes = new Set<string>();
    let firstFiscalMonth: Date | null = null;
    for (const run of eligible) {
        const calculation = run.statutoryCalculations.find(item => item.calculationRevision === run.calculationRevision && item.methodVersion === 'ART19_V3');
        if (!calculation) continue;
        if (run.period) {
            priorCoverageIntervals.push({ dateFrom: run.period.dateFrom, dateTo: run.period.dateTo });
            const fiscalMonth = new Date(Date.UTC(run.period.payDate.getUTCFullYear(), run.period.payDate.getUTCMonth(), 1));
            if (!firstFiscalMonth || fiscalMonth < firstFiscalMonth) firstFiscalMonth = fiscalMonth;
        }
        priorPayFrequencies.add(calculation.payFrequency);
        priorAnnualPeriods.add(calculation.annualPeriods);
        priorCompanyTaxRegimes.add(calculation.companyTaxRegime);
        priorRegularIncomeTaxNet = priorRegularIncomeTaxNet.plus(calculation.currentRegularIncomeTaxNet);
        priorRegularIncomeTaxWithheld = priorRegularIncomeTaxWithheld.plus(calculation.regularIncomeTaxWithheld).minus(calculation.incomeTaxRefund);
        priorOccasionalIncomeTaxWithheld = priorOccasionalIncomeTaxWithheld.plus(calculation.occasionalIncomeTaxWithheld);
        priorOccasionalIncomeTaxNet = priorOccasionalIncomeTaxNet.plus(calculation.currentOccasionalIncomeTaxNet);
        latestFixedCompensationAmount = calculation.fixedCompensationAmount;
        latestRegularIncomeTaxNet = calculation.currentRegularIncomeTaxNet;
        priorFixedSalaryChangeActive = calculation.incomeTaxMethod === 'FIXED_SALARY_CHANGE';
        priorFixedSalaryChangeAnnualProjection = calculation.annualProjection;
        priorHadVariableIncome ||= calculation.incomeTaxMethod === 'VARIABLE_ACCUMULATED' || calculation.variableIncomeTaxGross.greaterThan(0);
    }
    return {
        priorPeriods: eligible.length,
        priorRegularIncomeTaxNet: money(Prisma.Decimal.max(0, priorRegularIncomeTaxNet)),
        priorRegularIncomeTaxWithheld: money(Prisma.Decimal.max(0, priorRegularIncomeTaxWithheld)),
        priorOccasionalIncomeTaxWithheld: money(Prisma.Decimal.max(0, priorOccasionalIncomeTaxWithheld)),
        priorOccasionalIncomeTaxNet: money(Prisma.Decimal.max(0, priorOccasionalIncomeTaxNet)),
        latestFixedCompensationAmount: money(latestFixedCompensationAmount),
        latestRegularIncomeTaxNet: money(latestRegularIncomeTaxNet),
        priorFixedSalaryChangeActive,
        priorFixedSalaryChangeAnnualProjection: money(priorFixedSalaryChangeAnnualProjection),
        priorHadVariableIncome,
        firstFiscalMonth,
        priorCoverageIntervals,
        priorPayFrequencies: [...priorPayFrequencies],
        priorAnnualPeriods: [...priorAnnualPeriods],
        priorCompanyTaxRegimes: [...priorCompanyTaxRegimes],
        historyFingerprint: fingerprint,
        historyComplete: incompleteRuns.length === 0,
        incompleteRunCodes: incompleteRuns.map(run => run.period?.code || `run:${run.id}`),
    };
}

function snapshotServiceRatio(snapshot: { sourceTrace: Prisma.JsonValue; coverageFrom: Date; coverageTo: Date }, period: { dateFrom: Date; dateTo: Date }) {
    const trace = snapshot.sourceTrace && typeof snapshot.sourceTrace === 'object' && !Array.isArray(snapshot.sourceTrace)
        ? snapshot.sourceTrace as Record<string, unknown> : {};
    const serviceFrom = typeof trace.serviceFrom === 'string' ? new Date(`${trace.serviceFrom}T00:00:00.000Z`) : snapshot.coverageFrom;
    const serviceTo = typeof trace.serviceTo === 'string' ? new Date(`${trace.serviceTo}T00:00:00.000Z`) : snapshot.coverageTo;
    return Prisma.Decimal.min(1, new Prisma.Decimal(Math.max(0, dateDays(maxDate(period.dateFrom, serviceFrom), minDate(period.dateTo, serviceTo)))).dividedBy(dateDays(period.dateFrom, period.dateTo)));
}

export function elapsedFiscalMonths(firstMonth: Date | null, currentPayDate: Date): number {
    const currentMonth = new Date(Date.UTC(currentPayDate.getUTCFullYear(), currentPayDate.getUTCMonth(), 1));
    if (!firstMonth) return 1;
    return Math.max(1, (currentMonth.getUTCFullYear() - firstMonth.getUTCFullYear()) * 12 + currentMonth.getUTCMonth() - firstMonth.getUTCMonth() + 1);
}

export function coversFiscalYearContinuously(intervals: Array<{ dateFrom: Date; dateTo: Date }>, fiscalYear: number): boolean {
    const fiscalStart = new Date(Date.UTC(fiscalYear, 0, 1));
    const fiscalEnd = new Date(Date.UTC(fiscalYear, 11, 31));
    let cursor = fiscalStart;
    for (const interval of [...intervals].sort((a, b) => a.dateFrom.getTime() - b.dateFrom.getTime())) {
        const from = maxDate(interval.dateFrom, fiscalStart);
        const to = minDate(interval.dateTo, fiscalEnd);
        if (to < fiscalStart || from > fiscalEnd) continue;
        if (from.getTime() > cursor.getTime()) return false;
        const next = new Date(to.getTime() + 86_400_000);
        if (next > cursor) cursor = next;
        if (cursor > fiscalEnd) return true;
    }
    return cursor > fiscalEnd;
}

export function assertPayrollPaymentDate(paymentDate: Date, expectedPaymentDate: Date | null | undefined) {
    if (!expectedPaymentDate || dateKey(paymentDate) !== dateKey(expectedPaymentDate)) {
        throw new HrPayrollError('La fecha real de pago debe coincidir con la fecha fiscal congelada de la corrida', 409, 'HR_PAYROLL_PAYMENT_DATE_MISMATCH');
    }
}

function employerIncomeTaxRefundAllowed(input: {
    snapshot: { sourceTrace: Prisma.JsonValue };
    period: { dateFrom: Date; dateTo: Date };
    priorPeriods: number;
    annualPeriods: number;
    priorCoverageIntervals: Array<{ dateFrom: Date; dateTo: Date }>;
}) {
    const trace = input.snapshot.sourceTrace && typeof input.snapshot.sourceTrace === 'object' && !Array.isArray(input.snapshot.sourceTrace)
        ? input.snapshot.sourceTrace as Record<string, unknown> : {};
    const fiscalYear = input.period.dateTo.getUTCFullYear();
    const fiscalStart = `${fiscalYear}-01-01`;
    const fiscalEnd = `${fiscalYear}-12-31`;
    const coverageComplete = coversFiscalYearContinuously([...input.priorCoverageIntervals, input.period], fiscalYear);
    return dateKey(input.period.dateTo) === fiscalEnd && input.priorPeriods + 1 === input.annualPeriods && coverageComplete &&
        typeof trace.hireDate === 'string' && trace.hireDate <= fiscalStart &&
        (trace.terminationDate === null || (typeof trace.terminationDate === 'string' && trace.terminationDate >= fiscalEnd));
}

async function applyStatutoryForUser(tx: Prisma.TransactionClient, input: {
    companyId: number;
    runId: number;
    userId: number;
    employeeId: number;
    calculationRevision: number;
    employerHeadcount: number;
    configurationRevisionId: number;
    config: LegalConfiguration;
    period: { dateFrom: Date; dateTo: Date; payDate: Date };
    snapshot: {
        sourceTrace: Prisma.JsonValue; coverageFrom: Date; coverageTo: Date; payFrequency: string | null;
        compensationType?: string | null; compensationAmount?: Prisma.Decimal | null;
    };
}) {
    await tx.payrollComponent.deleteMany({ where: { companyId: input.companyId, runId: input.runId, userId: input.userId, source: 'STATUTORY' } });
    await tx.payrollAnomaly.deleteMany({ where: { companyId: input.companyId, runId: input.runId, userId: input.userId, code: { in: ['UNCLASSIFIED_MANUAL_INCOME', 'UNCONFIGURED_PAYMENT_CONCEPT', 'MISSING_STATUTORY_PAY_FREQUENCY', 'INSS_MINIMUM_BASE_APPLIED', 'INCOMPLETE_PRIOR_STATUTORY_HISTORY', 'IR_CREDIT_PENDING_SETTLEMENT'] }, resolvedAt: null } });
    if (!['WEEKLY', 'BIWEEKLY', 'FORTNIGHTLY', 'MONTHLY'].includes(String(input.snapshot.payFrequency))) {
        await addAnomaly(tx, { companyId: input.companyId, runId: input.runId, employeeId: input.employeeId, userId: input.userId, code: 'MISSING_STATUTORY_PAY_FREQUENCY', message: 'No existe frecuencia de pago congelada para el cálculo estatutario' });
        return;
    }
    const incomeComponents = await tx.payrollComponent.findMany({ where: {
        companyId: input.companyId, runId: input.runId, userId: input.userId, type: 'INCOME', source: { not: 'STATUTORY' }, reversal: null,
    }, orderBy: { id: 'asc' } });
    const manualComponents = await tx.payrollComponent.findMany({ where: { companyId: input.companyId, runId: input.runId, userId: input.userId, source: 'MANUAL', reversal: null }, orderBy: { id: 'asc' } });
    const unclassified = manualComponents.filter(component => {
        const concept = paymentConceptDefinition(input.config.statutory, component.code);
        const flags = statutoryFlags(component.code, input.config);
        return !concept || component.type !== concept.type || component.taxable !== flags.taxable ||
            component.incomeTaxTreatment !== flags.incomeTaxTreatment || component.incomeTaxDeductible !== flags.incomeTaxDeductible ||
            component.socialSecurityApplicable !== flags.socialSecurityApplicable ||
            component.trainingContributionApplicable !== flags.trainingContributionApplicable;
    });
    if (unclassified.length) await addAnomaly(tx, {
        companyId: input.companyId, runId: input.runId, employeeId: input.employeeId, userId: input.userId,
        code: 'UNCLASSIFIED_MANUAL_INCOME', message: `Los componentes manuales ${unclassified.map(item => item.id).join(', ')} no coinciden con el catálogo de pagos congelado`,
    });
    const sum = (predicate: (component: typeof incomeComponents[number]) => boolean) => money(incomeComponents.filter(predicate).reduce((total, component) => total.plus(component.amount), new Prisma.Decimal(0)));
    const currentInssBase = sum(component => component.socialSecurityApplicable === true);
    const occasionalInssBase = sum(component => component.socialSecurityApplicable === true && component.taxable === true && component.incomeTaxTreatment === 'OCCASIONAL');
    const regularInssBase = money(currentInssBase.minus(occasionalInssBase));
    const currentInatecBase = sum(component => component.trainingContributionApplicable === true);
    const fixedIncomeTaxGross = sum(component => component.taxable === true && component.incomeTaxTreatment === 'REGULAR_FIXED');
    const variableIncomeTaxGross = sum(component => component.taxable === true && component.incomeTaxTreatment === 'REGULAR_VARIABLE');
    const occasionalIncomeTaxGross = sum(component => component.taxable === true && component.incomeTaxTreatment === 'OCCASIONAL');
    const otherIncomeTaxDeductions = money((await tx.payrollComponent.findMany({ where: {
        companyId: input.companyId, runId: input.runId, userId: input.userId, type: 'DEDUCTION', source: { not: 'STATUTORY' }, incomeTaxDeductible: true, reversal: null,
    } })).reduce((total, component) => total.plus(component.amount), new Prisma.Decimal(0)));
    const prior = await priorStatutoryContext(tx, { companyId: input.companyId, runId: input.runId, userId: input.userId, periodFrom: input.period.dateFrom });
    if (!prior.historyComplete) await addAnomaly(tx, {
        companyId: input.companyId, runId: input.runId, employeeId: input.employeeId, userId: input.userId,
        code: 'INCOMPLETE_PRIOR_STATUTORY_HISTORY',
        message: `Las planillas pagadas ${prior.incompleteRunCodes.join(', ')} no tienen clasificación y traza estatutaria V3 completas; concilie y haga backfill antes de aprobar`,
    });
    if (prior.priorCompanyTaxRegimes.some(regime => regime !== input.config.statutory.companyTaxRegime.code)) {
        throw new HrPayrollError('El régimen tributario empresarial cambió dentro del año fiscal; liquide y documente el cambio antes de continuar', 409, 'HR_PAYROLL_COMPANY_TAX_REGIME_CHANGED');
    }
    const annualPeriods = input.config.statutory.incomeTax.annualPeriods[input.snapshot.payFrequency as StatutoryPayFrequency];
    if (prior.priorPayFrequencies.some(value => value !== input.snapshot.payFrequency) || prior.priorAnnualPeriods.some(value => value !== annualPeriods)) {
        throw new HrPayrollError(
            'La frecuencia o cantidad anual de períodos cambió dentro del año fiscal; liquide el tramo anterior antes de continuar',
            409,
            'HR_PAYROLL_FISCAL_FREQUENCY_CHANGED',
        );
    }
    if (prior.priorPeriods >= annualPeriods) {
        throw new HrPayrollError('La cantidad de períodos pagados excede la periodicidad fiscal configurada; cargue una regla anual correcta', 409, 'HR_PAYROLL_FISCAL_PERIOD_COUNT_EXCEEDED');
    }
    const result = calculateStatutoryPayroll(input.config.statutory, {
        inssContributionBase: currentInssBase, regularInssContributionBase: regularInssBase,
        occasionalInssContributionBase: occasionalInssBase, inatecContributionBase: currentInatecBase,
        fixedIncomeTaxGross, variableIncomeTaxGross, occasionalIncomeTaxGross, otherIncomeTaxDeductions,
        priorRegularIncomeTaxNet: prior.priorRegularIncomeTaxNet, priorOccasionalIncomeTaxNet: prior.priorOccasionalIncomeTaxNet,
        priorRegularIncomeTaxWithheld: prior.priorRegularIncomeTaxWithheld,
        priorOccasionalIncomeTaxWithheld: prior.priorOccasionalIncomeTaxWithheld,
        priorHadVariableIncome: prior.priorHadVariableIncome,
        currentFixedCompensationAmount: input.snapshot.compensationType === 'SALARY' ? input.snapshot.compensationAmount ?? 0 : 0,
        latestFixedCompensationAmount: prior.latestFixedCompensationAmount,
        latestRegularIncomeTaxNet: prior.latestRegularIncomeTaxNet,
        priorFixedSalaryChangeActive: prior.priorFixedSalaryChangeActive,
        priorFixedSalaryChangeAnnualProjection: prior.priorFixedSalaryChangeAnnualProjection,
        employerRefundAllowed: employerIncomeTaxRefundAllowed({
            snapshot: input.snapshot, period: input.period, priorPeriods: prior.priorPeriods,
            annualPeriods, priorCoverageIntervals: prior.priorCoverageIntervals,
        }),
        priorPeriods: prior.priorPeriods,
        elapsedFiscalMonths: elapsedFiscalMonths(prior.firstFiscalMonth, input.period.payDate),
        payFrequency: input.snapshot.payFrequency as StatutoryPayFrequency,
        employerHeadcount: input.employerHeadcount, serviceRatio: snapshotServiceRatio(input.snapshot, input.period),
    });
    if (result.inssBase.greaterThan(currentInssBase)) await addAnomaly(tx, {
        companyId: input.companyId, runId: input.runId, employeeId: input.employeeId, userId: input.userId,
        code: 'INSS_MINIMUM_BASE_APPLIED', severity: 'WARNING', message: `La base cotizable fue elevada de ${currentInssBase.toFixed(2)} a ${result.inssBase.toFixed(2)} por el mínimo sectorial configurado; valide jornada y período incompleto`,
    });
    if (result.incomeTaxCreditBalance.greaterThan(result.incomeTaxRefund)) await addAnomaly(tx, {
        companyId: input.companyId, runId: input.runId, employeeId: input.employeeId, userId: input.userId,
        code: 'IR_CREDIT_PENDING_SETTLEMENT', severity: 'WARNING',
        message: `Existe un exceso calculado de IR por ${result.incomeTaxCreditBalance.toFixed(2)} que no se devolverá automáticamente; requiere liquidación anual o gestión ante DGI según el período laboral`,
    });
    const statutoryTrace = await tx.payrollStatutoryCalculation.create({ data: {
        companyId: input.companyId, runId: input.runId, userId: input.userId, calculationRevision: input.calculationRevision,
        configurationRevisionId: input.configurationRevisionId, companyTaxRegime: input.config.statutory.companyTaxRegime.code,
        methodVersion: 'ART19_V3', incomeTaxMethod: result.incomeTaxMethod,
        payFrequency: input.snapshot.payFrequency!, employerHeadcount: input.employerHeadcount,
        inssBase: result.inssBase, employeeInss: result.employeeInss, regularEmployeeInss: result.regularEmployeeInss,
        occasionalEmployeeInss: result.occasionalEmployeeInss, employerInssRate: result.employerInssRate,
        employerInss: result.employerInss, inatecBase: result.inatecBase, employerInatec: result.employerInatec,
        fixedIncomeTaxGross: result.fixedIncomeTaxGross, variableIncomeTaxGross: result.variableIncomeTaxGross,
        occasionalIncomeTaxGross: result.occasionalIncomeTaxGross,
        fixedCompensationAmount: input.snapshot.compensationType === 'SALARY' ? input.snapshot.compensationAmount ?? 0 : 0,
        currentRegularIncomeTaxNet: result.currentRegularIncomeTaxNet, currentOccasionalIncomeTaxNet: result.currentOccasionalIncomeTaxNet,
        currentIncomeTaxNet: result.currentIncomeTaxNet, otherIncomeTaxDeductions: result.otherIncomeTaxDeductions,
        priorIncomeTaxNet: prior.priorRegularIncomeTaxNet, priorOccasionalIncomeTaxNet: prior.priorOccasionalIncomeTaxNet,
        priorHadVariableIncome: prior.priorHadVariableIncome,
        accumulatedIncomeTaxNet: result.accumulatedIncomeTaxNet, elapsedPeriods: result.elapsedPeriods,
        elapsedFiscalMonths: result.elapsedFiscalMonths, annualPeriods: result.annualPeriods,
        annualProjection: result.annualProjection, regularAnnualIncomeTax: result.regularAnnualIncomeTax,
        annualIncomeTaxWithOccasional: result.annualIncomeTaxWithOccasional, annualIncomeTax: result.annualIncomeTax,
        priorRegularIncomeTaxWithheld: result.priorRegularIncomeTaxWithheld,
        priorOccasionalIncomeTaxWithheld: result.priorOccasionalIncomeTaxWithheld,
        priorIncomeTaxWithheld: result.priorRegularIncomeTaxWithheld,
        regularIncomeTaxWithheld: result.regularIncomeTaxWithholding,
        occasionalIncomeTaxWithheld: result.occasionalIncomeTaxWithholding,
        currentIncomeTaxWithheld: result.currentIncomeTaxWithholding,
        incomeTaxRefund: result.incomeTaxRefund, incomeTaxCreditBalance: result.incomeTaxCreditBalance,
        bracketSnapshot: result.bracketSnapshot as unknown as Prisma.InputJsonValue,
        historyFingerprint: prior.historyFingerprint,
    } });
    const traceReference = `statutory:${statutoryTrace.id};config:${input.configurationRevisionId};revision:${input.calculationRevision}`;
    if (result.employeeInss.greaterThan(0)) await tx.payrollComponent.create({ data: {
        companyId: input.companyId, runId: input.runId, userId: input.userId, code: 'INSS_LABORAL', name: 'INSS laboral',
        type: 'DEDUCTION', source: 'STATUTORY', amount: result.employeeInss, taxable: false,
        incomeTaxTreatment: null, incomeTaxDeductible: true,
        socialSecurityApplicable: false, trainingContributionApplicable: false, traceReference,
    } });
    if (result.currentIncomeTaxWithholding.greaterThan(0)) await tx.payrollComponent.create({ data: {
        companyId: input.companyId, runId: input.runId, userId: input.userId, code: 'IR_LABORAL', name: 'IR de rentas del trabajo',
        type: 'DEDUCTION', source: 'STATUTORY', amount: result.currentIncomeTaxWithholding, taxable: false,
        incomeTaxTreatment: null, incomeTaxDeductible: false,
        socialSecurityApplicable: false, trainingContributionApplicable: false, traceReference,
    } });
    if (result.incomeTaxRefund.greaterThan(0)) await tx.payrollComponent.create({ data: {
        companyId: input.companyId, runId: input.runId, userId: input.userId, code: 'IR_LABORAL_DEVOLUCION', name: 'Ajuste a favor de IR laboral',
        type: 'INCOME', source: 'STATUTORY', amount: result.incomeTaxRefund, taxable: false,
        incomeTaxTreatment: null, incomeTaxDeductible: false,
        socialSecurityApplicable: false, trainingContributionApplicable: false, traceReference,
    } });
    if (result.employerInss.greaterThan(0)) await tx.payrollEmployerContribution.create({ data: {
        companyId: input.companyId, runId: input.runId, userId: input.userId, calculationRevision: input.calculationRevision,
        code: 'INSS_PATRONAL', name: 'INSS patronal', baseAmount: result.inssBase,
        rate: result.employerInssRate, amount: result.employerInss, traceReference,
    } });
    if (result.employerInatec.greaterThan(0)) await tx.payrollEmployerContribution.create({ data: {
        companyId: input.companyId, runId: input.runId, userId: input.userId, calculationRevision: input.calculationRevision,
        code: 'INATEC_PATRONAL', name: 'Aporte INATEC', baseAmount: result.inatecBase,
        rate: new Prisma.Decimal(input.config.statutory.inatec.employerRate), amount: result.employerInatec, traceReference,
    } });
}

async function calculate(tx: Prisma.TransactionClient, companyId: number, runId: number, actorId: number, kind: PayrollRunKind, reason: string) {
    const run = await tx.payrollRun.findFirst({ where: { id: runId, companyId, kind }, include: { period: true } });
    if (!run || !['DRAFT', 'CALCULATED'].includes(run.status)) throw new HrPayrollError('La corrida no admite cálculo', 409, 'HR_PAYROLL_RUN_IMMUTABLE');
    if (kind === 'REGULAR') {
        if (!run.period) throw new HrPayrollError('La corrida regular no conserva período', 409, 'HR_PAYROLL_SOURCE_STALE');
        assertRegularFiscalPeriod(run.period);
    }
    const calculationRevision = run.revision + 1;
    const cutoff = kind === 'REGULAR' ? run.period!.dateTo : run.cutoffDate!;
    const { config, configurationRevision } = await ensureActiveRule(tx, companyId, run.ruleVersionId, cutoff);
    const coverageFrom = kind === 'REGULAR' ? run.period!.dateFrom : new Date(cutoff.getTime() - (config.aguinaldo.lookbackDays - 1) * 86_400_000);
    const attendancePeriod = kind === 'REGULAR' ? await tx.attendancePeriod.findFirst({ where: { companyId, status: 'CLOSED', payrollEligible: true, dateFrom: coverageFrom, dateTo: cutoff }, select: { id: true, revision: true, status: true, payrollEligible: true } }) : null;
    if (kind === 'REGULAR' && !attendancePeriod) throw new HrPayrollError('El período de asistencia debe estar CLOSED y payrollEligible', 409, 'HR_PAYROLL_ATTENDANCE_PERIOD_NOT_ELIGIBLE');
    await tx.payrollSnapshotLine.deleteMany({ where: { companyId, runId } });
    await tx.payrollAnomaly.deleteMany({ where: { companyId, runId } });
    await tx.payrollComponent.deleteMany({ where: { companyId, runId, source: { not: 'MANUAL' } } });
    const branches = Array.isArray(run.branchIds) ? run.branchIds as number[] : null;
    const selectedEmployees = Array.isArray(run.employeeIds) ? run.employeeIds as number[] : null;
    const employees = await hardenedCandidates(tx, companyId, branches, selectedEmployees, coverageFrom, cutoff);
    if (!employees.length) await addAnomaly(tx, { companyId, runId, code: 'NO_ELIGIBLE_SUBJECTS', message: 'No existen sujetos elegibles para la cobertura' });
    if (selectedEmployees?.length) for (const employeeId of selectedEmployees.filter(id => !employees.some(employee => employee.id === id))) await addAnomaly(tx, { companyId, runId, employeeId, code: 'OMITTED_SELECTED_SUBJECT', message: 'El sujeto seleccionado quedó fuera por fecha de alta/baja o elegibilidad' });
    const dependencyRevisions: Array<{ id: number; revision: number }> = [];
    for (const employee of employees) {
        const duplicate = await reserveCoverage(tx, { companyId, runId, userId: employee.userId, kind, from: coverageFrom, to: cutoff });
        if (duplicate) { await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'DUPLICATE_COVERAGE', message: `Cobertura reclamada por corrida ${duplicate.runId}` }); continue; }
        const serviceFrom = maxDate(coverageFrom, employee.hireDate); const serviceTo = employee.terminationDate ? minDate(cutoff, employee.terminationDate) : cutoff;
        const contracts = await tx.employmentContract.findMany({ where: { companyId, employeeId: employee.id, startDate: { lte: serviceTo }, OR: [{ endDate: null }, { endDate: { gte: serviceFrom } }], status: { in: ['ACTIVE', 'EXPIRED', 'TERMINATED'] } }, orderBy: { startDate: 'asc' } });
        const compensations = await tx.compensationHistory.findMany({ where: { companyId, employeeId: employee.id, effectiveFrom: { lte: serviceTo }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: serviceFrom } }] }, orderBy: { effectiveFrom: 'asc' } });
        if (!contracts.length) await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'MISSING_CONTRACT', message: 'No existe contrato durante la cobertura' });
        if (!compensations.length) await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'MISSING_COMPENSATION_SEGMENT', message: 'No existe historial de compensación durante la cobertura' });
        if (kind === 'REGULAR' && new Set(compensations.map(item => `${item.compensationType}:${item.amount.toFixed(2)}:${item.payFrequency}`)).size > 1) await addAnomaly(tx, {
            companyId, runId, employeeId: employee.id, userId: employee.userId,
            code: 'MID_PERIOD_COMPENSATION_CHANGE_REQUIRES_TAX_REVIEW',
            message: 'La compensación cambia dentro del período; divida la cobertura o documente un cálculo fiscal que separe neto real y expectativa futura antes de aprobar',
        });
        if (contracts.length && intervalHasGap(contracts, serviceFrom, serviceTo, item => item.startDate, item => item.endDate)) await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'CONTRACT_COVERAGE_GAP', message: 'El contrato no cubre de forma continua el período de servicio' });
        if (compensations.length && intervalHasGap(compensations, serviceFrom, serviceTo, item => item.effectiveFrom, item => item.effectiveTo)) await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'COMPENSATION_COVERAGE_GAP', message: 'La compensación no cubre de forma continua el período de servicio' });
        const stableSalary = compensations.length > 0 && compensations.every(item =>
            item.compensationType === 'SALARY' && item.amount.equals(compensations[0].amount) &&
            item.currency === compensations[0].currency && item.payFrequency === compensations[0].payFrequency
        );
        const hasFullServiceCoverage = serviceFrom.getTime() === coverageFrom.getTime() && serviceTo.getTime() === cutoff.getTime();
        const summaries = kind === 'REGULAR' ? await tx.attendanceDailySummary.findMany({ where: { companyId, userId: employee.userId, periodId: attendancePeriod!.id }, select: { id: true, date: true, branchId: true, scopeKey: true, scheduledMinutes: true, ordinaryMinutes: true, approvedOvertimeMinutes: true, sourceRevision: true }, orderBy: { date: 'asc' } }) : [];
        const summaryRevisions = summaries.map(item => ({ id: item.id, revision: item.sourceRevision })); dependencyRevisions.push(...summaryRevisions);
        const leaves = kind === 'REGULAR' ? await tx.leaveRequest.findMany({ where: { companyId, userId: employee.userId, status: 'APPROVED', startDate: { lte: cutoff }, endDate: { gte: coverageFrom } }, include: { leaveType: { select: { paid: true, code: true } } } }) : [];
        const paidLeaveCoverage = leaves.filter(item => item.leaveType.paid).sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
        const fullyCoveredByPaidLeave = paidLeaveCoverage.length > 0 && !intervalHasGap(paidLeaveCoverage, serviceFrom, serviceTo, item => item.startDate, item => item.endDate);
        const publishedShiftEvidence = kind === 'REGULAR' ? await effectivePublishedShiftEvidence(tx, {
            companyId, userId: employee.userId, from: serviceFrom, to: serviceTo,
        }) : [];
        const publishedShiftCoverage = reconcilePublishedShiftSummaries(publishedShiftEvidence, summaries);
        const missingPublishedShiftEvidence = stableSalary && hasFullServiceCoverage && !fullyCoveredByPaidLeave &&
            publishedShiftCoverage.expectedScopeCount === 0;
        if (kind === 'REGULAR' && (publishedShiftCoverage.incompleteScopes.length > 0 || missingPublishedShiftEvidence)) await addAnomaly(tx, {
            companyId, runId, employeeId: employee.id, userId: employee.userId,
            code: 'INCOMPLETE_ATTENDANCE_SUMMARIES',
            message: missingPublishedShiftEvidence
                ? 'El salario fijo de cobertura completa no tiene turnos publicados efectivos para reconciliar su evidencia diaria'
                : `Falta evidencia diaria completa para ${publishedShiftCoverage.incompleteScopes.length} fecha(s)/sucursal con turno publicado efectivo: ${publishedShiftCoverage.incompleteScopes.join(', ')}`,
        });
        if (kind === 'REGULAR' && summaries.length === 0 && !fullyCoveredByPaidLeave) await addAnomaly(tx, {
            companyId, runId, employeeId: employee.id, userId: employee.userId,
            code: 'MISSING_ATTENDANCE_SUMMARIES',
            message: 'El colaborador no tiene resúmenes diarios ni una ausencia pagada que cubra todo el período; no se permite una planilla fiscal en cero sin evidencia',
        });
        const crossing = leaves.find(item => item.startDate < coverageFrom || item.endDate > cutoff);
        if (crossing) await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'CROSS_BOUNDARY_LEAVE', message: `Ausencia ${crossing.id} cruza la cobertura; requiere prorrateo autorizado` });
        let ordinary = new Prisma.Decimal(0); let overtime = new Prisma.Decimal(0); let paidLeave = new Prisma.Decimal(0);
        const compensationSegments: JsonObject[] = []; const historicalSegments: JsonObject[] = [];
        if (kind === 'REGULAR' && !crossing) {
            for (const summary of summaries) {
                const segment = compensations.find(item => item.effectiveFrom <= summary.date && (!item.effectiveTo || item.effectiveTo >= summary.date));
                if (!segment) { await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'COMPENSATION_GAP', message: `Falta compensación para ${dateKey(summary.date)}` }); continue; }
                try {
                    const base = convertCurrency(compensationMinuteRate(segment, config).times(ordinaryMinutesExcludingApprovedOvertime(summary)), segment.currency, config);
                    const extra = convertCurrency(compensationMinuteRate(segment, config).times(summary.approvedOvertimeMinutes).times(config.regular.overtimeMultiplier), segment.currency, config);
                    ordinary = ordinary.plus(base.amount); overtime = overtime.plus(extra.amount);
                    compensationSegments.push({ id: segment.id, date: dateKey(summary.date), compensationType: segment.compensationType, payFrequency: segment.payFrequency, amount: segment.amount.toString(), currency: segment.currency, ordinaryMinutes: summary.ordinaryMinutes, overtimeMinutes: summary.approvedOvertimeMinutes, fx: base.trace });
                } catch (error) { await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'CURRENCY_WITHOUT_VERSIONED_FX', message: error instanceof Error ? error.message : 'Moneda sin FX versionado' }); }
            }
            for (const leave of leaves.filter(item => item.leaveType.paid)) {
                const segment = compensations.find(item => item.effectiveFrom <= leave.startDate && (!item.effectiveTo || item.effectiveTo >= leave.startDate)); if (!segment) continue;
                try { paidLeave = paidLeave.plus(convertCurrency(compensationMinuteRate(segment, config).times(leave.requestedAmount).times(config.regular.paidLeaveUnitMinutes[leave.balanceUnit]), segment.currency, config).amount); }
                catch (error) { await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'CURRENCY_WITHOUT_VERSIONED_FX', message: error instanceof Error ? error.message : 'Moneda sin FX versionado' }); }
            }
            if (stableSalary && hasFullServiceCoverage) {
                try {
                    const contractualAmount = convertCurrency(compensations[0].amount, compensations[0].currency, config).amount;
                    const normalized = normalizeFullCoverageSalary({
                        contractualAmount,
                        ordinaryEarnings: ordinary,
                        paidLeaveEarnings: paidLeave,
                        fullScheduledAttendance: publishedShiftCoverage.fullScheduledAttendance,
                        fullyCoveredByPaidLeave,
                    });
                    ordinary = normalized.ordinaryEarnings;
                    paidLeave = normalized.paidLeaveEarnings;
                } catch (error) {
                    await addAnomaly(tx, {
                        companyId, runId, employeeId: employee.id, userId: employee.userId,
                        code: 'CURRENCY_WITHOUT_VERSIONED_FX',
                        message: error instanceof Error ? error.message : 'Moneda sin FX versionado',
                    });
                }
            }
        }
        if (kind === 'AGUINALDO') {
            const history = await tx.payrollComponent.findMany({ where: {
                companyId, userId: employee.userId, type: 'INCOME', source: { in: config.aguinaldo.eligibleSources }, reversal: null,
                run: { kind: 'REGULAR', status: 'PAID', reversals: { none: {} }, period: { dateTo: { gte: coverageFrom }, dateFrom: { lte: cutoff } } },
                receipt: { status: 'PUBLISHED' },
            }, include: { receipt: true, run: { include: { period: true, reversals: { select: { id: true } } } } }, orderBy: { createdAt: 'asc' } });
            let eligibleIncome = new Prisma.Decimal(0);
            for (const item of history) try {
                if (!item.receipt || item.receipt.runId !== item.runId || item.receipt.userId !== item.userId) throw new HrPayrollError('El componente histórico no tiene un recibo publicado consistente', 409, 'HR_PAYROLL_AGUINALDO_SOURCE_STALE');
                const fx = convertCurrency(item.amount, item.run.currency, config); eligibleIncome = eligibleIncome.plus(fx.amount);
                await tx.payrollAguinaldoSourceDependency.create({ data: {
                    companyId, targetRunId: runId, calculationRevision, sourceRunId: item.runId, sourceComponentId: item.id, sourceReceiptId: item.receipt.id,
                    capturedRunRevision: item.run.revision, capturedRunStatus: item.run.status, capturedRunCurrency: item.run.currency,
                    capturedComponentAmount: item.amount, capturedReceiptStatus: item.receipt.status,
                    capturedComponentReversed: false, capturedRunReversed: item.run.reversals.length > 0,
                } });
                historicalSegments.push({ componentId: item.id, runId: item.runId, receiptId: item.receipt.id, dependencyRevision: calculationRevision, from: dateKey(item.run.period!.dateFrom), to: dateKey(item.run.period!.dateTo), source: item.source, amount: item.amount.toString(), currency: item.run.currency, fx: fx.trace });
            } catch (error) { await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: error instanceof HrPayrollError ? error.code : 'CURRENCY_WITHOUT_VERSIONED_FX', message: error instanceof Error ? error.message : 'Fuente histórica inválida' }); }
            if (!history.length) await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'MISSING_AGUINALDO_HISTORY', message: 'No existe histórico real pagado elegible' });
            const serviceDays = Math.max(0, dateDays(serviceFrom, serviceTo)); const ratio = config.aguinaldo.prorationMode === 'SERVICE_DAYS_RATIO' ? Prisma.Decimal.min(1, new Prisma.Decimal(serviceDays).dividedBy(config.aguinaldo.lookbackDays)) : new Prisma.Decimal(1);
            ordinary = money(eligibleIncome.dividedBy(config.aguinaldo.incomeDivisor).times(ratio));
        }
        const ordinaryMinutes = summaries.reduce((sum, item) => sum + item.ordinaryMinutes, 0); const approvedOvertimeMinutes = summaries.reduce((sum, item) => sum + item.approvedOvertimeMinutes, 0);
        await tx.payrollSnapshotLine.create({ data: {
            companyId, runId, userId: employee.userId, employeeId: employee.id, branchId: employee.user.branchId, attendancePeriodId: attendancePeriod?.id,
            compensationHistoryId: compensations[compensations.length - 1]?.id, ordinaryMinutes, approvedOvertimeMinutes, paidLeaveAmount: money(paidLeave), compensationAmount: compensations[compensations.length - 1]?.amount,
            compensationType: compensations[compensations.length - 1]?.compensationType, payFrequency: compensations[compensations.length - 1]?.payFrequency, currency: config.currency,
            sourceRevision: summaryRevisions.reduce((max, item) => Math.max(max, item.revision), 0) || null, coverageFrom, coverageTo: cutoff,
            attendancePeriodRevision: attendancePeriod?.revision, attendancePeriodStatus: attendancePeriod?.status, summaryRevisions,
            contractSegments: contracts.map(item => ({ id: item.id, from: dateKey(item.startDate), to: item.endDate ? dateKey(item.endDate) : null, status: item.status })) as Prisma.InputJsonValue,
            compensationSegments: compensationSegments as Prisma.InputJsonValue,
            aguinaldoIncomeSegments: historicalSegments as Prisma.InputJsonValue,
            sourceTrace: {
                hireDate: dateKey(employee.hireDate), terminationDate: employee.terminationDate ? dateKey(employee.terminationDate) : null,
                serviceFrom: dateKey(serviceFrom), serviceTo: dateKey(serviceTo),
                configurationRevisionId: configurationRevision.id, configurationHash: configurationRevision.configurationHash,
                approvedLeaves: leaves.map(item => ({ id: item.id, from: dateKey(item.startDate), to: dateKey(item.endDate), paid: item.leaveType.paid, amount: item.requestedAmount.toString(), unit: item.balanceUnit })),
                publishedShiftEvidence,
                publishedShiftFingerprint: publishedShiftFingerprint(publishedShiftEvidence),
                frozen: true,
            },
        } });
        const ordinaryCode = kind === 'AGUINALDO' ? 'AGUINALDO_HISTORICO'
            : compensations.length > 0 && compensations.every(item => item.compensationType === 'SALARY')
                ? 'INGRESO_ORDINARIO_FIJO' : 'INGRESO_ORDINARIO_VARIABLE';
        const ordinaryFlags = kind === 'REGULAR' ? statutoryFlags(ordinaryCode, config) : { taxable: false, incomeTaxTreatment: null, incomeTaxDeductible: false, socialSecurityApplicable: false, trainingContributionApplicable: false };
        const overtimeFlags = statutoryFlags('HORAS_EXTRA_APROBADAS', config);
        const paidLeaveFlags = statutoryFlags('PERMISO_PAGADO_APROBADO', config);
        const ordinaryName = kind === 'AGUINALDO' ? 'Aguinaldo histórico parametrizado' : paymentConceptDefinition(config.statutory, ordinaryCode)?.name ?? ordinaryCode;
        const overtimeName = paymentConceptDefinition(config.statutory, 'HORAS_EXTRA_APROBADAS')?.name ?? 'HORAS_EXTRA_APROBADAS';
        const paidLeaveName = paymentConceptDefinition(config.statutory, 'PERMISO_PAGADO_APROBADO')?.name ?? 'PERMISO_PAGADO_APROBADO';
        if (kind === 'REGULAR') for (const [code, amount] of [
            [ordinaryCode, ordinary],
            ['HORAS_EXTRA_APROBADAS', overtime],
            ['PERMISO_PAGADO_APROBADO', paidLeave],
        ] as const) if (amount.greaterThan(0) && !paymentConceptDefinition(config.statutory, code)) await addAnomaly(tx, {
            companyId, runId, employeeId: employee.id, userId: employee.userId,
            code: 'UNCONFIGURED_PAYMENT_CONCEPT', message: `El concepto automático ${code} no existe en el catálogo de pagos V4 congelado`,
        });
        if (ordinary.greaterThan(0)) await tx.payrollComponent.create({ data: { companyId, runId, userId: employee.userId, code: ordinaryCode, name: ordinaryName, type: 'INCOME', source: 'RULE', amount: money(ordinary), ...ordinaryFlags, traceReference: `snapshot:user:${employee.userId};config:${configurationRevision.id}` } });
        if (overtime.greaterThan(0)) await tx.payrollComponent.create({ data: { companyId, runId, userId: employee.userId, code: 'HORAS_EXTRA_APROBADAS', name: overtimeName, type: 'INCOME', source: 'OVERTIME', amount: money(overtime), ...overtimeFlags, traceReference: `snapshot:user:${employee.userId}` } });
        if (paidLeave.greaterThan(0)) await tx.payrollComponent.create({ data: { companyId, runId, userId: employee.userId, code: 'PERMISO_PAGADO_APROBADO', name: paidLeaveName, type: 'INCOME', source: 'LEAVE', amount: money(paidLeave), ...paidLeaveFlags, traceReference: `snapshot:user:${employee.userId}` } });
        if (kind === 'REGULAR') await projectBenefitDeductions(tx, { companyId, runId, userId: employee.userId, currency: config.currency, cutoff });
    }
    let employerContributions = new Prisma.Decimal(0);
    if (kind === 'REGULAR') {
        const employerHeadcount = await employerHeadcountAt(tx, companyId, run.period!.dateFrom, run.period!.dateTo);
        const snapshots = await tx.payrollSnapshotLine.findMany({ where: { companyId, runId }, orderBy: { userId: 'asc' } });
        for (const snapshot of snapshots) {
            const employee = employees.find(item => item.id === snapshot.employeeId)!;
            if (['CONTRACTOR', 'INTERN'].includes(employee.employmentType)) await addAnomaly(tx, {
                companyId, runId, employeeId: employee.id, userId: employee.userId,
                code: 'NON_STANDARD_EMPLOYMENT_STATUTORY_REVIEW',
                message: `La relación ${employee.employmentType} requiere confirmar que corresponde a rentas del trabajo y seguridad social antes de usar el tratamiento laboral`,
            });
            if (config.statutory.inss.applicability === 'APPLIES' && !employee.socialSecurityNumber?.trim()) await addAnomaly(tx, {
                companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'MISSING_INSS_NUMBER',
                message: 'El colaborador no tiene número INSS para una obligación configurada como aplicable',
            });
            if (effectiveIncomeTaxApplicability(config.statutory) === 'APPLIES' && !employee.taxId?.trim() && !employee.documentNumber?.trim()) await addAnomaly(tx, {
                companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'MISSING_TAX_IDENTIFICATION',
                message: 'El colaborador no tiene RUC ni identificación para la planilla de rentas del trabajo',
            });
            await applyStatutoryForUser(tx, {
                companyId, runId, userId: snapshot.userId, employeeId: snapshot.employeeId,
                calculationRevision, employerHeadcount, configurationRevisionId: configurationRevision.id,
                config, period: run.period!, snapshot,
            });
        }
        const employerAggregate = await tx.payrollEmployerContribution.aggregate({
            where: { companyId, runId, calculationRevision }, _sum: { amount: true },
        });
        employerContributions = money(employerAggregate._sum.amount ?? 0);
    }
    if (attendancePeriod) {
        const summaryFingerprint = hashPayload(dependencyRevisions.sort((a, b) => a.id - b.id));
        await tx.payrollAttendanceDependency.upsert({ where: { runId_attendancePeriodId: { runId, attendancePeriodId: attendancePeriod.id } }, create: { companyId, runId, attendancePeriodId: attendancePeriod.id, capturedPeriodRevision: attendancePeriod.revision, capturedPeriodStatus: attendancePeriod.status, capturedPayrollEligible: attendancePeriod.payrollEligible, summaryFingerprint }, update: { capturedPeriodRevision: attendancePeriod.revision, capturedPeriodStatus: attendancePeriod.status, capturedPayrollEligible: attendancePeriod.payrollEligible, summaryFingerprint, capturedAt: new Date() } });
    }
    const snapshotUsers = new Set((await tx.payrollSnapshotLine.findMany({ where: { companyId, runId }, select: { userId: true } })).map(item => item.userId));
    const invalidManuals = await tx.payrollComponent.findMany({ where: { companyId, runId, source: 'MANUAL', userId: { notIn: [...snapshotUsers] } }, select: { id: true, userId: true } });
    for (const component of invalidManuals) await addAnomaly(tx, { companyId, runId, userId: component.userId, code: 'MANUAL_COMPONENT_OUTSIDE_SNAPSHOT', message: `El componente manual ${component.id} pertenece a un sujeto fuera del snapshot` });
    const aggregate = await tx.payrollComponent.groupBy({ by: ['type'], where: { companyId, runId }, _sum: { amount: true } }); const gross = money(aggregate.find(item => item.type === 'INCOME')?._sum.amount ?? 0); const deductions = money(aggregate.find(item => item.type === 'DEDUCTION')?._sum.amount ?? 0); const net = money(gross.minus(deductions));
    if (net.isNegative()) await addAnomaly(tx, { companyId, runId, code: 'NEGATIVE_NET_PAY', message: 'El neto no puede ser negativo' });
    const revision = calculationRevision;
    await tx.payrollRun.update({ where: { id: runId }, data: { status: 'CALCULATED', revision, calculationRevision: revision, configurationRevisionId: configurationRevision.id, currency: config.currency, grossIncome: gross, totalDeductions: deductions, employerContributions, netPay: net, employeeCount: snapshotUsers.size, calculatedById: actorId, calculatedAt: new Date(), lastReason: reason } });
    await trace(tx, { companyId, runId, event: run.status === 'DRAFT' ? 'CALCULATE' : 'RECALCULATE', actorId, reason, fromStatus: run.status, toStatus: 'CALCULATED', revision, metadata: { configurationRevisionId: configurationRevision.id, configurationHash: configurationRevision.configurationHash } });
}

async function revalidateFrozenSources(tx: Prisma.TransactionClient, companyId: number, runId: number) {
    const run = await tx.payrollRun.findFirst({ where: { id: runId, companyId }, include: { configurationRevision: { include: { review: true } }, period: true, attendanceDependencies: true, snapshots: true, statutoryCalculations: true } });
    if (!run?.configurationRevision || run.configurationRevision.review?.decision !== 'VALIDATED') throw new HrPayrollError('La configuración congelada dejó de estar VALIDATED', 409, 'HR_PAYROLL_SOURCE_STALE');
    const frozenConfig = validateLegalConfiguration(run.configurationRevision.configuration);
    for (const dependency of run.attendanceDependencies) {
        const period = await tx.attendancePeriod.findFirst({ where: { id: dependency.attendancePeriodId, companyId } });
        if (!period || period.revision !== dependency.capturedPeriodRevision || period.status !== 'CLOSED' || !period.payrollEligible) throw new HrPayrollError('El período de asistencia cambió o fue reabierto; recalcule', 409, 'HR_PAYROLL_SOURCE_STALE');
        const revisions = run.snapshots.flatMap(snapshot => Array.isArray(snapshot.summaryRevisions) ? snapshot.summaryRevisions as Array<{ id: number; revision: number }> : []).sort((a, b) => a.id - b.id);
        const ids = revisions.map(item => item.id); const current = ids.length ? await tx.attendanceDailySummary.findMany({ where: { companyId, id: { in: ids }, periodId: period.id }, select: { id: true, sourceRevision: true }, orderBy: { id: 'asc' } }) : [];
        const fingerprint = hashPayload(current.map(item => ({ id: item.id, revision: item.sourceRevision })));
        if (current.length !== ids.length || fingerprint !== dependency.summaryFingerprint) throw new HrPayrollError('Una revisión diaria cambió después del snapshot; recalcule', 409, 'HR_PAYROLL_SOURCE_STALE');
    }
    if (run.kind === 'AGUINALDO') {
        if (!run.calculationRevision) throw new HrPayrollError('La corrida no tiene una revisión de cálculo histórica congelada', 409, 'HR_PAYROLL_AGUINALDO_SOURCE_STALE');
        const expectedSources = run.snapshots.flatMap(snapshot => Array.isArray(snapshot.aguinaldoIncomeSegments)
            ? (snapshot.aguinaldoIncomeSegments as Array<{ componentId?: number; runId?: number; receiptId?: number; dependencyRevision?: number }>).map(item => ({ ...item, userId: snapshot.userId }))
            : []);
        if (expectedSources.some(item => !item.componentId || !item.runId || !item.receiptId || item.dependencyRevision !== run.calculationRevision)) {
            throw new HrPayrollError('El snapshot de aguinaldo no contiene referencias históricas normalizadas completas', 409, 'HR_PAYROLL_AGUINALDO_SOURCE_STALE');
        }
        const dependencies = await tx.payrollAguinaldoSourceDependency.findMany({ where: { companyId, targetRunId: runId, calculationRevision: run.calculationRevision }, include: {
            sourceRun: { include: { reversals: { select: { id: true } } } },
            sourceComponent: { include: { reversal: { select: { id: true } } } }, sourceReceipt: true,
        } });
        const expectedIds = new Set(expectedSources.map(item => item.componentId));
        if (dependencies.length !== expectedSources.length || dependencies.some(item => !expectedIds.has(item.sourceComponentId))) {
            throw new HrPayrollError('Las dependencias históricas no coinciden con el snapshot de aguinaldo', 409, 'HR_PAYROLL_AGUINALDO_SOURCE_STALE');
        }
        for (const dependency of dependencies) {
            const expected = expectedSources.find(item => item.componentId === dependency.sourceComponentId && item.runId === dependency.sourceRunId && item.receiptId === dependency.sourceReceiptId);
            assertAguinaldoDependencyFresh({
                componentId: dependency.sourceComponentId,
                linksValid: Boolean(expected) && dependency.sourceComponent.runId === dependency.sourceRunId && dependency.sourceComponent.receiptId === dependency.sourceReceiptId &&
                    dependency.sourceComponent.userId === expected?.userId && dependency.sourceReceipt.runId === dependency.sourceRunId && dependency.sourceReceipt.userId === expected?.userId,
                captured: { runRevision: dependency.capturedRunRevision, runStatus: dependency.capturedRunStatus, runCurrency: dependency.capturedRunCurrency, componentAmount: dependency.capturedComponentAmount, receiptStatus: dependency.capturedReceiptStatus, componentReversed: dependency.capturedComponentReversed, runReversed: dependency.capturedRunReversed },
                current: { runRevision: dependency.sourceRun.revision, runStatus: dependency.sourceRun.status, runCurrency: dependency.sourceRun.currency, componentAmount: dependency.sourceComponent.amount, receiptStatus: dependency.sourceReceipt.status, componentReversed: Boolean(dependency.sourceComponent.reversal), runReversed: dependency.sourceRun.reversals.length > 0 },
            });
        }
    }
    if (run.kind === 'REGULAR') {
        if (!run.period || !run.calculationRevision) throw new HrPayrollError('La corrida regular no conserva período o revisión de cálculo', 409, 'HR_PAYROLL_SOURCE_STALE');
        assertRegularFiscalPeriod(run.period);
        for (const snapshot of run.snapshots) {
            const sourceTrace = snapshot.sourceTrace && typeof snapshot.sourceTrace === 'object' && !Array.isArray(snapshot.sourceTrace)
                ? snapshot.sourceTrace as Record<string, unknown> : {};
            const frozenEvidence = Array.isArray(sourceTrace.publishedShiftEvidence)
                ? sourceTrace.publishedShiftEvidence as unknown as EffectivePublishedShiftEvidence[] : null;
            const frozenFingerprint = typeof sourceTrace.publishedShiftFingerprint === 'string'
                ? sourceTrace.publishedShiftFingerprint : null;
            const serviceFrom = typeof sourceTrace.serviceFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sourceTrace.serviceFrom)
                ? new Date(`${sourceTrace.serviceFrom}T00:00:00.000Z`) : null;
            const serviceTo = typeof sourceTrace.serviceTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sourceTrace.serviceTo)
                ? new Date(`${sourceTrace.serviceTo}T00:00:00.000Z`) : null;
            if (!frozenEvidence || !frozenFingerprint || !serviceFrom || !serviceTo ||
                publishedShiftFingerprint(frozenEvidence) !== frozenFingerprint) {
                throw new HrPayrollError('El snapshot no conserva una huella íntegra de turnos publicados efectivos', 409, 'HR_PAYROLL_SCHEDULE_SOURCE_STALE');
            }
            const currentEvidence = await effectivePublishedShiftEvidence(tx, {
                companyId, userId: snapshot.userId, from: serviceFrom, to: serviceTo,
            });
            if (publishedShiftFingerprint(currentEvidence) !== frozenFingerprint) {
                throw new HrPayrollError('Los turnos publicados, su horario o su asignación efectiva cambiaron después del cálculo; recalcule', 409, 'HR_PAYROLL_SCHEDULE_SOURCE_STALE');
            }
        }
        const currentStatutory = run.statutoryCalculations.filter(item => item.calculationRevision === run.calculationRevision);
        if (currentStatutory.length !== run.snapshots.length) throw new HrPayrollError('La traza estatutaria no coincide con el snapshot de colaboradores', 409, 'HR_PAYROLL_STATUTORY_SOURCE_STALE');
        const currentHeadcount = await employerHeadcountAt(tx, companyId, run.period.dateFrom, run.period.dateTo);
        for (const calculation of currentStatutory) {
            if (calculation.configurationRevisionId !== run.configurationRevisionId || calculation.companyTaxRegime !== frozenConfig.statutory.companyTaxRegime.code || calculation.employerHeadcount !== currentHeadcount) {
                throw new HrPayrollError('La configuración o el universo patronal cambió después del cálculo', 409, 'HR_PAYROLL_STATUTORY_SOURCE_STALE');
            }
            const prior = await priorStatutoryContext(tx, { companyId, runId, userId: calculation.userId, periodFrom: run.period.dateFrom });
            if (!prior.historyComplete) {
                throw new HrPayrollError(`El histórico ${prior.incompleteRunCodes.join(', ')} no tiene trazabilidad estatutaria completa; ejecute backfill y recalcule`, 409, 'HR_PAYROLL_STATUTORY_HISTORY_INCOMPLETE');
            }
            if (
                prior.historyFingerprint !== calculation.historyFingerprint ||
                !prior.priorRegularIncomeTaxNet.equals(calculation.priorIncomeTaxNet) ||
                !prior.priorRegularIncomeTaxWithheld.equals(calculation.priorRegularIncomeTaxWithheld) ||
                !prior.priorOccasionalIncomeTaxWithheld.equals(calculation.priorOccasionalIncomeTaxWithheld) ||
                !prior.priorOccasionalIncomeTaxNet.equals(calculation.priorOccasionalIncomeTaxNet) ||
                prior.priorHadVariableIncome !== calculation.priorHadVariableIncome
            ) {
                throw new HrPayrollError('El histórico acumulado de IR cambió después del cálculo; recalcule', 409, 'HR_PAYROLL_STATUTORY_SOURCE_STALE');
            }
            const snapshot = run.snapshots.find(item => item.userId === calculation.userId);
            if (!snapshot || !['WEEKLY', 'BIWEEKLY', 'FORTNIGHTLY', 'MONTHLY'].includes(String(snapshot.payFrequency))) throw new HrPayrollError('La frecuencia congelada del cálculo estatutario no está disponible', 409, 'HR_PAYROLL_STATUTORY_SOURCE_STALE');
            if (prior.priorCompanyTaxRegimes.some(regime => regime !== frozenConfig.statutory.companyTaxRegime.code)) {
                throw new HrPayrollError('El régimen tributario empresarial cambió dentro del año fiscal', 409, 'HR_PAYROLL_COMPANY_TAX_REGIME_CHANGED');
            }
            const annualPeriods = frozenConfig.statutory.incomeTax.annualPeriods[snapshot.payFrequency as StatutoryPayFrequency];
            if (prior.priorPayFrequencies.some(value => value !== snapshot.payFrequency) || prior.priorAnnualPeriods.some(value => value !== annualPeriods)) {
                throw new HrPayrollError('La frecuencia fiscal cambió dentro del año; la corrida no es reproducible', 409, 'HR_PAYROLL_FISCAL_FREQUENCY_CHANGED');
            }
            const currentIncome = await tx.payrollComponent.findMany({ where: { companyId, runId, userId: calculation.userId, type: 'INCOME', source: { not: 'STATUTORY' }, reversal: null } });
            const currentTaxDeductions = await tx.payrollComponent.findMany({ where: { companyId, runId, userId: calculation.userId, type: 'DEDUCTION', source: { not: 'STATUTORY' }, incomeTaxDeductible: true, reversal: null } });
            if (currentIncome.some(component => {
                const concept = paymentConceptDefinition(frozenConfig.statutory, component.code);
                const flags = statutoryFlags(component.code, frozenConfig);
                return !concept || concept.type !== 'INCOME' || component.taxable !== flags.taxable ||
                    component.incomeTaxTreatment !== flags.incomeTaxTreatment ||
                    component.socialSecurityApplicable !== flags.socialSecurityApplicable ||
                    component.trainingContributionApplicable !== flags.trainingContributionApplicable;
            })) {
                throw new HrPayrollError('La clasificación de un ingreso no coincide con los catálogos legales congelados', 409, 'HR_PAYROLL_STATUTORY_SOURCE_STALE');
            }
            if (currentTaxDeductions.some(component => {
                const concept = paymentConceptDefinition(frozenConfig.statutory, component.code);
                return !concept || concept.type !== 'DEDUCTION' || !concept.incomeTaxDeductible;
            })) {
                throw new HrPayrollError('Una deducción de IR ya no pertenece al catálogo legal congelado', 409, 'HR_PAYROLL_STATUTORY_SOURCE_STALE');
            }
            const sumIncome = (predicate: (component: typeof currentIncome[number]) => boolean) => money(currentIncome.filter(predicate).reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0)));
            const inssContributionBase = sumIncome(component => component.socialSecurityApplicable === true);
            const occasionalInssContributionBase = sumIncome(component => component.socialSecurityApplicable === true && component.taxable === true && component.incomeTaxTreatment === 'OCCASIONAL');
            const regularInssContributionBase = money(inssContributionBase.minus(occasionalInssContributionBase));
            const recomputed = calculateStatutoryPayroll(frozenConfig.statutory, {
                inssContributionBase,
                regularInssContributionBase,
                occasionalInssContributionBase,
                inatecContributionBase: sumIncome(component => component.trainingContributionApplicable === true),
                fixedIncomeTaxGross: sumIncome(component => component.taxable === true && component.incomeTaxTreatment === 'REGULAR_FIXED'),
                variableIncomeTaxGross: sumIncome(component => component.taxable === true && component.incomeTaxTreatment === 'REGULAR_VARIABLE'),
                occasionalIncomeTaxGross: sumIncome(component => component.taxable === true && component.incomeTaxTreatment === 'OCCASIONAL'),
                otherIncomeTaxDeductions: money(currentTaxDeductions.reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0))),
                priorRegularIncomeTaxNet: prior.priorRegularIncomeTaxNet,
                priorOccasionalIncomeTaxNet: prior.priorOccasionalIncomeTaxNet,
                priorRegularIncomeTaxWithheld: prior.priorRegularIncomeTaxWithheld,
                priorOccasionalIncomeTaxWithheld: prior.priorOccasionalIncomeTaxWithheld,
                currentFixedCompensationAmount: snapshot.compensationType === 'SALARY' ? snapshot.compensationAmount ?? 0 : 0,
                latestFixedCompensationAmount: prior.latestFixedCompensationAmount,
                latestRegularIncomeTaxNet: prior.latestRegularIncomeTaxNet,
                priorFixedSalaryChangeActive: prior.priorFixedSalaryChangeActive,
                priorFixedSalaryChangeAnnualProjection: prior.priorFixedSalaryChangeAnnualProjection,
                priorHadVariableIncome: prior.priorHadVariableIncome,
                employerRefundAllowed: employerIncomeTaxRefundAllowed({
                    snapshot, period: run.period, priorPeriods: prior.priorPeriods,
                    annualPeriods, priorCoverageIntervals: prior.priorCoverageIntervals,
                }),
                priorPeriods: prior.priorPeriods,
                elapsedFiscalMonths: elapsedFiscalMonths(prior.firstFiscalMonth, run.period.payDate),
                payFrequency: snapshot.payFrequency as StatutoryPayFrequency,
                employerHeadcount: currentHeadcount, serviceRatio: snapshotServiceRatio(snapshot, run.period),
            });
            const traceMatches = calculation.methodVersion === 'ART19_V3' && calculation.incomeTaxMethod === recomputed.incomeTaxMethod &&
                calculation.inssBase.equals(recomputed.inssBase) && calculation.employeeInss.equals(recomputed.employeeInss) &&
                calculation.regularEmployeeInss.equals(recomputed.regularEmployeeInss) && calculation.occasionalEmployeeInss.equals(recomputed.occasionalEmployeeInss) &&
                calculation.employerInssRate.equals(recomputed.employerInssRate) && calculation.employerInss.equals(recomputed.employerInss) &&
                calculation.inatecBase.equals(recomputed.inatecBase) && calculation.employerInatec.equals(recomputed.employerInatec) &&
                calculation.fixedIncomeTaxGross.equals(recomputed.fixedIncomeTaxGross) && calculation.variableIncomeTaxGross.equals(recomputed.variableIncomeTaxGross) &&
                calculation.occasionalIncomeTaxGross.equals(recomputed.occasionalIncomeTaxGross) && calculation.currentRegularIncomeTaxNet.equals(recomputed.currentRegularIncomeTaxNet) &&
                calculation.currentOccasionalIncomeTaxNet.equals(recomputed.currentOccasionalIncomeTaxNet) && calculation.currentIncomeTaxNet.equals(recomputed.currentIncomeTaxNet) &&
                calculation.otherIncomeTaxDeductions.equals(recomputed.otherIncomeTaxDeductions) && calculation.accumulatedIncomeTaxNet.equals(recomputed.accumulatedIncomeTaxNet) &&
                calculation.annualProjection.equals(recomputed.annualProjection) && calculation.regularAnnualIncomeTax.equals(recomputed.regularAnnualIncomeTax) &&
                calculation.annualIncomeTaxWithOccasional.equals(recomputed.annualIncomeTaxWithOccasional) && calculation.annualIncomeTax.equals(recomputed.annualIncomeTax) &&
                calculation.regularIncomeTaxWithheld.equals(recomputed.regularIncomeTaxWithholding) && calculation.occasionalIncomeTaxWithheld.equals(recomputed.occasionalIncomeTaxWithholding) &&
                calculation.currentIncomeTaxWithheld.equals(recomputed.currentIncomeTaxWithholding) && calculation.incomeTaxRefund.equals(recomputed.incomeTaxRefund) &&
                calculation.incomeTaxCreditBalance.equals(recomputed.incomeTaxCreditBalance) &&
                calculation.elapsedPeriods === recomputed.elapsedPeriods && calculation.elapsedFiscalMonths === recomputed.elapsedFiscalMonths &&
                calculation.annualPeriods === recomputed.annualPeriods;
            if (!traceMatches) throw new HrPayrollError('La traza estatutaria ya no reproduce sus bases y parámetros congelados', 409, 'HR_PAYROLL_STATUTORY_SOURCE_STALE');
            const statutoryComponents = await tx.payrollComponent.findMany({ where: { companyId, runId, userId: calculation.userId, source: 'STATUTORY', reversal: null } });
            const componentAmount = (code: string, type: 'INCOME' | 'DEDUCTION') => money(statutoryComponents.filter(component => component.code === code && component.type === type).reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0)));
            if (!componentAmount('INSS_LABORAL', 'DEDUCTION').equals(recomputed.employeeInss) || !componentAmount('IR_LABORAL', 'DEDUCTION').equals(recomputed.currentIncomeTaxWithholding) || !componentAmount('IR_LABORAL_DEVOLUCION', 'INCOME').equals(recomputed.incomeTaxRefund)) {
                throw new HrPayrollError('Las deducciones estatutarias no coinciden con su traza reproducible', 409, 'HR_PAYROLL_STATUTORY_SOURCE_STALE');
            }
        }
        const contributions = await tx.payrollEmployerContribution.aggregate({ where: { companyId, runId, calculationRevision: run.calculationRevision }, _sum: { amount: true } });
        if (!money(contributions._sum.amount ?? 0).equals(run.employerContributions)) throw new HrPayrollError('Los aportes patronales no reconcilian con la corrida', 409, 'HR_PAYROLL_STATUTORY_SOURCE_STALE');
    }
    const activeClaims = await tx.payrollCoverageClaim.count({ where: { companyId, runId, release: null } });
    if (activeClaims !== run.snapshots.length) throw new HrPayrollError('Las exclusiones de cobertura no coinciden con el snapshot', 409, 'HR_PAYROLL_COVERAGE_STALE');
    const snapshotUsers = new Set(run.snapshots.map(item => item.userId));
    const invalidManual = await tx.payrollComponent.findFirst({ where: { companyId, runId, source: 'MANUAL', userId: { notIn: [...snapshotUsers] } } });
    if (invalidManual) throw new HrPayrollError('Existe un componente manual para un sujeto fuera del snapshot', 409, 'HR_PAYROLL_COMPONENT_SUBJECT_INVALID');
    if (run.netPay.isNegative()) throw new HrPayrollError('El neto de la corrida es negativo', 409, 'HR_PAYROLL_NEGATIVE_NET');
}

async function assertNotLiveAguinaldoSource(tx: Prisma.TransactionClient, companyId: number, sourceRunId: number) {
    const dependencies = await tx.payrollAguinaldoSourceDependency.findMany({ where: { companyId, sourceRunId, targetRun: { status: { not: 'VOID' } } }, include: { targetRun: { select: { id: true, code: true, status: true, calculationRevision: true } } } });
    const active = dependencies.find(item => item.calculationRevision === item.targetRun.calculationRevision);
    if (active) throw new HrPayrollError(`La corrida es fuente histórica de ${active.targetRun.code}; anule primero la corrida de aguinaldo dependiente`, 409, 'HR_PAYROLL_AGUINALDO_SOURCE_IN_USE');
}

async function assertNotLiveStatutorySource(tx: Prisma.TransactionClient, companyId: number, sourceRunId: number) {
    const source = await tx.payrollRun.findFirst({
        where: { id: sourceRunId, companyId },
        include: { period: true, snapshots: { select: { userId: true } } },
    });
    if (!source?.period || source.kind !== 'REGULAR' || source.status !== 'PAID' || source.snapshots.length === 0) return;
    const yearEnd = new Date(Date.UTC(source.period.dateTo.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
    const dependent = await tx.payrollRun.findFirst({
        where: {
            companyId, id: { not: sourceRunId }, kind: 'REGULAR', status: { in: ['CALCULATED', 'REVIEW', 'APPROVED', 'PAID'] },
            period: { dateFrom: { gt: source.period.dateTo, lte: yearEnd } },
            snapshots: { some: { userId: { in: source.snapshots.map(item => item.userId) } } },
            statutoryCalculations: { some: { calculationRevision: { not: 0 }, methodVersion: 'ART19_V3' } },
        },
        select: { id: true, code: true, status: true },
        orderBy: { period: { dateFrom: 'asc' } },
    });
    if (dependent) {
        throw new HrPayrollError(
            `La corrida es fuente del acumulado de IR de ${dependent.code}; anule o recalcule primero la corrida posterior`,
            409,
            'HR_PAYROLL_STATUTORY_SOURCE_IN_USE',
        );
    }
}

async function assertRegularPaymentOrder(tx: Prisma.TransactionClient, input: {
    companyId: number;
    runId: number;
    period: { dateFrom: Date; dateTo: Date };
    userIds: number[];
}) {
    if (input.userIds.length === 0) return;
    const earlierOpen = await tx.payrollRun.findFirst({
        where: {
            companyId: input.companyId, id: { not: input.runId }, kind: 'REGULAR',
            period: { dateTo: { lt: input.period.dateFrom } },
            OR: [
                { status: 'DRAFT' },
                {
                    status: { in: ['CALCULATED', 'REVIEW', 'APPROVED'] },
                    snapshots: { some: { userId: { in: input.userIds } } },
                },
            ],
        },
        select: { code: true }, orderBy: { period: { dateTo: 'asc' } },
    });
    const laterPaid = await tx.payrollRun.findFirst({
        where: {
            companyId: input.companyId, id: { not: input.runId }, kind: 'REGULAR', status: 'PAID',
            period: { dateFrom: { gt: input.period.dateTo } },
            snapshots: { some: { userId: { in: input.userIds } } },
        },
        select: { code: true }, orderBy: { period: { dateFrom: 'asc' } },
    });
    if (earlierOpen || laterPaid) {
        const conflict = earlierOpen?.code ?? laterPaid!.code;
        throw new HrPayrollError(
            `La secuencia fiscal está fuera de orden respecto de ${conflict}; cierre, anule o recalcule en orden cronológico`,
            409,
            'HR_PAYROLL_PAYMENT_ORDER_INVALID',
        );
    }
}

export class PayrollRunService {
    static async list(companyId: number, kind: PayrollRunKind, filters: InputMap) {
        const p = paging(filters);
        const where: Prisma.PayrollRunWhereInput = { companyId, kind, status: filters.status || undefined, periodId: filters.periodId ? Number(filters.periodId) : undefined, year: filters.year ? Number(filters.year) : undefined };
        const [items, total] = await Promise.all([prisma.payrollRun.findMany({ where, include: runInclude, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.pageSize }), prisma.payrollRun.count({ where })]);
        const ids = items.map(item => item.id);
        const blocking = ids.length ? await prisma.payrollAnomaly.groupBy({ by: ['runId'], where: { companyId, runId: { in: ids }, blocking: true, resolvedAt: null }, _count: { _all: true } }) : [];
        return { items: items.map(item => presentRun({ ...item, blockingAnomalyCount: blocking.find(value => value.runId === item.id)?._count._all ?? 0 })), pagination: { page: p.page, pageSize: p.pageSize, total, totalPages: Math.ceil(total / p.pageSize) } };
    }

    static get(companyId: number, id: number, kind: PayrollRunKind) { return loadRun(companyId, id, kind); }

    static async reconcileParallelControl(
        companyId: number,
        actorId: number,
        id: number,
        kind: PayrollRunKind,
        payload: InputMap,
    ) {
        const expectedGrossIncome = nonNegativeMoney(payload.expectedGrossIncome, 'expectedGrossIncome');
        const expectedTotalDeductions = nonNegativeMoney(payload.expectedTotalDeductions, 'expectedTotalDeductions');
        const expectedEmployerContributions = nonNegativeMoney(payload.expectedEmployerContributions, 'expectedEmployerContributions');
        const expectedNetPay = nonNegativeMoney(payload.expectedNetPay, 'expectedNetPay');
        const expectedEmployeeCount = Number(payload.expectedEmployeeCount);
        if (!Number.isInteger(expectedEmployeeCount) || expectedEmployeeCount < 0) {
            throw new HrPayrollError('expectedEmployeeCount debe ser un entero no negativo');
        }
        const controlSource = requiredText(payload.controlSource, 'controlSource', 160);
        const evidenceReference = requiredText(payload.evidenceReference, 'evidenceReference', 500);
        const run = await prisma.payrollRun.findFirst({
            where: { id, companyId, kind },
            include: {
                configurationRevision: { include: { review: true } },
                snapshots: { select: { userId: true } },
                components: { include: { reversal: { select: { id: true } } } },
                employerContributionLines: true,
                anomalies: { where: { blocking: true, resolvedAt: null }, select: { id: true, code: true } },
                coverageClaims: { include: { release: { select: { id: true } } } },
                receipts: { select: { userId: true, status: true, grossIncome: true, totalDeductions: true, netPay: true } },
            },
        });
        if (!run) throw new HrPayrollError('Corrida no encontrada', 404);
        if (run.status === 'DRAFT' || run.status === 'VOID') {
            throw new HrPayrollError('La conciliación requiere una corrida calculada y vigente', 409, 'HR_PAYROLL_RECONCILIATION_NOT_READY');
        }

        const activeComponents = run.components.filter(component => !component.reversal);
        const calculatedGross = money(activeComponents.filter(component => component.type === 'INCOME').reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0)));
        const calculatedDeductions = money(activeComponents.filter(component => component.type === 'DEDUCTION').reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0)));
        const calculatedEmployerContributions = money(run.employerContributionLines.filter(item => item.calculationRevision === run.calculationRevision).reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0)));
        const calculatedNet = money(calculatedGross.minus(calculatedDeductions));
        const snapshotUsers = new Set(run.snapshots.map(snapshot => snapshot.userId));
        const activeClaims = run.coverageClaims.filter(claim => !claim.release);
        const componentUsersValid = activeComponents.every(component => snapshotUsers.has(component.userId));
        const claimUsers = new Set(activeClaims.map(claim => claim.userId));
        const coverageValid = activeClaims.length === run.snapshots.length && snapshotUsers.size === claimUsers.size && [...snapshotUsers].every(userId => claimUsers.has(userId));
        const perEmployee = [...snapshotUsers].map(userId => {
            const components = activeComponents.filter(component => component.userId === userId);
            const employerLines = run.employerContributionLines.filter(line => line.calculationRevision === run.calculationRevision && line.userId === userId);
            const gross = money(components.filter(component => component.type === 'INCOME').reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0)));
            const deductions = money(components.filter(component => component.type === 'DEDUCTION').reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0)));
            const employerContributions = money(employerLines.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0)));
            return { userId, grossIncome: gross.toFixed(2), totalDeductions: deductions.toFixed(2), employerContributions: employerContributions.toFixed(2), netPay: money(gross.minus(deductions)).toFixed(2) };
        });
        let frozenSourcesFresh = true;
        let frozenSourceDetail = 'Fuentes congeladas vigentes';
        try {
            await prisma.$transaction(async tx => revalidateFrozenSources(tx, companyId, id));
        } catch (error) {
            frozenSourcesFresh = false;
            frozenSourceDetail = error instanceof Error ? error.message : 'No fue posible revalidar las fuentes';
        }

        const receiptGross = money(run.receipts.reduce((sum, receipt) => sum.plus(receipt.grossIncome), new Prisma.Decimal(0)));
        const receiptDeductions = money(run.receipts.reduce((sum, receipt) => sum.plus(receipt.totalDeductions), new Prisma.Decimal(0)));
        const receiptNet = money(run.receipts.reduce((sum, receipt) => sum.plus(receipt.netPay), new Prisma.Decimal(0)));
        const receiptsRequired = run.status === 'PAID';
        const receiptsValid = !receiptsRequired || (
            run.receipts.length === run.snapshots.length &&
            run.receipts.every(receipt => receipt.status === 'PUBLISHED') &&
            receiptGross.equals(calculatedGross) && receiptDeductions.equals(calculatedDeductions) && receiptNet.equals(calculatedNet)
        );

        const check = (code: string, label: string, passed: boolean, expected: string | number, actual: string | number, detail?: string) => ({ code, label, passed, expected, actual, detail: detail ?? null });
        const checks = [
            check('RUN_GROSS_MATCHES_COMPONENTS', 'Bruto de corrida contra componentes', run.grossIncome.equals(calculatedGross), run.grossIncome.toFixed(2), calculatedGross.toFixed(2)),
            check('RUN_DEDUCTIONS_MATCH_COMPONENTS', 'Deducciones de corrida contra componentes', run.totalDeductions.equals(calculatedDeductions), run.totalDeductions.toFixed(2), calculatedDeductions.toFixed(2)),
            check('RUN_EMPLOYER_CONTRIBUTIONS_MATCH', 'Aportes patronales contra detalle estatutario', run.employerContributions.equals(calculatedEmployerContributions), run.employerContributions.toFixed(2), calculatedEmployerContributions.toFixed(2)),
            check('RUN_NET_MATCHES_COMPONENTS', 'Neto de corrida contra componentes', run.netPay.equals(calculatedNet), run.netPay.toFixed(2), calculatedNet.toFixed(2)),
            check('RUN_EMPLOYEE_COUNT_MATCHES_SNAPSHOT', 'Cantidad de personas contra snapshot', run.employeeCount === run.snapshots.length && snapshotUsers.size === run.snapshots.length, run.employeeCount, run.snapshots.length),
            check('COMPONENT_SUBJECTS_IN_SNAPSHOT', 'Sujetos de componentes dentro del snapshot', componentUsersValid, 'todos incluidos', componentUsersValid ? 'todos incluidos' : 'existen sujetos ajenos'),
            check('COVERAGE_CLAIMS_MATCH_SNAPSHOT', 'Cobertura exclusiva contra snapshot', coverageValid, run.snapshots.length, activeClaims.length),
            check('NO_NEGATIVE_EMPLOYEE_NET', 'Neto individual no negativo', perEmployee.every(item => !new Prisma.Decimal(item.netPay).isNegative()), 'ningún neto negativo', perEmployee.filter(item => new Prisma.Decimal(item.netPay).isNegative()).length),
            check('NO_BLOCKING_ANOMALIES', 'Anomalías bloqueantes resueltas', run.anomalies.length === 0, 0, run.anomalies.length),
            check('VALIDATED_FROZEN_CONFIGURATION', 'Configuración congelada con revisión independiente', run.configurationRevision?.review?.decision === 'VALIDATED', 'VALIDATED', run.configurationRevision?.review?.decision ?? 'MISSING'),
            check('FROZEN_SOURCES_FRESH', 'Fuentes congeladas aún vigentes', frozenSourcesFresh, 'vigentes', frozenSourcesFresh ? 'vigentes' : 'obsoletas', frozenSourceDetail),
            check('PUBLISHED_RECEIPTS_RECONCILE', 'Recibos publicados contra corrida pagada', receiptsValid, receiptsRequired ? run.snapshots.length : 'no requerido antes de pago', run.receipts.length),
            check('EXTERNAL_GROSS_MATCH', 'Bruto contra control paralelo externo', calculatedGross.equals(expectedGrossIncome), expectedGrossIncome.toFixed(2), calculatedGross.toFixed(2)),
            check('EXTERNAL_DEDUCTIONS_MATCH', 'Deducciones contra control paralelo externo', calculatedDeductions.equals(expectedTotalDeductions), expectedTotalDeductions.toFixed(2), calculatedDeductions.toFixed(2)),
            check('EXTERNAL_EMPLOYER_CONTRIBUTIONS_MATCH', 'Aportes patronales contra control paralelo externo', calculatedEmployerContributions.equals(expectedEmployerContributions), expectedEmployerContributions.toFixed(2), calculatedEmployerContributions.toFixed(2)),
            check('EXTERNAL_NET_MATCH', 'Neto contra control paralelo externo', calculatedNet.equals(expectedNetPay), expectedNetPay.toFixed(2), calculatedNet.toFixed(2)),
            check('EXTERNAL_EMPLOYEE_COUNT_MATCH', 'Personas contra control paralelo externo', run.snapshots.length === expectedEmployeeCount, expectedEmployeeCount, run.snapshots.length),
        ];
        const reconciliationHash = hashPayload({
            companyId, runId: id, kind, runRevision: run.revision, calculationRevision: run.calculationRevision,
            controlSource, evidenceReference,
            expected: { grossIncome: expectedGrossIncome.toFixed(2), totalDeductions: expectedTotalDeductions.toFixed(2), employerContributions: expectedEmployerContributions.toFixed(2), netPay: expectedNetPay.toFixed(2), employeeCount: expectedEmployeeCount },
            actual: { grossIncome: calculatedGross.toFixed(2), totalDeductions: calculatedDeductions.toFixed(2), employerContributions: calculatedEmployerContributions.toFixed(2), netPay: calculatedNet.toFixed(2), employeeCount: run.snapshots.length },
            checks: checks.map(item => ({ code: item.code, passed: item.passed })),
        });
        const result = {
            run: { id: run.id, code: run.code, kind: run.kind, status: run.status, revision: run.revision, calculationRevision: run.calculationRevision, currency: run.currency },
            control: { source: controlSource, evidenceReference },
            expected: { grossIncome: expectedGrossIncome.toFixed(2), totalDeductions: expectedTotalDeductions.toFixed(2), employerContributions: expectedEmployerContributions.toFixed(2), netPay: expectedNetPay.toFixed(2), employeeCount: expectedEmployeeCount },
            actual: { grossIncome: calculatedGross.toFixed(2), totalDeductions: calculatedDeductions.toFixed(2), employerContributions: calculatedEmployerContributions.toFixed(2), netPay: calculatedNet.toFixed(2), employeeCount: run.snapshots.length },
            checks,
            perEmployee,
            readyForParallelSignoff: checks.every(item => item.passed),
            legalValidationAsserted: false,
            productionCertificationAsserted: false,
            reconciliationHash,
            generatedAt: new Date().toISOString(),
        };
        await AuditLogService.log({
            companyId, userId: actorId, entityType: 'PayrollRun', entityId: id, action: 'UPDATE',
            details: { operation: 'PARALLEL_RECONCILIATION', runRevision: run.revision, reconciliationHash, controlSource, evidenceReference, readyForParallelSignoff: result.readyForParallelSignoff, failedChecks: checks.filter(item => !item.passed).map(item => item.code) },
        });
        return result;
    }

    static async createRegular(companyId: number, actorId: number, payload: InputMap, key: string) {
        return idempotent(companyId, key, 'PAYROLL_RUN_CREATE', { actorId, payload }, async tx => {
            const periodId = positiveId(payload.periodId, 'periodId'); const ruleVersionId = positiveId(payload.ruleVersionId, 'ruleVersionId');
            const period = await tx.payrollPeriod.findFirst({ where: { id: periodId, companyId, status: { in: ['OPEN', 'CLOSED'] } } });
            if (!period) throw new HrPayrollError('Período de nómina no encontrado o no disponible', 409);
            const rule = await tx.payrollRuleVersion.findFirst({ where: { id: ruleVersionId, companyId } });
            if (!rule) throw new HrPayrollError('Regla no encontrada', 404);
            const branchIds = Array.isArray(payload.branchIds) ? payload.branchIds.map((id: unknown) => positiveId(id, 'branchId')) : [];
            if (branchIds.length) {
                const count = await tx.branch.count({ where: { companyId, id: { in: branchIds } } });
                if (count !== new Set(branchIds).size) throw new HrPayrollError('Una sucursal no pertenece a la empresa', 404, 'HR_PAYROLL_BRANCH_NOT_FOUND');
            }
            const sequence = await tx.payrollRun.count({ where: { companyId, kind: 'REGULAR', periodId } });
            const run = await tx.payrollRun.create({ data: {
                companyId, kind: 'REGULAR', code: `${period.code}-R${sequence + 1}`, periodId, ruleVersionId,
                branchIds: branchIds.length ? branchIds : Prisma.JsonNull,
                lastReason: requiredText(payload.reason, 'reason'), createdById: actorId,
            }, include: runInclude });
            await trace(tx, { companyId, runId: run.id, event: 'CREATE', actorId, reason: run.lastReason!, toStatus: 'DRAFT', revision: 0 });
            return presentRun({ ...run, blockingAnomalyCount: 0 });
        });
    }

    static async createAguinaldo(companyId: number, actorId: number, payload: InputMap, key: string) {
        return idempotent(companyId, key, 'AGUINALDO_RUN_CREATE', { actorId, payload }, async tx => {
            const year = Number(payload.year); if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new HrPayrollError('year no es válido');
            const cutoffDate = dateValue(payload.cutoffDate, 'cutoffDate');
            if (cutoffDate.getUTCFullYear() !== year) throw new HrPayrollError('cutoffDate debe pertenecer al año de la corrida');
            const ruleVersionId = positiveId(payload.ruleVersionId, 'ruleVersionId');
            if (!await tx.payrollRuleVersion.findFirst({ where: { id: ruleVersionId, companyId } })) throw new HrPayrollError('Regla no encontrada', 404);
            const employeeIds = Array.isArray(payload.employeeIds) ? payload.employeeIds.map((id: unknown) => positiveId(id, 'employeeId')) : [];
            if (employeeIds.length) {
                const count = await tx.employee.count({ where: { companyId, id: { in: employeeIds }, user: { accountType: 'INTERNAL' } } });
                if (count !== new Set(employeeIds).size) throw new HrPayrollError('Un empleado no pertenece a la empresa o no está ligado a cuenta INTERNAL', 404, 'HR_PAYROLL_EMPLOYEE_NOT_FOUND');
            }
            const sequence = await tx.payrollRun.count({ where: { companyId, kind: 'AGUINALDO', year } });
            const run = await tx.payrollRun.create({ data: {
                companyId, kind: 'AGUINALDO', code: `AGUINALDO-${year}-${sequence + 1}`, ruleVersionId, year, cutoffDate,
                employeeIds: employeeIds.length ? employeeIds : Prisma.JsonNull,
                lastReason: requiredText(payload.reason, 'reason'), createdById: actorId,
            }, include: runInclude });
            await trace(tx, { companyId, runId: run.id, event: 'CREATE', actorId, reason: run.lastReason!, toStatus: 'DRAFT', revision: 0, metadata: { year, cutoffDate: dateKey(cutoffDate) } });
            return presentRun({ ...run, blockingAnomalyCount: 0 });
        });
    }

    static async transition(companyId: number, actorId: number, id: number, kind: PayrollRunKind, action: string, payload: InputMap, key: string) {
        return idempotent(companyId, key, `PAYROLL_RUN_${action.toUpperCase()}:${id}`, { actorId, payload }, async tx => {
            const input = transitionInput(payload); if (!input.confirmed) throw new HrPayrollError('Debe confirmar la transición');
            await lockPayrollCompany(tx, companyId);
            const locked = await lockedRun(tx, companyId, id, kind); await assertRevision(locked, input.expectedRevision);
            const run = await tx.payrollRun.findUniqueOrThrow({ where: { id }, include: { period: true, snapshots: { select: { userId: true } } } });
            if (action === 'calculate' || action === 'recalculate') {
                if (action === 'calculate' && run.status !== 'DRAFT') throw new HrPayrollError('CALCULATE requiere estado DRAFT', 409);
                if (action === 'recalculate' && run.status !== 'CALCULATED') throw new HrPayrollError('RECALCULATE requiere estado CALCULATED', 409);
                await calculate(tx, companyId, id, actorId, kind, input.reason);
            } else {
                if (['submit-review', 'approve', 'pay'].includes(action)) await revalidateFrozenSources(tx, companyId, id);
                const blocking = await tx.payrollAnomaly.count({ where: { companyId, runId: id, blocking: true, resolvedAt: null } });
                assertPayrollTransitionAllowed({
                    status: run.status, action, blockingAnomalies: blocking, actorId,
                    calculatedById: run.calculatedById, reviewSubmittedById: run.reviewSubmittedById, approvedById: run.approvedById, paidById: run.paidById,
                });
                if (action === 'void') {
                    await assertNotLiveAguinaldoSource(tx, companyId, id);
                    await assertNotLiveStatutorySource(tx, companyId, id);
                }
                if (['approve', 'pay'].includes(action)) {
                    const prepared = await tx.payrollComponent.findFirst({ where: { companyId, runId: id, source: 'MANUAL', createdById: actorId }, select: { id: true } });
                    if (prepared) throw new HrPayrollError('Segregación de funciones: quien preparó componentes no puede aprobar ni pagar', 409, 'HR_PAYROLL_DUTY_SEGREGATION');
                }
                const next: PayrollRunStatus = action === 'submit-review' ? 'REVIEW' : action === 'approve' ? 'APPROVED' : action === 'pay' ? 'PAID' : 'VOID';
                const now = new Date(); const revision = run.revision + 1;
                const paidReversal = action === 'void' && run.status === 'PAID' ? paidReversalInput(payload) : null;
                if (action === 'pay') {
                    const paymentReference = requiredText(payload.paymentReference, 'paymentReference', 160);
                    const paymentDate = dateValue(payload.paymentDate, 'paymentDate');
                    const paymentMethod = requiredText(payload.paymentMethod, 'paymentMethod', 80);
                    const evidenceReference = requiredText(payload.evidenceReference, 'evidenceReference', 500);
                    const expectedPaymentDate = run.kind === 'REGULAR' ? run.period?.payDate : run.cutoffDate;
                    assertPayrollPaymentDate(paymentDate, expectedPaymentDate);
                    if (run.kind === 'REGULAR') {
                        if (!run.period) throw new HrPayrollError('La corrida no conserva período fiscal', 409, 'HR_PAYROLL_SOURCE_STALE');
                        assertRegularFiscalPeriod(run.period);
                        await assertRegularPaymentOrder(tx, { companyId, runId: id, period: run.period, userIds: run.snapshots.map(item => item.userId) });
                    }
                    await tx.payrollPaymentRecord.create({ data: { companyId, runId: id, paymentReference, paymentDate, paymentMethod, batchReference: optionalText(payload.batchReference, 160), evidenceReference, actorId } });
                    await commitBenefitDeductions(tx, { companyId, runId: id, actorId, effectiveDate: paymentDate });
                }
                await tx.payrollRun.update({ where: { id }, data: {
                    status: next, revision, lastReason: input.reason,
                    reviewSubmittedById: action === 'submit-review' ? actorId : undefined, reviewSubmittedAt: action === 'submit-review' ? now : undefined,
                    approvedById: action === 'approve' ? actorId : undefined, approvedAt: action === 'approve' ? now : undefined,
                    paidById: action === 'pay' ? actorId : undefined, paidAt: action === 'pay' ? now : undefined,
                    voidedById: action === 'void' ? actorId : undefined, voidedAt: action === 'void' ? now : undefined,
                } });
                if (action === 'pay') await this.publishReceipts(tx, companyId, id, now);
                if (action === 'void') {
                    await tx.payrollRunReversal.create({ data: {
                        companyId, runId: id, actorId, reason: input.reason, originalStatus: run.status,
                        reversedGrossIncome: run.grossIncome.negated(), reversedDeductions: run.totalDeductions.negated(),
                        reversedEmployerContributions: run.employerContributions.negated(), reversedNetPay: run.netPay.negated(),
                        reversalReference: paidReversal?.reversalReference, reversalDate: paidReversal?.reversalDate,
                        reversalMethod: paidReversal?.reversalMethod, evidenceReference: paidReversal?.evidenceReference,
                    } });
                    const components = await tx.payrollComponent.findMany({ where: { companyId, runId: id }, select: { id: true, amount: true } });
                    if (components.length) await tx.payrollComponentReversal.createMany({ data: components.map(component => ({ companyId, componentId: component.id, runId: id, actorId, amount: component.amount.negated(), reason: input.reason })), skipDuplicates: true });
                    const claims = await tx.payrollCoverageClaim.findMany({ where: { companyId, runId: id, release: null }, select: { id: true } });
                    if (claims.length) await tx.payrollCoverageRelease.createMany({ data: claims.map(claim => ({ companyId, claimId: claim.id, runId: id, actorId, reason: input.reason })), skipDuplicates: true });
                    if (run.status === 'PAID') await reverseBenefitDeductions(tx, { companyId, runId: id, actorId, reason: input.reason, effectiveDate: paidReversal!.reversalDate });
                    await tx.payrollReceipt.updateMany({ where: { companyId, runId: id }, data: { status: 'VOID', voidedAt: now } });
                }
                await trace(tx, { companyId, runId: id, event: action === 'pay' ? 'MARK_PAID' : action.toUpperCase().replace('-', '_'), actorId, reason: input.reason, fromStatus: run.status, toStatus: next, revision, metadata: paidReversal ? { reversalReference: paidReversal.reversalReference, reversalDate: dateKey(paidReversal.reversalDate), reversalMethod: paidReversal.reversalMethod, evidenceReference: paidReversal.evidenceReference } : undefined });
            }
            const loaded = await tx.payrollRun.findUniqueOrThrow({ where: { id }, include: runInclude });
            const blockingAnomalyCount = await tx.payrollAnomaly.count({ where: { companyId, runId: id, blocking: true, resolvedAt: null } });
            return presentRun({ ...loaded, blockingAnomalyCount });
        });
    }

    private static async publishReceipts(tx: Prisma.TransactionClient, companyId: number, runId: number, now: Date) {
        const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { period: true, snapshots: true } });
        for (const line of run.snapshots) {
            const components = await tx.payrollComponent.findMany({ where: { companyId, runId, userId: line.userId } });
            const gross = money(components.filter(item => item.type === 'INCOME').reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0)));
            const deductions = money(components.filter(item => item.type === 'DEDUCTION').reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0)));
            const receipt = await tx.payrollReceipt.upsert({ where: { runId_userId: { runId, userId: line.userId } }, create: {
                companyId, runId, userId: line.userId, employeeId: line.employeeId, runKind: run.kind, runCode: run.code,
                periodLabel: run.kind === 'REGULAR' ? `${dateKey(run.period!.dateFrom)} – ${dateKey(run.period!.dateTo)}` : `Aguinaldo ${run.year}`,
                payDate: run.kind === 'REGULAR' ? run.period!.payDate : run.cutoffDate!, currency: run.currency,
                grossIncome: gross, totalDeductions: deductions, netPay: money(gross.minus(deductions)), status: 'PUBLISHED', publishedAt: now,
            }, update: { grossIncome: gross, totalDeductions: deductions, netPay: money(gross.minus(deductions)), status: 'PUBLISHED', publishedAt: now, voidedAt: null } });
            await tx.payrollComponent.updateMany({ where: { companyId, runId, userId: line.userId }, data: { receiptId: receipt.id } });
        }
    }

    static anomalies(companyId: number, runId: number, kind: PayrollRunKind) { return this.scopedList(companyId, runId, kind, 'payrollAnomaly'); }
    static snapshots(companyId: number, runId: number, kind: PayrollRunKind) { return this.scopedList(companyId, runId, kind, 'payrollSnapshotLine'); }
    static components(companyId: number, runId: number, kind: PayrollRunKind) { return this.scopedList(companyId, runId, kind, 'payrollComponent'); }
    static receipts(companyId: number, runId: number, kind: PayrollRunKind) { return this.scopedList(companyId, runId, kind, 'payrollReceipt'); }

    static async employerContributionLines(companyId: number, runId: number, kind: PayrollRunKind) {
        const run = await prisma.payrollRun.findFirst({ where: { id: runId, companyId, kind }, select: { calculationRevision: true } });
        if (!run) throw new HrPayrollError('Corrida no encontrada', 404);
        if (!run.calculationRevision) return [];
        return serialize(await prisma.payrollEmployerContribution.findMany({
            where: { companyId, runId, calculationRevision: run.calculationRevision },
            include: { user: { select: userSelect } }, orderBy: [{ userId: 'asc' }, { code: 'asc' }],
        }));
    }

    static async statutoryCalculations(companyId: number, runId: number, kind: PayrollRunKind) {
        const run = await prisma.payrollRun.findFirst({ where: { id: runId, companyId, kind }, select: { calculationRevision: true } });
        if (!run) throw new HrPayrollError('Corrida no encontrada', 404);
        if (!run.calculationRevision) return [];
        return serialize(await prisma.payrollStatutoryCalculation.findMany({
            where: { companyId, runId, calculationRevision: run.calculationRevision },
            include: { user: { select: userSelect } }, orderBy: { userId: 'asc' },
        }));
    }

    private static async scopedList(companyId: number, runId: number, kind: PayrollRunKind, model: 'payrollAnomaly' | 'payrollSnapshotLine' | 'payrollComponent' | 'payrollReceipt') {
        if (!await prisma.payrollRun.findFirst({ where: { id: runId, companyId, kind }, select: { id: true } })) throw new HrPayrollError('Corrida no encontrada', 404);
        if (model === 'payrollAnomaly') {
            return serialize(await prisma.payrollAnomaly.findMany({ where: { companyId, runId }, orderBy: { id: 'asc' } }));
        }
        if (model === 'payrollSnapshotLine') {
            return serialize(await prisma.payrollSnapshotLine.findMany({
                where: { companyId, runId }, orderBy: { id: 'asc' },
                include: { user: { select: userSelect }, branch: { select: { id: true, name: true } } },
            }));
        }
        if (model === 'payrollComponent') {
            return serialize(await prisma.payrollComponent.findMany({
                where: { companyId, runId }, orderBy: { id: 'asc' }, include: { user: { select: userSelect } },
            }));
        }
        return serialize(await prisma.payrollReceipt.findMany({ where: { companyId, runId }, orderBy: { id: 'asc' } }));
    }

    static async addComponent(companyId: number, actorId: number, runId: number, kind: PayrollRunKind, payload: InputMap, key: string) {
        return idempotent(companyId, key, `PAYROLL_COMPONENT_CREATE:${runId}`, { actorId, payload }, async tx => {
            await lockPayrollCompany(tx, companyId);
            const run = await tx.payrollRun.findFirst({ where: { id: runId, companyId, kind }, include: { period: true, configurationRevision: true } });
            if (!run) throw new HrPayrollError('Corrida no encontrada', 404);
            if (run.status !== 'CALCULATED') throw new HrPayrollError('Los componentes manuales requieren snapshot CALCULATED y sólo se admiten antes de revisión', 409, 'HR_PAYROLL_RUN_IMMUTABLE');
            if (!run.configurationRevision) throw new HrPayrollError('La corrida no conserva configuración estatutaria', 409, 'HR_PAYROLL_SOURCE_STALE');
            const legalConfig = validateLegalConfiguration(run.configurationRevision.configuration);
            const userId = positiveId(payload.userId, 'userId');
            const user = await tx.user.findFirst({ where: { id: userId, companyId, accountType: 'INTERNAL', employee: { isNot: null } }, include: { employee: true } });
            if (!user?.employee) throw new HrPayrollError('El usuario interno no pertenece a la empresa', 404);
            if (!await tx.payrollSnapshotLine.findFirst({ where: { companyId, runId, userId }, select: { id: true } })) throw new HrPayrollError('El sujeto no pertenece al snapshot congelado', 409, 'HR_PAYROLL_COMPONENT_SUBJECT_INVALID');
            const amount = nonNegativeMoney(payload.inputAmount, 'inputAmount');
            const type = payload.type === 'DEDUCTION' ? 'DEDUCTION' : payload.type === 'INCOME' ? 'INCOME' : (() => { throw new HrPayrollError('type no es válido'); })();
            const code = requiredText(payload.code, 'code', 64).toUpperCase();
            if (['INSS_LABORAL', 'IR_LABORAL', 'IR_LABORAL_DEVOLUCION', 'INSS_PATRONAL', 'INATEC_PATRONAL'].includes(code)) {
                throw new HrPayrollError('El código pertenece al motor estatutario y no admite captura manual', 409, 'HR_PAYROLL_RESERVED_COMPONENT_CODE');
            }
            if (typeof payload.incomeTaxDeductible !== 'boolean' || (type === 'INCOME' && [payload.taxable, payload.socialSecurityApplicable, payload.trainingContributionApplicable].some(value => typeof value !== 'boolean'))) {
                throw new HrPayrollError('Todo componente manual debe clasificar explícitamente su tratamiento de IR, INSS e INATEC', 409, 'HR_PAYROLL_COMPONENT_CLASSIFICATION_REQUIRED');
            }
            if (type === 'INCOME' && payload.incomeTaxDeductible !== false) {
                throw new HrPayrollError('Un ingreso no puede declararse como deducción autorizada de IR', 409, 'HR_PAYROLL_COMPONENT_CLASSIFICATION_MISMATCH');
            }
            if (type === 'DEDUCTION' && (payload.incomeTaxTreatment !== undefined || [payload.taxable, payload.socialSecurityApplicable, payload.trainingContributionApplicable].some(value => value === true))) {
                throw new HrPayrollError('Una deducción no puede declarar tratamiento ni bases propias de un ingreso', 409, 'HR_PAYROLL_COMPONENT_CLASSIFICATION_MISMATCH');
            }
            if (payload.classificationConfirmed !== true) {
                throw new HrPayrollError('Debe confirmar la clasificación tributaria exacta antes de guardar', 409, 'HR_PAYROLL_COMPONENT_CLASSIFICATION_CONFIRMATION_REQUIRED');
            }
            const incomeTaxTreatment = type === 'INCOME' && payload.taxable === true && ['REGULAR_FIXED', 'REGULAR_VARIABLE', 'OCCASIONAL'].includes(String(payload.incomeTaxTreatment))
                ? payload.incomeTaxTreatment as IncomeTaxTreatment : null;
            if (type === 'INCOME' && ((payload.taxable === true && !incomeTaxTreatment) || (payload.taxable === false && payload.incomeTaxTreatment))) {
                throw new HrPayrollError('Un ingreso gravable exige tratamiento fijo, variable u ocasional; uno exento no debe tener tratamiento', 409, 'HR_PAYROLL_INCOME_TAX_TREATMENT_REQUIRED');
            }
            const configuredConcept = paymentConceptDefinition(legalConfig.statutory, code);
            if (!configuredConcept) {
                throw new HrPayrollError('El concepto no existe en el catálogo de pagos de la configuración legal congelada', 409, 'HR_PAYROLL_PAYMENT_CONCEPT_NOT_CONFIGURED');
            }
            const configuredFlags = statutoryFlags(code, legalConfig);
            if (configuredConcept.type !== type || Boolean(payload.taxable) !== configuredFlags.taxable ||
                incomeTaxTreatment !== configuredFlags.incomeTaxTreatment || payload.incomeTaxDeductible !== configuredFlags.incomeTaxDeductible ||
                payload.socialSecurityApplicable !== configuredFlags.socialSecurityApplicable ||
                payload.trainingContributionApplicable !== configuredFlags.trainingContributionApplicable) {
                throw new HrPayrollError('La clasificación manual no coincide con el catálogo de pagos de la configuración legal congelada', 409, 'HR_PAYROLL_COMPONENT_CLASSIFICATION_MISMATCH');
            }
            if (kind === 'AGUINALDO' && payload.taxable === true) {
                throw new HrPayrollError('El exceso gravable no se agrega a una corrida de aguinaldo; regístrelo en una corrida regular con tratamiento explícito', 409, 'HR_PAYROLL_AGUINALDO_TAXABLE_MANUAL_FORBIDDEN');
            }
            if (payload.incomeTaxDeductible === true && (kind !== 'REGULAR' || configuredConcept.type !== 'DEDUCTION' || !configuredConcept.incomeTaxDeductible)) {
                throw new HrPayrollError('La deducción no está autorizada por la configuración legal congelada de IR', 409, 'HR_PAYROLL_INCOME_TAX_DEDUCTION_NOT_AUTHORIZED');
            }
            const reference = type === 'DEDUCTION' && payload.incomeTaxDeductible
                ? requiredText(payload.reference, 'reference', 500)
                : optionalText(payload.reference, 500);
            const component = await tx.payrollComponent.create({ data: {
                companyId, runId, userId, code, name: configuredConcept.name,
                type, source: 'MANUAL', amount,
                taxable: type === 'INCOME' ? payload.taxable as boolean : false,
                incomeTaxTreatment,
                incomeTaxDeductible: type === 'DEDUCTION' ? payload.incomeTaxDeductible as boolean : false,
                socialSecurityApplicable: type === 'INCOME' ? payload.socialSecurityApplicable as boolean : false,
                trainingContributionApplicable: type === 'INCOME' ? payload.trainingContributionApplicable as boolean : false,
                reason: requiredText(payload.reason, 'reason'), traceReference: reference ?? configuredConcept.sourceReference, createdById: actorId,
            } });
            const revision = run.revision + 1;
            let employerContributions = run.employerContributions;
            if (kind === 'REGULAR') {
                if (!run.period) throw new HrPayrollError('La corrida no conserva período estatutario', 409, 'HR_PAYROLL_SOURCE_STALE');
                const config = legalConfig;
                const employerHeadcount = await employerHeadcountAt(tx, companyId, run.period.dateFrom, run.period.dateTo);
                const allSnapshots = await tx.payrollSnapshotLine.findMany({ where: { companyId, runId }, orderBy: { userId: 'asc' } });
                for (const frozen of allSnapshots) await applyStatutoryForUser(tx, {
                    companyId, runId, userId: frozen.userId, employeeId: frozen.employeeId, calculationRevision: revision,
                    employerHeadcount, configurationRevisionId: run.configurationRevision.id,
                    config, period: run.period, snapshot: frozen,
                });
                const employerAggregate = await tx.payrollEmployerContribution.aggregate({ where: { companyId, runId, calculationRevision: revision }, _sum: { amount: true } });
                employerContributions = money(employerAggregate._sum.amount ?? 0);
            }
            const aggregate = await tx.payrollComponent.groupBy({ by: ['type'], where: { runId, companyId }, _sum: { amount: true } });
            const gross = money(aggregate.find(item => item.type === 'INCOME')?._sum.amount ?? 0);
            const deductions = money(aggregate.find(item => item.type === 'DEDUCTION')?._sum.amount ?? 0);
            const net = money(gross.minus(deductions));
            await tx.payrollAnomaly.deleteMany({ where: { companyId, runId, userId, code: 'NEGATIVE_NET_PAY', resolvedAt: null } });
            if (net.isNegative()) await addAnomaly(tx, { companyId, runId, userId, code: 'NEGATIVE_NET_PAY', message: 'El componente deja un neto negativo; ajuste y recalcule' });
            const updated = await tx.payrollRun.updateMany({ where: { id: runId, companyId, revision: run.revision, status: 'CALCULATED' }, data: {
                grossIncome: gross, totalDeductions: deductions, employerContributions, netPay: net, revision, calculationRevision: revision,
            } });
            if (updated.count !== 1) throw new HrPayrollError('La corrida cambió concurrentemente', 409, 'HR_PAYROLL_REVISION_CONFLICT');
            await trace(tx, { companyId, runId, event: 'ADD_MANUAL_COMPONENT', actorId, reason: component.reason!, revision, metadata: { componentId: component.id, userId, amount: amount.toFixed(2), classificationConfirmed: true } });
            return serialize(component);
        });
    }

    static async export(companyId: number, runId: number, kind: PayrollRunKind, format: 'csv' | 'xlsx'): Promise<{ contentType: string; filename: string; buffer: Buffer }> {
        const run = await loadRun(companyId, runId, kind);
        const snapshots = await prisma.payrollSnapshotLine.findMany({ where: { companyId, runId }, include: { user: { select: userSelect }, employee: { select: { employeeCode: true, legalName: true } } }, orderBy: { userId: 'asc' } });
        const components = await prisma.payrollComponent.findMany({ where: { companyId, runId }, include: { reversal: true } });
        const employerLines = run.calculationRevision ? await prisma.payrollEmployerContribution.findMany({ where: { companyId, runId, calculationRevision: run.calculationRevision } }) : [];
        const statutoryLines = run.calculationRevision ? await prisma.payrollStatutoryCalculation.findMany({
            where: { companyId, runId, calculationRevision: run.calculationRevision },
        }) : [];
        const rows = snapshots.map(item => {
            const mine = components.filter(component => component.userId === item.userId);
            const mineEmployer = employerLines.filter(line => line.userId === item.userId);
            const statutory = statutoryLines.find(line => line.userId === item.userId);
            const originalGrossIncome = money(mine.filter(component => component.type === 'INCOME').reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0)));
            const reversedGrossIncome = money(mine.filter(component => component.type === 'INCOME').reduce((sum, component) => sum.plus(component.reversal?.amount ?? 0), new Prisma.Decimal(0)));
            const grossIncome = money(originalGrossIncome.plus(reversedGrossIncome));
            const originalDeductions = money(mine.filter(component => component.type === 'DEDUCTION').reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0)));
            const reversedDeductions = money(mine.filter(component => component.type === 'DEDUCTION').reduce((sum, component) => sum.plus(component.reversal?.amount ?? 0), new Prisma.Decimal(0)));
            const totalDeductions = money(originalDeductions.plus(reversedDeductions));
            const amountFor = (code: string) => money(mine.filter(component => component.code === code).reduce((sum, component) => sum.plus(component.amount).plus(component.reversal?.amount ?? 0), new Prisma.Decimal(0))).toFixed(2);
            const originalEmployerContributions = money(mineEmployer.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0)));
            const reversedEmployerContributions = run.status === 'VOID' ? originalEmployerContributions.negated() : new Prisma.Decimal(0);
            const employerContributions = money(originalEmployerContributions.plus(reversedEmployerContributions));
            const employerAmountFor = (code: string) => {
                const original = money(mineEmployer.filter(line => line.code === code).reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0)));
                return money(run.status === 'VOID' ? original.plus(original.negated()) : original).toFixed(2);
            };
            return {
                code: run.code, employeeCode: item.employee.employeeCode, legalName: item.employee.legalName, userId: item.userId,
                originalGrossIncome: originalGrossIncome.toFixed(2), reversedGrossIncome: reversedGrossIncome.toFixed(2), grossIncome: grossIncome.toFixed(2),
                employeeInss: amountFor('INSS_LABORAL'), incomeTax: amountFor('IR_LABORAL'), incomeTaxRefund: amountFor('IR_LABORAL_DEVOLUCION'),
                originalDeductions: originalDeductions.toFixed(2), reversedDeductions: reversedDeductions.toFixed(2), totalDeductions: totalDeductions.toFixed(2),
                employerInss: employerAmountFor('INSS_PATRONAL'), employerInatec: employerAmountFor('INATEC_PATRONAL'),
                originalEmployerContributions: originalEmployerContributions.toFixed(2), reversedEmployerContributions: reversedEmployerContributions.toFixed(2),
                employerContributions: employerContributions.toFixed(2), netPay: grossIncome.minus(totalDeductions).toFixed(2),
                statutoryMethodVersion: statutory?.methodVersion ?? '', statutoryIncomeTaxMethod: statutory?.incomeTaxMethod ?? '',
                statutoryConfigurationRevisionId: statutory?.configurationRevisionId ?? '',
                statutoryFixedGross: statutory?.fixedIncomeTaxGross.toFixed(2) ?? '', statutoryVariableGross: statutory?.variableIncomeTaxGross.toFixed(2) ?? '',
                statutoryOccasionalGross: statutory?.occasionalIncomeTaxGross.toFixed(2) ?? '', statutoryRegularNet: statutory?.currentRegularIncomeTaxNet.toFixed(2) ?? '',
                statutoryOccasionalNet: statutory?.currentOccasionalIncomeTaxNet.toFixed(2) ?? '', statutoryAccumulatedNet: statutory?.accumulatedIncomeTaxNet.toFixed(2) ?? '',
                statutoryElapsedFiscalMonths: statutory?.elapsedFiscalMonths ?? '', statutoryAnnualProjection: statutory?.annualProjection.toFixed(2) ?? '',
                statutoryRegularAnnualTax: statutory?.regularAnnualIncomeTax.toFixed(2) ?? '', statutoryAnnualTaxWithOccasional: statutory?.annualIncomeTaxWithOccasional.toFixed(2) ?? '',
                statutoryRegularWithholding: statutory?.regularIncomeTaxWithheld.toFixed(2) ?? '', statutoryOccasionalWithholding: statutory?.occasionalIncomeTaxWithheld.toFixed(2) ?? '',
                statutoryCreditBalance: statutory?.incomeTaxCreditBalance.toFixed(2) ?? '', statutoryBracketSnapshot: statutory?.bracketSnapshot ? JSON.stringify(statutory.bracketSnapshot) : '',
                statutoryHistoryFingerprint: statutory?.historyFingerprint ?? '',
                currency: item.currency, status: run.status,
            };
        });
        if (format === 'csv') {
            const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
            const headers = [
                'code', 'employeeCode', 'legalName', 'userId',
                'originalGrossIncome', 'reversedGrossIncome', 'grossIncome',
                'employeeInss', 'incomeTax', 'incomeTaxRefund',
                'originalDeductions', 'reversedDeductions', 'totalDeductions',
                'employerInss', 'employerInatec', 'originalEmployerContributions', 'reversedEmployerContributions', 'employerContributions',
                'statutoryMethodVersion', 'statutoryIncomeTaxMethod', 'statutoryConfigurationRevisionId',
                'statutoryFixedGross', 'statutoryVariableGross', 'statutoryOccasionalGross', 'statutoryRegularNet', 'statutoryOccasionalNet',
                'statutoryAccumulatedNet', 'statutoryElapsedFiscalMonths', 'statutoryAnnualProjection', 'statutoryRegularAnnualTax', 'statutoryAnnualTaxWithOccasional',
                'statutoryRegularWithholding', 'statutoryOccasionalWithholding', 'statutoryCreditBalance', 'statutoryBracketSnapshot', 'statutoryHistoryFingerprint',
                'netPay', 'currency', 'status',
            ];
            const csv = [headers.join(','), ...rows.map(row => headers.map(header => quote(row[header as keyof typeof row])).join(','))].join('\r\n');
            return { contentType: 'text/csv; charset=utf-8', filename: `${run.code}.csv`, buffer: Buffer.from(`\ufeff${csv}`, 'utf8') };
        }
        const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Nómina');
        sheet.columns = Object.keys(rows[0] ?? { code: '', employeeCode: '', legalName: '', userId: '', grossIncome: '', totalDeductions: '', netPay: '', currency: '', status: '' }).map(key => ({ header: key, key, width: 22 }));
        sheet.addRows(rows); const bytes = await workbook.xlsx.writeBuffer();
        return { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${run.code}.xlsx`, buffer: Buffer.from(bytes) };
    }
}

const receiptInclude = Prisma.validator<Prisma.PayrollReceiptInclude>()({
    components: true,
    user: { select: userSelect },
    employee: { select: { employeeCode: true, legalName: true } },
    company: { select: { name: true, ruc: true } },
    run: { include: {
        employerContributionLines: true,
        trace: { include: { actor: { select: actorSelect } }, orderBy: { occurredAt: 'asc' } },
    } },
});
type ReceiptItem = Prisma.PayrollReceiptGetPayload<{ include: typeof receiptInclude }>;

async function receiptDetail(receipt: ReceiptItem, selfSafe = false) {
    return serialize({
        ...receipt,
        companyName: receipt.company.name,
        companyRuc: receipt.company.ruc,
        components: receipt.components,
        employerContributions: receipt.run.employerContributionLines.filter(item => item.userId === receipt.userId),
        trace: selfSafe ? [] : receipt.run.trace,
        run: undefined,
        company: undefined,
        user: receipt.user,
        employeeCode: receipt.employee.employeeCode,
        legalName: receipt.employee.legalName,
    });
}

export interface PayrollReceiptPdfInput {
    id: number;
    runKind: 'REGULAR' | 'AGUINALDO';
    runCode: string;
    periodLabel: string;
    payDate: string | Date;
    publishedAt?: string | Date | null;
    currency: string;
    grossIncome: string;
    totalDeductions: string;
    netPay: string;
    status: string;
    legalName: string;
    employeeCode: string;
    companyName?: string | null;
    companyRuc?: string | null;
    components: Array<{ code: string; name: string; type: 'INCOME' | 'DEDUCTION'; amount: string; reason?: string | null }>;
    employerContributions?: Array<{ code: string; name: string; baseAmount: string; rate: string; amount: string }>;
}

export interface PayrollReceiptPdfModel {
    company: { name: string; ruc: string };
    document: { title: string; kind: string; number: string; verificationCode: string; status: string };
    employee: { name: string; code: string };
    period: { label: string; payDate: string; runCode: string };
    incomes: Array<{ concept: string; reference: string; amount: string }>;
    deductions: Array<{ concept: string; reference: string; amount: string }>;
    employerContributions: Array<{ concept: string; base: string; rate: string; amount: string }>;
    totals: { gross: string; deductions: string; net: string };
    notes: string[];
}

const payrollCurrencySymbol = (currency: string) => currency === 'NIO' ? 'C$' : currency === 'USD' ? 'US$' : currency;
const payrollMoney = (currency: string, value: string) => {
    const amount = Number(value);
    const formatted = Number.isFinite(amount)
        ? amount.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '0.00';
    return `${payrollCurrencySymbol(currency)} ${formatted.replace(/\u00a0/g, ' ')}`;
};
const payrollPercent = (value: string) => `${(Number(value) * 100).toLocaleString('es-NI', { maximumFractionDigits: 4 })}%`;

export function buildPayrollReceiptPdfModel(receipt: PayrollReceiptPdfInput): PayrollReceiptPdfModel {
    const verificationCode = createHash('sha256').update([
        receipt.id, receipt.runCode, receipt.employeeCode, receipt.grossIncome,
        receipt.totalDeductions, receipt.netPay, receipt.status,
    ].join('|')).digest('hex').slice(0, 16).toUpperCase();
    const rows = (type: 'INCOME' | 'DEDUCTION') => receipt.components
        .filter(component => component.type === type)
        .map(component => ({
            concept: component.name,
            reference: component.reason?.trim() || component.code,
            amount: payrollMoney(receipt.currency, component.amount),
        }));
    return {
        company: { name: receipt.companyName?.trim() || 'Empresa', ruc: receipt.companyRuc?.trim() || 'No registrado' },
        document: {
            title: 'Colilla de pago',
            kind: receipt.runKind === 'AGUINALDO' ? 'Aguinaldo' : 'Nómina ordinaria',
            number: `REC-${receipt.id}`,
            verificationCode,
            status: receipt.status === 'PUBLISHED' ? 'Publicada' : 'Anulada',
        },
        employee: { name: receipt.legalName, code: receipt.employeeCode },
        period: { label: receipt.periodLabel, payDate: dateKey(new Date(receipt.payDate)), runCode: receipt.runCode },
        incomes: rows('INCOME'),
        deductions: rows('DEDUCTION'),
        employerContributions: (receipt.employerContributions ?? []).map(item => ({
            concept: item.name,
            base: payrollMoney(receipt.currency, item.baseAmount),
            rate: payrollPercent(item.rate),
            amount: payrollMoney(receipt.currency, item.amount),
        })),
        totals: {
            gross: payrollMoney(receipt.currency, receipt.grossIncome),
            deductions: payrollMoney(receipt.currency, receipt.totalDeductions),
            net: payrollMoney(receipt.currency, receipt.netPay),
        },
        notes: [
            'Los aportes patronales son costos de la empresa y no reducen el neto del empleado.',
            'Documento generado desde una colilla publicada e inmutable de la corrida de nómina.',
            'Conserve este documento como comprobante de pago. Cualquier aclaración debe tramitarse con Recursos Humanos.',
        ],
    };
}

export class PayrollReceiptService {
    static async myList(companyId: number, userId: number, filters: InputMap) {
        const p = paging(filters); const where: Prisma.PayrollReceiptWhereInput = { companyId, userId, status: 'PUBLISHED', payDate: { gte: filters.dateFrom ? dateValue(filters.dateFrom, 'dateFrom') : undefined, lte: filters.dateTo ? dateValue(filters.dateTo, 'dateTo') : undefined } };
        const [items, total] = await Promise.all([prisma.payrollReceipt.findMany({ where, orderBy: { payDate: 'desc' }, skip: p.skip, take: p.pageSize }), prisma.payrollReceipt.count({ where })]);
        return { items: serialize(items), pagination: { page: p.page, pageSize: p.pageSize, total, totalPages: Math.ceil(total / p.pageSize) } };
    }

    static async get(companyId: number, receiptId: number, opts: { userId?: number; runId?: number; publishedOnly?: boolean; selfSafe?: boolean } = {}) {
        const receipt = await prisma.payrollReceipt.findFirst({
            where: { id: receiptId, companyId, userId: opts.userId, runId: opts.runId, status: opts.publishedOnly ? 'PUBLISHED' : undefined },
            include: receiptInclude,
        });
        if (!receipt) throw new HrPayrollError('Recibo no encontrado', 404, 'HR_PAYROLL_RECEIPT_NOT_FOUND');
        return receiptDetail(receipt, opts.selfSafe === true);
    }

    static async pdf(companyId: number, receiptId: number, opts: { userId?: number; runId?: number; publishedOnly?: boolean; selfSafe?: boolean } = {}) {
        const receipt = await this.get(companyId, receiptId, opts) as unknown as PayrollReceiptPdfInput;
        const model = buildPayrollReceiptPdfModel(receipt);
        const document = new jsPDF({ unit: 'mm', format: 'a4' });
        const pageWidth = document.internal.pageSize.getWidth();
        const margin = 14;
        const tableStyles = { fontSize: 8.5, cellPadding: 2.4, lineColor: [220, 226, 235] as [number, number, number], lineWidth: 0.1 };
        const headStyles = { fillColor: [31, 61, 104] as [number, number, number], textColor: 255, fontStyle: 'bold' as const };

        document.setFillColor(20, 45, 82);
        document.rect(0, 0, pageWidth, 33, 'F');
        document.setTextColor(255, 255, 255);
        document.setFont('helvetica', 'bold');
        document.setFontSize(15);
        document.text(model.company.name, margin, 12);
        document.setFont('helvetica', 'normal');
        document.setFontSize(8.5);
        document.text(`RUC: ${model.company.ruc}`, margin, 18);
        document.text(`${model.document.kind} · ${model.document.number}`, margin, 24);
        document.setFont('helvetica', 'bold');
        document.setFontSize(17);
        document.text('COLILLA DE PAGO', pageWidth - margin, 14, { align: 'right' });
        document.setFontSize(8.5);
        document.text(`Estado: ${model.document.status}`, pageWidth - margin, 22, { align: 'right' });

        document.setTextColor(25, 35, 52);
        autoTable(document, {
            startY: 39,
            margin: { left: margin, right: margin },
            theme: 'grid',
            styles: tableStyles,
            headStyles,
            head: [['Empleado', 'Código', 'Período', 'Fecha de pago']],
            body: [[model.employee.name, model.employee.code, model.period.label, model.period.payDate]],
        });
        let cursor = (document as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

        const paymentTable = (title: string, rows: Array<{ concept: string; reference: string; amount: string }>, empty: string) => {
            document.setFont('helvetica', 'bold');
            document.setFontSize(11);
            document.text(title, margin, cursor);
            autoTable(document, {
                startY: cursor + 3,
                margin: { left: margin, right: margin },
                theme: 'grid',
                styles: tableStyles,
                headStyles,
                head: [['Concepto', 'Referencia', 'Importe']],
                body: rows.length ? rows.map(row => [row.concept, row.reference, row.amount]) : [[empty, '—', '—']],
                columnStyles: { 2: { halign: 'right', cellWidth: 34 } },
            });
            cursor = (document as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
        };
        paymentTable('Ingresos', model.incomes, 'Sin ingresos registrados');
        paymentTable('Deducciones', model.deductions, 'Sin deducciones registradas');

        document.setFont('helvetica', 'bold');
        document.setFontSize(11);
        document.text('Aportes de la empresa (informativo)', margin, cursor);
        autoTable(document, {
            startY: cursor + 3,
            margin: { left: margin, right: margin },
            theme: 'grid',
            styles: tableStyles,
            headStyles,
            head: [['Concepto', 'Base', 'Tasa', 'Aporte patronal']],
            body: model.employerContributions.length
                ? model.employerContributions.map(row => [row.concept, row.base, row.rate, row.amount])
                : [['Sin aportes patronales registrados', '—', '—', '—']],
            columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
        });
        cursor = (document as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

        autoTable(document, {
            startY: cursor,
            margin: { left: pageWidth - margin - 88, right: margin },
            theme: 'grid',
            styles: { ...tableStyles, fontSize: 9.5 },
            body: [
                ['Total ingresos', model.totals.gross],
                ['Total deducciones', model.totals.deductions],
                ['NETO PAGADO', model.totals.net],
            ],
            columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right', fontStyle: 'bold' } },
            didParseCell: hook => {
                if (hook.row.index === 2) {
                    hook.cell.styles.fillColor = [225, 247, 235];
                    hook.cell.styles.textColor = [14, 100, 63];
                    hook.cell.styles.fontSize = 11;
                }
            },
        });
        cursor = (document as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
        if (cursor > 238) { document.addPage(); cursor = 22; }
        document.setFont('helvetica', 'bold');
        document.setFontSize(9);
        document.text('Notas', margin, cursor);
        document.setFont('helvetica', 'normal');
        document.setFontSize(8);
        model.notes.forEach(note => {
            const noteLines = document.splitTextToSize(`• ${note}`, pageWidth - margin * 2);
            document.text(noteLines, margin, cursor + 5);
            cursor += noteLines.length * 4 + 2;
        });
        if (cursor > 257) { document.addPage(); cursor = 28; }
        document.setDrawColor(125, 135, 150);
        document.line(margin, cursor + 12, margin + 72, cursor + 12);
        document.line(pageWidth - margin - 72, cursor + 12, pageWidth - margin, cursor + 12);
        document.setFontSize(8);
        document.text('Firma del empleado', margin + 36, cursor + 17, { align: 'center' });
        document.text('Firma autorizada / RR. HH.', pageWidth - margin - 36, cursor + 17, { align: 'center' });

        const pageCount = document.getNumberOfPages();
        for (let page = 1; page <= pageCount; page += 1) {
            document.setPage(page);
            document.setFont('helvetica', 'normal');
            document.setFontSize(7.5);
            document.setTextColor(90, 102, 120);
            document.text(`Corrida ${model.period.runCode} · Validación ${model.document.verificationCode}`, margin, 290);
            document.text(`Página ${page} de ${pageCount}`, pageWidth - margin, 290, { align: 'right' });
        }
        return { contentType: 'application/pdf', filename: `colilla-${receipt.employeeCode}-${receipt.id}.pdf`, buffer: Buffer.from(document.output('arraybuffer')) };
    }
}
