import { createHash } from 'node:crypto';
import { Prisma, type PayrollRuleStatus, type PayrollRunKind, type PayrollRunStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import prisma from '../utils/prisma';
import { isValidTimeZone } from '../utils/timezone';
import { AuditLogService } from './audit-log.service';
import { commitBenefitDeductions, projectBenefitDeductions, reverseBenefitDeductions } from './hr-benefits.service';

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
    schema: 'HR_PAYROLL_PARAMETRIC_V1';
    legallyValidated: true;
    currency: string;
    regular: {
        minuteDivisors: Record<'WEEKLY' | 'BIWEEKLY' | 'MONTHLY', string>;
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
};

function positiveDecimalText(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return false;
    return new Prisma.Decimal(value).greaterThan(0);
}

export function validateLegalConfiguration(value: unknown): LegalConfiguration {
    const config = value as Partial<LegalConfiguration> | null;
    const divisors = config?.regular?.minuteDivisors;
    if (
        !config || config.schema !== 'HR_PAYROLL_PARAMETRIC_V1' || config.legallyValidated !== true ||
        typeof config.currency !== 'string' || !/^[A-Z]{3}$/.test(config.currency) ||
        !divisors || !positiveDecimalText(divisors.WEEKLY) || !positiveDecimalText(divisors.BIWEEKLY) ||
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
    return `Esquema ${config.schema}; moneda ${config.currency}; aguinaldo ${config.aguinaldo.method}; fuente histórica ${config.aguinaldo.lookbackDays} días; hash ${hash.slice(0, 12)}`;
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

async function assertRevision(run: { revision: number }, expectedRevision: number) {
    if (!Number.isInteger(expectedRevision) || run.revision !== expectedRevision) {
        throw new HrPayrollError('La corrida cambió; actualice la vista antes de continuar', 409, 'HR_PAYROLL_REVISION_CONFLICT');
    }
}

async function trace(tx: Prisma.TransactionClient, data: { companyId: number; runId: number; event: string; actorId?: number; reason?: string; fromStatus?: string; toStatus?: string; revision: number; metadata?: Prisma.InputJsonValue }) {
    await tx.payrollTrace.create({ data });
}

export class PayrollRuleService {
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
            const config = validateLegalConfiguration(payload.configuration);
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
            return serialize({ id: item.id, ruleVersionId: id, revision, configurationHash, sourceReference: item.sourceReference, evidenceReference: item.evidenceReference, uploadedById: actorId, uploadedAt: item.uploadedAt, status: 'UPLOADED' });
        });
    }

    static async listConfigurationRevisions(id: number, companyId: number) {
        if (!await prisma.payrollRuleVersion.findFirst({ where: { id, companyId }, select: { id: true } })) throw new HrPayrollError('Regla no encontrada', 404, 'HR_PAYROLL_RULE_NOT_FOUND');
        const items = await prisma.payrollRuleConfigurationRevision.findMany({ where: { companyId, ruleVersionId: id }, include: {
            uploadedBy: { select: actorSelect }, review: { include: { reviewer: { select: actorSelect } } },
        }, orderBy: { revision: 'desc' } });
        return serialize(items.map(item => ({
            id: item.id, ruleVersionId: item.ruleVersionId, revision: item.revision, configurationHash: item.configurationHash,
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
            const config = validateLegalConfiguration(configuration.configuration);
            const decision = payload.decision === 'REJECTED' ? 'REJECTED' : payload.decision === 'VALIDATED' ? 'VALIDATED' : (() => { throw new HrPayrollError('decision debe ser VALIDATED o REJECTED'); })();
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
                validateLegalConfiguration(validated.configuration);
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
    return { rule, configurationRevision: rule.activeConfigurationRevision, config: validateLegalConfiguration(rule.activeConfigurationRevision.configuration) };
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

export function compensationMinuteRate(item: { compensationType: string; amount: Prisma.Decimal; payFrequency: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' }, config: LegalConfiguration) {
    return item.compensationType === 'HOURLY' ? item.amount.dividedBy(60) : item.amount.dividedBy(config.regular.minuteDivisors[item.payFrequency]);
}

async function calculate(tx: Prisma.TransactionClient, companyId: number, runId: number, actorId: number, kind: PayrollRunKind, reason: string) {
    const run = await tx.payrollRun.findFirst({ where: { id: runId, companyId, kind }, include: { period: true } });
    if (!run || !['DRAFT', 'CALCULATED'].includes(run.status)) throw new HrPayrollError('La corrida no admite cálculo', 409, 'HR_PAYROLL_RUN_IMMUTABLE');
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
        if (contracts.length && intervalHasGap(contracts, serviceFrom, serviceTo, item => item.startDate, item => item.endDate)) await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'CONTRACT_COVERAGE_GAP', message: 'El contrato no cubre de forma continua el período de servicio' });
        if (compensations.length && intervalHasGap(compensations, serviceFrom, serviceTo, item => item.effectiveFrom, item => item.effectiveTo)) await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'COMPENSATION_COVERAGE_GAP', message: 'La compensación no cubre de forma continua el período de servicio' });
        const summaries = kind === 'REGULAR' ? await tx.attendanceDailySummary.findMany({ where: { companyId, userId: employee.userId, periodId: attendancePeriod!.id }, select: { id: true, date: true, ordinaryMinutes: true, approvedOvertimeMinutes: true, sourceRevision: true }, orderBy: { date: 'asc' } }) : [];
        const summaryRevisions = summaries.map(item => ({ id: item.id, revision: item.sourceRevision })); dependencyRevisions.push(...summaryRevisions);
        const leaves = kind === 'REGULAR' ? await tx.leaveRequest.findMany({ where: { companyId, userId: employee.userId, status: 'APPROVED', startDate: { lte: cutoff }, endDate: { gte: coverageFrom } }, include: { leaveType: { select: { paid: true, code: true } } } }) : [];
        const crossing = leaves.find(item => item.startDate < coverageFrom || item.endDate > cutoff);
        if (crossing) await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'CROSS_BOUNDARY_LEAVE', message: `Ausencia ${crossing.id} cruza la cobertura; requiere prorrateo autorizado` });
        let ordinary = new Prisma.Decimal(0); let overtime = new Prisma.Decimal(0); let paidLeave = new Prisma.Decimal(0);
        const compensationSegments: JsonObject[] = []; const historicalSegments: JsonObject[] = [];
        if (kind === 'REGULAR' && !crossing) {
            for (const summary of summaries) {
                const segment = compensations.find(item => item.effectiveFrom <= summary.date && (!item.effectiveTo || item.effectiveTo >= summary.date));
                if (!segment) { await addAnomaly(tx, { companyId, runId, employeeId: employee.id, userId: employee.userId, code: 'COMPENSATION_GAP', message: `Falta compensación para ${dateKey(summary.date)}` }); continue; }
                try {
                    const base = convertCurrency(compensationMinuteRate(segment, config).times(summary.ordinaryMinutes), segment.currency, config);
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
            sourceTrace: { hireDate: dateKey(employee.hireDate), terminationDate: employee.terminationDate ? dateKey(employee.terminationDate) : null, serviceFrom: dateKey(serviceFrom), serviceTo: dateKey(serviceTo), configurationRevisionId: configurationRevision.id, configurationHash: configurationRevision.configurationHash, approvedLeaves: leaves.map(item => ({ id: item.id, from: dateKey(item.startDate), to: dateKey(item.endDate), paid: item.leaveType.paid, amount: item.requestedAmount.toString(), unit: item.balanceUnit })), frozen: true },
        } });
        if (ordinary.greaterThan(0)) await tx.payrollComponent.create({ data: { companyId, runId, userId: employee.userId, code: kind === 'AGUINALDO' ? 'AGUINALDO_HISTORICO' : 'INGRESO_ORDINARIO', name: kind === 'AGUINALDO' ? 'Aguinaldo histórico parametrizado' : 'Ingreso ordinario segmentado', type: 'INCOME', source: 'RULE', amount: money(ordinary), traceReference: `snapshot:user:${employee.userId};config:${configurationRevision.id}` } });
        if (overtime.greaterThan(0)) await tx.payrollComponent.create({ data: { companyId, runId, userId: employee.userId, code: 'HORAS_EXTRA_APROBADAS', name: 'Horas extra aprobadas', type: 'INCOME', source: 'OVERTIME', amount: money(overtime), traceReference: `snapshot:user:${employee.userId}` } });
        if (paidLeave.greaterThan(0)) await tx.payrollComponent.create({ data: { companyId, runId, userId: employee.userId, code: 'PERMISO_PAGADO_APROBADO', name: 'Permiso pagado aprobado', type: 'INCOME', source: 'LEAVE', amount: money(paidLeave), traceReference: `snapshot:user:${employee.userId}` } });
        if (kind === 'REGULAR') await projectBenefitDeductions(tx, { companyId, runId, userId: employee.userId, currency: config.currency, cutoff });
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
    await tx.payrollRun.update({ where: { id: runId }, data: { status: 'CALCULATED', revision, calculationRevision: revision, configurationRevisionId: configurationRevision.id, currency: config.currency, grossIncome: gross, totalDeductions: deductions, netPay: net, employeeCount: employees.length, calculatedById: actorId, calculatedAt: new Date(), lastReason: reason } });
    await trace(tx, { companyId, runId, event: run.status === 'DRAFT' ? 'CALCULATE' : 'RECALCULATE', actorId, reason, fromStatus: run.status, toStatus: 'CALCULATED', revision, metadata: { configurationRevisionId: configurationRevision.id, configurationHash: configurationRevision.configurationHash } });
}

async function revalidateFrozenSources(tx: Prisma.TransactionClient, companyId: number, runId: number) {
    const run = await tx.payrollRun.findFirst({ where: { id: runId, companyId }, include: { configurationRevision: { include: { review: true } }, attendanceDependencies: true, snapshots: true } });
    if (!run?.configurationRevision || run.configurationRevision.review?.decision !== 'VALIDATED') throw new HrPayrollError('La configuración congelada dejó de estar VALIDATED', 409, 'HR_PAYROLL_SOURCE_STALE');
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
        const calculatedNet = money(calculatedGross.minus(calculatedDeductions));
        const snapshotUsers = new Set(run.snapshots.map(snapshot => snapshot.userId));
        const activeClaims = run.coverageClaims.filter(claim => !claim.release);
        const componentUsersValid = activeComponents.every(component => snapshotUsers.has(component.userId));
        const claimUsers = new Set(activeClaims.map(claim => claim.userId));
        const coverageValid = activeClaims.length === run.snapshots.length && snapshotUsers.size === claimUsers.size && [...snapshotUsers].every(userId => claimUsers.has(userId));
        const perEmployee = [...snapshotUsers].map(userId => {
            const components = activeComponents.filter(component => component.userId === userId);
            const gross = money(components.filter(component => component.type === 'INCOME').reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0)));
            const deductions = money(components.filter(component => component.type === 'DEDUCTION').reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0)));
            return { userId, grossIncome: gross.toFixed(2), totalDeductions: deductions.toFixed(2), netPay: money(gross.minus(deductions)).toFixed(2) };
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
            check('EXTERNAL_NET_MATCH', 'Neto contra control paralelo externo', calculatedNet.equals(expectedNetPay), expectedNetPay.toFixed(2), calculatedNet.toFixed(2)),
            check('EXTERNAL_EMPLOYEE_COUNT_MATCH', 'Personas contra control paralelo externo', run.snapshots.length === expectedEmployeeCount, expectedEmployeeCount, run.snapshots.length),
        ];
        const reconciliationHash = hashPayload({
            companyId, runId: id, kind, runRevision: run.revision, calculationRevision: run.calculationRevision,
            controlSource, evidenceReference,
            expected: { grossIncome: expectedGrossIncome.toFixed(2), totalDeductions: expectedTotalDeductions.toFixed(2), netPay: expectedNetPay.toFixed(2), employeeCount: expectedEmployeeCount },
            actual: { grossIncome: calculatedGross.toFixed(2), totalDeductions: calculatedDeductions.toFixed(2), netPay: calculatedNet.toFixed(2), employeeCount: run.snapshots.length },
            checks: checks.map(item => ({ code: item.code, passed: item.passed })),
        });
        const result = {
            run: { id: run.id, code: run.code, kind: run.kind, status: run.status, revision: run.revision, calculationRevision: run.calculationRevision, currency: run.currency },
            control: { source: controlSource, evidenceReference },
            expected: { grossIncome: expectedGrossIncome.toFixed(2), totalDeductions: expectedTotalDeductions.toFixed(2), netPay: expectedNetPay.toFixed(2), employeeCount: expectedEmployeeCount },
            actual: { grossIncome: calculatedGross.toFixed(2), totalDeductions: calculatedDeductions.toFixed(2), netPay: calculatedNet.toFixed(2), employeeCount: run.snapshots.length },
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
            const locked = await lockedRun(tx, companyId, id, kind); await assertRevision(locked, input.expectedRevision);
            const run = await tx.payrollRun.findUniqueOrThrow({ where: { id } });
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
                if (action === 'void') await assertNotLiveAguinaldoSource(tx, companyId, id);
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
                        reversedGrossIncome: run.grossIncome.negated(), reversedDeductions: run.totalDeductions.negated(), reversedNetPay: run.netPay.negated(),
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
            const run = await tx.payrollRun.findFirst({ where: { id: runId, companyId, kind } });
            if (!run) throw new HrPayrollError('Corrida no encontrada', 404);
            if (run.status !== 'CALCULATED') throw new HrPayrollError('Los componentes manuales requieren snapshot CALCULATED y sólo se admiten antes de revisión', 409, 'HR_PAYROLL_RUN_IMMUTABLE');
            const userId = positiveId(payload.userId, 'userId');
            const user = await tx.user.findFirst({ where: { id: userId, companyId, accountType: 'INTERNAL', employee: { isNot: null } } });
            if (!user) throw new HrPayrollError('El usuario interno no pertenece a la empresa', 404);
            if (!await tx.payrollSnapshotLine.findFirst({ where: { companyId, runId, userId }, select: { id: true } })) throw new HrPayrollError('El sujeto no pertenece al snapshot congelado', 409, 'HR_PAYROLL_COMPONENT_SUBJECT_INVALID');
            const amount = nonNegativeMoney(payload.inputAmount, 'inputAmount');
            const component = await tx.payrollComponent.create({ data: {
                companyId, runId, userId, code: requiredText(payload.code, 'code', 64), name: requiredText(payload.code, 'code', 64),
                type: payload.type === 'DEDUCTION' ? 'DEDUCTION' : payload.type === 'INCOME' ? 'INCOME' : (() => { throw new HrPayrollError('type no es válido'); })(),
                source: 'MANUAL', amount, reason: requiredText(payload.reason, 'reason'), traceReference: optionalText(payload.reference, 500), createdById: actorId,
            } });
            let revision = run.revision;
            if (run.status === 'CALCULATED') {
                const aggregate = await tx.payrollComponent.groupBy({ by: ['type'], where: { runId, companyId }, _sum: { amount: true } });
                const gross = money(aggregate.find(item => item.type === 'INCOME')?._sum.amount ?? 0);
                const deductions = money(aggregate.find(item => item.type === 'DEDUCTION')?._sum.amount ?? 0);
                const net = money(gross.minus(deductions));
                if (net.isNegative()) await addAnomaly(tx, { companyId, runId, userId, code: 'NEGATIVE_NET_PAY', message: 'El componente deja un neto negativo; ajuste y recalcule' });
                revision += 1;
                const updated = await tx.payrollRun.updateMany({ where: { id: runId, companyId, revision: run.revision, status: 'CALCULATED' }, data: {
                    grossIncome: gross, totalDeductions: deductions, netPay: net, revision,
                } });
                if (updated.count !== 1) throw new HrPayrollError('La corrida cambió concurrentemente', 409, 'HR_PAYROLL_REVISION_CONFLICT');
            }
            await trace(tx, { companyId, runId, event: 'ADD_MANUAL_COMPONENT', actorId, reason: component.reason!, revision, metadata: { componentId: component.id, userId, amount: amount.toFixed(2) } });
            return serialize(component);
        });
    }

    static async export(companyId: number, runId: number, kind: PayrollRunKind, format: 'csv' | 'xlsx'): Promise<{ contentType: string; filename: string; buffer: Buffer }> {
        const run = await loadRun(companyId, runId, kind);
        const snapshots = await prisma.payrollSnapshotLine.findMany({ where: { companyId, runId }, include: { user: { select: userSelect }, employee: { select: { employeeCode: true, legalName: true } } }, orderBy: { userId: 'asc' } });
        const components = await prisma.payrollComponent.findMany({ where: { companyId, runId } });
        const rows = snapshots.map(item => {
            const mine = components.filter(component => component.userId === item.userId);
            const grossIncome = money(mine.filter(component => component.type === 'INCOME').reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0)));
            const totalDeductions = money(mine.filter(component => component.type === 'DEDUCTION').reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0)));
            return {
                code: run.code, employeeCode: item.employee.employeeCode, legalName: item.employee.legalName, userId: item.userId,
                grossIncome: grossIncome.toFixed(2), totalDeductions: totalDeductions.toFixed(2), netPay: grossIncome.minus(totalDeductions).toFixed(2),
                currency: item.currency, status: run.status,
            };
        });
        if (format === 'csv') {
            const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
            const headers = ['code', 'employeeCode', 'legalName', 'userId', 'grossIncome', 'totalDeductions', 'netPay', 'currency', 'status'];
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
    run: { include: { trace: { include: { actor: { select: actorSelect } }, orderBy: { occurredAt: 'asc' } } } },
});
type ReceiptItem = Prisma.PayrollReceiptGetPayload<{ include: typeof receiptInclude }>;

async function receiptDetail(receipt: ReceiptItem, selfSafe = false) {
    return serialize({ ...receipt, components: receipt.components, trace: selfSafe ? [] : receipt.run.trace, run: undefined, user: receipt.user, employeeCode: receipt.employee.employeeCode, legalName: receipt.employee.legalName });
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
        const receipt = await this.get(companyId, receiptId, opts);
        const document = new jsPDF(); document.setFontSize(16); document.text('Recibo de nómina', 14, 18);
        document.setFontSize(10); const lines = [
            `Corrida: ${receipt.runCode}`, `Colaborador: ${receipt.legalName}`, `Código: ${receipt.employeeCode}`,
            `Período: ${receipt.periodLabel}`, `Fecha de pago: ${dateKey(new Date(receipt.payDate))}`,
            `Ingresos: ${receipt.currency} ${receipt.grossIncome}`, `Deducciones: ${receipt.currency} ${receipt.totalDeductions}`,
            `Neto: ${receipt.currency} ${receipt.netPay}`, `Estado: ${receipt.status}`,
        ]; lines.forEach((line, index) => document.text(line, 14, 30 + index * 7));
        document.text('Documento generado desde un snapshot inmutable y trazable.', 14, 100);
        return { contentType: 'application/pdf', filename: `recibo-${receipt.id}.pdf`, buffer: Buffer.from(document.output('arraybuffer')) };
    }
}
