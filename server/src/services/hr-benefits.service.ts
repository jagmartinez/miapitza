import { createHash, randomUUID } from 'node:crypto';
import {
    HrDeductionFrequency,
    HrDeductionStatus,
    HrLoanStatus,
    HrTravelStatus,
    Prisma,
} from '@prisma/client';
import prisma from '../utils/prisma';
import { AuditLogService } from './audit-log.service';

type Db = Prisma.TransactionClient | typeof prisma;
type JsonObject = Record<string, unknown>;
type InputMap = Record<string, unknown>;
type Scope = { companyId: number; actorId: number; selfUserId?: number };

export class HrBenefitsError extends Error {
    constructor(message: string, public readonly statusCode = 400, public readonly code = 'HR_BENEFITS_INVALID') {
        super(message);
    }
}

const actorSelect = { id: true, name: true, username: true } as const;
const userSelect = { id: true, name: true, username: true } as const;

function requiredText(value: unknown, field: string, max = 900): string {
    if (typeof value !== 'string' || !value.trim()) throw new HrBenefitsError(`${field} es requerido`);
    const normalized = value.trim();
    if (normalized.length > max) throw new HrBenefitsError(`${field} excede ${max} caracteres`);
    return normalized;
}

function optionalText(value: unknown, max = 900): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new HrBenefitsError('El valor debe ser texto');
    const normalized = value.trim();
    if (normalized.length > max) throw new HrBenefitsError(`El valor excede ${max} caracteres`);
    return normalized || null;
}

function positiveId(value: unknown, field: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new HrBenefitsError(`${field} debe ser un entero positivo`);
    return parsed;
}

function positiveInt(value: unknown, field: string, max = 9999): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) throw new HrBenefitsError(`${field} debe ser un entero entre 1 y ${max}`);
    return parsed;
}

function dateValue(value: unknown, field: string): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HrBenefitsError(`${field} debe usar YYYY-MM-DD`);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new HrBenefitsError(`${field} no es una fecha valida`);
    return parsed;
}

function optionalDate(value: unknown, field: string): Date | null {
    return value === undefined || value === null || value === '' ? null : dateValue(value, field);
}

function currency(value: unknown): string {
    const code = requiredText(value, 'currency', 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw new HrBenefitsError('currency debe ser un codigo ISO de tres letras');
    return code;
}

function money(value: unknown, field: string, allowZero = false): Prisma.Decimal {
    if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) throw new HrBenefitsError(`${field} debe ser un decimal positivo con maximo dos decimales`);
    const amount = new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (allowZero ? amount.isNegative() : amount.lessThanOrEqualTo(0)) throw new HrBenefitsError(`${field} debe ser mayor que cero`);
    return amount;
}

function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value as JsonObject).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
    return JSON.stringify(value);
}

function requestHash(value: unknown): string { return createHash('sha256').update(stable(value)).digest('hex'); }
function serialize<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function benefitCode(prefix: 'VIA' | 'PRE' | 'DED'): string { return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`; }

function paging(filters: InputMap) {
    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    return { page, pageSize, skip: (page - 1) * pageSize };
}

async function idempotent<T>(companyId: number, keyValue: string, operation: string, payload: unknown, execute: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const key = requiredText(keyValue, 'Idempotency-Key', 128);
    const hash = requestHash(payload);
    const replay = async (): Promise<T | null> => {
        const found = await prisma.hrBenefitIdempotencyRecord.findUnique({ where: { companyId_key: { companyId, key } } });
        if (!found) return null;
        if (found.operation !== operation || found.requestHash !== hash) throw new HrBenefitsError('Idempotency-Key ya fue usado con otra operacion o payload', 409, 'IDEMPOTENCY_CONFLICT');
        if (found.response === null) throw new HrBenefitsError('La operacion idempotente esta en proceso; reintente', 409, 'IDEMPOTENCY_IN_PROGRESS');
        return found.response as T;
    };
    const existing = await replay();
    if (existing !== null) return existing;
    try {
        return await prisma.$transaction(async tx => {
            const record = await tx.hrBenefitIdempotencyRecord.create({ data: { companyId, key, operation, requestHash: hash } });
            const result = await execute(tx);
            const response = serialize(result) as Prisma.InputJsonValue;
            await tx.hrBenefitIdempotencyRecord.update({ where: { id: record.id }, data: { response } });
            return result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const replayed = await replay();
            if (replayed !== null) return replayed;
        }
        throw error;
    }
}

async function ensureInternalUser(companyId: number, userId: number, db: Db = prisma) {
    const user = await db.user.findFirst({
        where: { id: userId, companyId, status: 'ACTIVE', accountType: 'INTERNAL', employee: { is: { status: { in: ['ACTIVE', 'ON_LEAVE'] } } } },
        select: { id: true, name: true, username: true, employee: { select: { id: true, status: true } } },
    });
    if (!user?.employee) throw new HrBenefitsError('La persona debe ser un usuario INTERNAL ligado a un empleado activo', 404, 'HR_BENEFITS_INTERNAL_EMPLOYEE_REQUIRED');
    return { ...user, employeeId: user.employee.id };
}

export async function assertBenefitsSelf(companyId: number, userId: number): Promise<void> {
    await ensureInternalUser(companyId, userId);
}

async function ensureBranch(companyId: number, branchId: number | null, db: Db = prisma) {
    if (!branchId) return null;
    const branch = await db.branch.findFirst({ where: { id: branchId, companyId, status: 'ACTIVE' }, select: { id: true, name: true } });
    if (!branch) throw new HrBenefitsError('La sucursal no pertenece a la empresa o esta inactiva', 404, 'HR_BENEFITS_BRANCH_NOT_FOUND');
    return branch;
}

async function trace(db: Db, input: { companyId: number; resourceType: 'TRAVEL' | 'LOAN' | 'DEDUCTION'; resourceId: number; event: string; actorId?: number | null; reason?: string | null; fromStatus?: string | null; toStatus?: string | null; revision: number; metadata?: Prisma.InputJsonValue }) {
    await db.hrBenefitTrace.create({ data: input });
}

function transitionInput(payload: InputMap) {
    const expectedRevision = Number(payload.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HrBenefitsError('expectedRevision es requerido', 409, 'HR_BENEFITS_REVISION_REQUIRED');
    if (payload.confirmed !== true) throw new HrBenefitsError('Debe confirmar la transicion');
    return {
        expectedRevision,
        reason: requiredText(payload.reason, 'reason'),
        effectiveDate: payload.effectiveDate ? dateValue(payload.effectiveDate, 'effectiveDate') : new Date(),
        reference: optionalText(payload.reference, 160),
    };
}

async function casTravel(tx: Prisma.TransactionClient, id: number, companyId: number, revision: number, data: Prisma.HrTravelRequestUncheckedUpdateManyInput) {
    const result = await tx.hrTravelRequest.updateMany({ where: { id, companyId, revision }, data: { ...data, revision: { increment: 1 } } });
    if (result.count !== 1) throw new HrBenefitsError('El viatico cambio concurrentemente; recargue el detalle', 409, 'HR_BENEFITS_REVISION_CONFLICT');
}

async function casLoan(tx: Prisma.TransactionClient, id: number, companyId: number, revision: number, data: Prisma.HrLoanUncheckedUpdateManyInput) {
    const result = await tx.hrLoan.updateMany({ where: { id, companyId, revision }, data: { ...data, revision: { increment: 1 } } });
    if (result.count !== 1) throw new HrBenefitsError('El prestamo cambio concurrentemente; recargue el detalle', 409, 'HR_BENEFITS_REVISION_CONFLICT');
}

async function casDeduction(tx: Prisma.TransactionClient, id: number, companyId: number, revision: number, data: Prisma.HrDeductionUncheckedUpdateManyInput) {
    const result = await tx.hrDeduction.updateMany({ where: { id, companyId, revision }, data: { ...data, revision: { increment: 1 } } });
    if (result.count !== 1) throw new HrBenefitsError('La deduccion cambio concurrentemente; recargue el detalle', 409, 'HR_BENEFITS_REVISION_CONFLICT');
}

export function allowedTravelActions(status: HrTravelStatus): string[] {
    if (status === 'DRAFT') return ['SUBMIT', 'CANCEL'];
    if (status === 'SUBMITTED') return ['APPROVE', 'REJECT', 'CANCEL'];
    if (status === 'APPROVED') return ['REGISTER_ADVANCE', 'CANCEL'];
    if (status === 'ADVANCED') return ['START_SETTLEMENT', 'REVERSE'];
    if (status === 'IN_SETTLEMENT') return ['SETTLE', 'REVERSE'];
    if (status === 'SETTLED') return ['REVERSE'];
    return [];
}

export function allowedLoanActions(status: HrLoanStatus): string[] {
    if (status === 'REQUESTED') return ['APPROVE', 'REJECT', 'CANCEL'];
    if (status === 'APPROVED') return ['DISBURSE', 'CANCEL'];
    if (status === 'DISBURSED' || status === 'ACTIVE') return ['REGISTER_PAYMENT', 'REVERSE'];
    if (status === 'PAID') return ['CLOSE', 'REVERSE'];
    if (status === 'CLOSED') return ['REVERSE'];
    return [];
}

export function allowedDeductionActions(status: HrDeductionStatus): string[] {
    if (status === 'DRAFT') return ['ACTIVATE', 'CANCEL'];
    if (status === 'ACTIVE') return ['PAUSE', 'CANCEL', 'REVERSE'];
    if (status === 'PAUSED') return ['RESUME', 'CANCEL', 'REVERSE'];
    if (status === 'COMPLETED') return ['REVERSE'];
    return [];
}

export function reconcileTravelAmounts(advanceValue: Prisma.Decimal.Value, expenseValues: Prisma.Decimal.Value[]) {
    const advance = new Prisma.Decimal(advanceValue);
    const recognized = expenseValues.reduce<Prisma.Decimal>((sum, value) => sum.plus(value), new Prisma.Decimal(0));
    return {
        recognized,
        employeeReturn: Prisma.Decimal.max(0, advance.minus(recognized)),
        employeeReimbursement: Prisma.Decimal.max(0, recognized.minus(advance)),
    };
}

const travelInclude = Prisma.validator<Prisma.HrTravelRequestInclude>()({ user: { select: userSelect }, branch: { select: { id: true, name: true } }, expenses: { orderBy: [{ occurredOn: 'asc' }, { id: 'asc' }] }, ledger: { include: { reversalEntries: { select: { id: true } } }, orderBy: { id: 'asc' } } });
const loanInclude = Prisma.validator<Prisma.HrLoanInclude>()({ user: { select: userSelect }, scheduleVersions: { include: { installments: { orderBy: { number: 'asc' } } }, orderBy: { version: 'desc' } }, ledger: { include: { actor: { select: actorSelect }, reversalEntries: { select: { id: true } } }, orderBy: { id: 'asc' } } });
const deductionInclude = Prisma.validator<Prisma.HrDeductionInclude>()({ user: { select: userSelect }, versions: { orderBy: { version: 'desc' }, take: 1 } });
type TravelItem = Prisma.HrTravelRequestGetPayload<{ include: typeof travelInclude }>;
type LoanItem = Prisma.HrLoanGetPayload<{ include: typeof loanInclude }>;
type DeductionItem = Prisma.HrDeductionGetPayload<{ include: typeof deductionInclude }>;

async function presentTravel(item: TravelItem, db: Db = prisma, detail = false, self = false) {
    const actions = allowedTravelActions(item.status);
    const traceRows = detail
        ? await db.hrBenefitTrace.findMany({ where: { companyId: item.companyId, resourceType: 'TRAVEL', resourceId: item.id }, include: { actor: { select: actorSelect } }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] })
        : undefined;
    const result = {
        ...item,
        allowedActions: self ? actions.filter(action => ['SUBMIT', 'START_SETTLEMENT', 'CANCEL'].includes(action)) : actions,
        ...(traceRows ? { trace: traceRows } : {}),
    };
    return serialize(result);
}

async function presentLoan(item: LoanItem, db: Db = prisma, detail = false, self = false) {
    let schedule: Array<Record<string, unknown>> | undefined;
    let traceRows;
    if (detail) {
        const scheduleVersion = item.scheduleVersions.find(version => version.status === 'ACTIVE') ?? item.scheduleVersions[0];
        const payments = item.ledger.filter(entry => ['PAYMENT', 'PAYROLL_DEDUCTION'].includes(entry.type) && !entry.reversalEntries.length);
        let paid = payments.reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
        schedule = (scheduleVersion?.installments ?? []).map(installment => {
            const applied = Prisma.Decimal.min(paid, installment.scheduledTotal);
            paid = Prisma.Decimal.max(0, paid.minus(applied));
            const outstanding = installment.scheduledTotal.minus(applied);
            return serialize({ ...installment, paidAmount: applied, outstandingAmount: outstanding, status: outstanding.isZero() ? 'PAID' : applied.greaterThan(0) ? 'PARTIAL' : new Date(installment.dueDate) < new Date() ? 'OVERDUE' : 'PENDING' });
        });
        traceRows = await db.hrBenefitTrace.findMany({ where: { companyId: item.companyId, resourceType: 'LOAN', resourceId: item.id }, include: { actor: { select: actorSelect } }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
    }
    const result = {
        ...item,
        allowedActions: self ? [] : allowedLoanActions(item.status),
        ...(detail ? { scheduleVersions: undefined, schedule, trace: traceRows } : {}),
    };
    return serialize(result);
}

async function presentDeduction(item: DeductionItem, db: Db = prisma, detail = false, self = false) {
    const version = item.versions[0];
    const traceRows = detail
        ? await db.hrBenefitTrace.findMany({ where: { companyId: item.companyId, resourceType: 'DEDUCTION', resourceId: item.id }, include: { actor: { select: actorSelect } }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] })
        : undefined;
    const result = {
        ...item, ...version, id: item.id, versionId: version?.id, source: item.source,
        allowedActions: self ? [] : allowedDeductionActions(item.status), versions: undefined,
        ...(traceRows ? { trace: traceRows } : {}),
    };
    return serialize(result);
}

function scopedUser(scope: Scope, requested: unknown): number { return scope.selfUserId ?? positiveId(requested, 'userId'); }

function enumFilter<T extends string>(value: unknown, allowed: readonly T[], field = 'status'): T | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || !allowed.includes(value as T)) throw new HrBenefitsError(`${field} no es valido`);
    return value as T;
}

function filterDates(filters: InputMap, field: string, timestamp = false) {
    const from = filters.dateFrom ? dateValue(filters.dateFrom, 'dateFrom') : undefined;
    const to = filters.dateTo ? dateValue(filters.dateTo, 'dateTo') : undefined;
    if (from && to && from > to) throw new HrBenefitsError('dateFrom no puede ser posterior a dateTo');
    const exclusiveTo = to && timestamp ? new Date(to.getTime() + 86_400_000) : undefined;
    return from || to ? { [field]: { gte: from, ...(exclusiveTo ? { lt: exclusiveTo } : { lte: to }) } } : {};
}

export class HrTravelService {
    static async list(scope: Scope, filters: InputMap) {
        const p = paging(filters);
        const where: Prisma.HrTravelRequestWhereInput = { companyId: scope.companyId, userId: scope.selfUserId ?? (filters.userId ? Number(filters.userId) : undefined), user: scope.selfUserId ? { accountType: 'INTERNAL', status: 'ACTIVE', employee: { is: { status: { in: ['ACTIVE', 'ON_LEAVE'] } } } } : undefined, branchId: filters.branchId ? Number(filters.branchId) : undefined, status: enumFilter(filters.status, ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ADVANCED', 'IN_SETTLEMENT', 'SETTLED', 'CANCELLED', 'REVERSED'] as const), ...filterDates(filters, 'departureDate') };
        const [items, total] = await Promise.all([prisma.hrTravelRequest.findMany({ where, include: travelInclude, orderBy: { updatedAt: 'desc' }, skip: p.skip, take: p.pageSize }), prisma.hrTravelRequest.count({ where })]);
        return { items: await Promise.all(items.map(item => presentTravel(item, prisma, false, Boolean(scope.selfUserId)))), pagination: { page: p.page, pageSize: p.pageSize, total, totalPages: Math.ceil(total / p.pageSize) } };
    }

    static async get(scope: Scope, id: number) {
        const item = await prisma.hrTravelRequest.findFirst({ where: { id, companyId: scope.companyId, userId: scope.selfUserId, user: scope.selfUserId ? { accountType: 'INTERNAL', status: 'ACTIVE', employee: { is: { status: { in: ['ACTIVE', 'ON_LEAVE'] } } } } : undefined }, include: travelInclude });
        if (!item) throw new HrBenefitsError('Viatico no encontrado', 404, 'HR_TRAVEL_NOT_FOUND');
        return presentTravel(item, prisma, true, Boolean(scope.selfUserId));
    }

    static async create(scope: Scope, payload: InputMap, key: string) {
        return idempotent(scope.companyId, key, `TRAVEL_CREATE:${scope.selfUserId ?? 'OWNER'}`, { actorId: scope.actorId, payload }, async tx => {
            const user = await ensureInternalUser(scope.companyId, scopedUser(scope, payload.userId), tx);
            const branchId = payload.branchId ? positiveId(payload.branchId, 'branchId') : null;
            await ensureBranch(scope.companyId, branchId, tx);
            const departureDate = dateValue(payload.departureDate, 'departureDate');
            const returnDate = dateValue(payload.returnDate, 'returnDate');
            if (returnDate < departureDate) throw new HrBenefitsError('returnDate no puede ser anterior a departureDate');
            const item = await tx.hrTravelRequest.create({ data: { companyId: scope.companyId, code: benefitCode('VIA'), userId: user.id, employeeId: user.employeeId, branchId, destination: requiredText(payload.destination, 'destination', 160), purpose: requiredText(payload.purpose, 'purpose'), departureDate, returnDate, currency: currency(payload.currency), requestedAmount: money(payload.requestedAmount, 'requestedAmount'), createdById: scope.actorId }, include: travelInclude });
            await trace(tx, { companyId: scope.companyId, resourceType: 'TRAVEL', resourceId: item.id, event: 'CREATE_DRAFT', actorId: scope.actorId, toStatus: 'DRAFT', revision: 0 });
            await AuditLogService.log({ companyId: scope.companyId, userId: scope.actorId, entityType: 'HrTravelRequest', entityId: item.id, action: 'CREATE', details: { code: item.code, subjectUserId: item.userId } }, tx);
            return presentTravel(item, tx, true, Boolean(scope.selfUserId));
        });
    }

    static async update(scope: Scope, id: number, payload: InputMap, key: string) {
        if (scope.selfUserId) throw new HrBenefitsError('El autoservicio no permite editar borradores por esta ruta', 403);
        return idempotent(scope.companyId, key, `TRAVEL_UPDATE:${id}`, { actorId: scope.actorId, payload }, async tx => {
            const item = await tx.hrTravelRequest.findFirst({ where: { id, companyId: scope.companyId } });
            if (!item) throw new HrBenefitsError('Viatico no encontrado', 404);
            if (item.status !== 'DRAFT') throw new HrBenefitsError('Solo un viatico DRAFT puede editarse', 409);
            const expectedRevision = Number(payload.expectedRevision);
            if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HrBenefitsError('expectedRevision es requerido');
            const user = await ensureInternalUser(scope.companyId, payload.userId ? positiveId(payload.userId, 'userId') : item.userId, tx);
            const branchId = payload.branchId ? positiveId(payload.branchId, 'branchId') : null;
            await ensureBranch(scope.companyId, branchId, tx);
            const departureDate = dateValue(payload.departureDate, 'departureDate'); const returnDate = dateValue(payload.returnDate, 'returnDate');
            if (returnDate < departureDate) throw new HrBenefitsError('returnDate no puede ser anterior a departureDate');
            await casTravel(tx, id, scope.companyId, expectedRevision, { userId: user.id, employeeId: user.employeeId, branchId, destination: requiredText(payload.destination, 'destination', 160), purpose: requiredText(payload.purpose, 'purpose'), departureDate, returnDate, currency: currency(payload.currency), requestedAmount: money(payload.requestedAmount, 'requestedAmount') });
            await trace(tx, { companyId: scope.companyId, resourceType: 'TRAVEL', resourceId: id, event: 'UPDATE_DRAFT', actorId: scope.actorId, revision: expectedRevision + 1 });
            const loaded = await tx.hrTravelRequest.findUniqueOrThrow({ where: { id }, include: travelInclude });
            return presentTravel(loaded, tx, true, Boolean(scope.selfUserId));
        });
    }

    static async addExpense(scope: Scope, id: number, payload: InputMap, key: string) {
        return idempotent(scope.companyId, key, `TRAVEL_EXPENSE:${id}`, { actorId: scope.actorId, payload }, async tx => {
            const item = await tx.hrTravelRequest.findFirst({ where: { id, companyId: scope.companyId, userId: scope.selfUserId, user: scope.selfUserId ? { accountType: 'INTERNAL', status: 'ACTIVE', employee: { is: { status: { in: ['ACTIVE', 'ON_LEAVE'] } } } } : undefined } });
            if (!item) throw new HrBenefitsError('Viatico no encontrado', 404);
            if (!['ADVANCED', 'IN_SETTLEMENT'].includes(item.status)) throw new HrBenefitsError('Los gastos solo se registran durante la liquidacion', 409);
            if (payload.evidenceId !== undefined && payload.evidenceId !== null && payload.evidenceId !== '') {
                throw new HrBenefitsError('No existe todavia un repositorio seguro de evidencias de viaticos verificable; evidenceId se rechaza de forma cerrada', 409, 'HR_BENEFITS_EVIDENCE_REPOSITORY_REQUIRED');
            }
            const occurredOn = dateValue(payload.occurredOn, 'occurredOn');
            if (occurredOn < item.departureDate || occurredOn > item.returnDate) throw new HrBenefitsError('occurredOn debe estar dentro de las fechas del viaje');
            const expenseCurrency = currency(payload.currency);
            if (expenseCurrency !== item.currency) throw new HrBenefitsError('La moneda del gasto debe coincidir con la del viatico');
            const claimed = await tx.hrTravelRequest.updateMany({
                where: {
                    id,
                    companyId: scope.companyId,
                    revision: item.revision,
                    status: { in: ['ADVANCED', 'IN_SETTLEMENT'] },
                },
                data: { revision: { increment: 1 } },
            });
            if (claimed.count !== 1) {
                throw new HrBenefitsError(
                    'El viatico cambio concurrentemente; recargue el detalle',
                    409,
                    'HR_BENEFITS_REVISION_CONFLICT',
                );
            }
            const expense = await tx.hrTravelExpense.create({ data: { companyId: scope.companyId, travelRequestId: id, category: requiredText(payload.category, 'category', 64), description: requiredText(payload.description, 'description', 600), occurredOn, currency: expenseCurrency, claimedAmount: money(payload.claimedAmount, 'claimedAmount'), receiptReference: optionalText(payload.receiptReference, 160), createdById: scope.actorId } });
            await trace(tx, { companyId: scope.companyId, resourceType: 'TRAVEL', resourceId: id, event: 'ADD_EXPENSE', actorId: scope.actorId, reason: expense.description, revision: item.revision + 1, metadata: { expenseId: expense.id, amount: expense.claimedAmount.toFixed(2) } });
            return serialize(expense);
        });
    }

    static async transition(scope: Scope, id: number, action: string, payload: InputMap, key: string) {
        return idempotent(scope.companyId, key, `TRAVEL_${action}:${id}`, { actorId: scope.actorId, payload }, async tx => {
            const item = await tx.hrTravelRequest.findFirst({ where: { id, companyId: scope.companyId, userId: scope.selfUserId, user: scope.selfUserId ? { accountType: 'INTERNAL', status: 'ACTIVE', employee: { is: { status: { in: ['ACTIVE', 'ON_LEAVE'] } } } } : undefined }, include: { ledger: { include: { reversalEntries: true } }, expenses: true } });
            if (!item) throw new HrBenefitsError('Viatico no encontrado', 404);
            const input = transitionInput(payload);
            if (item.revision !== input.expectedRevision) throw new HrBenefitsError('El viatico cambio concurrentemente', 409, 'HR_BENEFITS_REVISION_CONFLICT');
            if (action === 'reverse' && !input.reference) throw new HrBenefitsError('reference es requerida para revertir el viatico');
            if (scope.selfUserId && !['submit', 'start-settlement', 'cancel'].includes(action)) throw new HrBenefitsError('Accion no disponible en autoservicio', 403);
            let next: HrTravelStatus; const data: Prisma.HrTravelRequestUpdateManyMutationInput = {};
            if (action === 'submit' && item.status === 'DRAFT') next = 'SUBMITTED';
            else if (action === 'approve' && item.status === 'SUBMITTED') {
                if (item.createdById === scope.actorId) throw new HrBenefitsError('Segregacion de funciones: quien creo la solicitud no puede aprobarla', 409, 'HR_BENEFITS_DUTY_SEGREGATION');
                const approvedAmount = money(payload.approvedAmount, 'approvedAmount');
                data.approvedAmount = approvedAmount; next = 'APPROVED';
            } else if (action === 'reject' && item.status === 'SUBMITTED') next = 'REJECTED';
            else if (action === 'advance' && item.status === 'APPROVED') {
                const approval = await tx.hrBenefitTrace.findFirst({ where: { companyId: scope.companyId, resourceType: 'TRAVEL', resourceId: id, event: 'APPROVE' }, orderBy: { id: 'desc' } });
                if (approval?.actorId === scope.actorId) throw new HrBenefitsError('Segregacion de funciones: quien aprobo no puede registrar el anticipo', 409, 'HR_BENEFITS_DUTY_SEGREGATION');
                const reference = requiredText(payload.advanceReference, 'advanceReference', 160);
                await tx.hrTravelLedgerEntry.create({ data: { companyId: scope.companyId, travelRequestId: id, type: 'ADVANCE', amount: item.approvedAmount!, currency: item.currency, effectiveDate: input.effectiveDate, reference, reason: input.reason, actorId: scope.actorId } });
                data.advanceAmount = item.approvedAmount; next = 'ADVANCED';
            } else if (action === 'start-settlement' && item.status === 'ADVANCED') next = 'IN_SETTLEMENT';
            else if (action === 'settle' && item.status === 'IN_SETTLEMENT') {
                const advanceTrace = await tx.hrBenefitTrace.findFirst({ where: { companyId: scope.companyId, resourceType: 'TRAVEL', resourceId: id, event: 'ADVANCE' }, orderBy: { id: 'desc' } });
                if (advanceTrace?.actorId === scope.actorId) throw new HrBenefitsError('Segregacion de funciones: quien registro el anticipo no puede cerrar la liquidacion', 409, 'HR_BENEFITS_DUTY_SEGREGATION');
                const reference = requiredText(payload.settlementReference ?? input.reference, 'settlementReference', 160);
                const pendingExpenses = item.expenses.filter(expense => expense.status === 'PENDING');
                if (pendingExpenses.some(expense => expense.evidenceId === null)) {
                    throw new HrBenefitsError(
                        'La liquidacion no puede aceptar gastos sin evidencia verificada por un repositorio seguro',
                        409,
                        'HR_BENEFITS_EVIDENCE_REPOSITORY_REQUIRED',
                    );
                }
                const reconciliation = reconcileTravelAmounts(item.advanceAmount ?? 0, pendingExpenses.map(expense => expense.claimedAmount));
                const total = reconciliation.recognized;
                for (const expense of pendingExpenses) await tx.hrTravelExpense.update({ where: { id: expense.id }, data: { status: 'ACCEPTED', recognizedAmount: expense.claimedAmount } });
                const employeeReturn = reconciliation.employeeReturn; const reimbursement = reconciliation.employeeReimbursement;
                if (total.greaterThan(0)) await tx.hrTravelLedgerEntry.create({ data: { companyId: scope.companyId, travelRequestId: id, type: 'EXPENSE_RECOGNITION', amount: total, currency: item.currency, effectiveDate: input.effectiveDate, reference, reason: input.reason, actorId: scope.actorId } });
                if (employeeReturn.greaterThan(0)) await tx.hrTravelLedgerEntry.create({ data: { companyId: scope.companyId, travelRequestId: id, type: 'EMPLOYEE_RETURN', amount: employeeReturn, currency: item.currency, effectiveDate: input.effectiveDate, reference, reason: input.reason, actorId: scope.actorId } });
                if (reimbursement.greaterThan(0)) await tx.hrTravelLedgerEntry.create({ data: { companyId: scope.companyId, travelRequestId: id, type: 'EMPLOYEE_REIMBURSEMENT', amount: reimbursement, currency: item.currency, effectiveDate: input.effectiveDate, reference, reason: input.reason, actorId: scope.actorId } });
                Object.assign(data, { recognizedExpenseAmount: total, employeeReturnAmount: employeeReturn, employeeReimbursementAmount: reimbursement }); next = 'SETTLED';
            } else if (action === 'cancel' && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(item.status)) next = 'CANCELLED';
            else if (action === 'reverse' && ['ADVANCED', 'IN_SETTLEMENT', 'SETTLED'].includes(item.status)) {
                const active = item.ledger.filter(entry => entry.type !== 'REVERSAL' && entry.reversalEntries.length === 0);
                for (const entry of active) await tx.hrTravelLedgerEntry.create({ data: { companyId: scope.companyId, travelRequestId: id, type: 'REVERSAL', amount: entry.amount.negated(), currency: entry.currency, effectiveDate: input.effectiveDate, reference: `${input.reference ?? 'REV'}-${entry.id}`.slice(0, 160), reason: input.reason, actorId: scope.actorId, reversedEntryId: entry.id } });
                await tx.hrTravelExpense.updateMany({ where: { companyId: scope.companyId, travelRequestId: id, status: { in: ['PENDING', 'ACCEPTED'] } }, data: { status: 'REVERSED' } }); next = 'REVERSED';
            } else throw new HrBenefitsError(`La transicion ${action} no corresponde al estado ${item.status}`, 409);
            data.status = next;
            await casTravel(tx, id, scope.companyId, input.expectedRevision, data);
            await trace(tx, { companyId: scope.companyId, resourceType: 'TRAVEL', resourceId: id, event: action.toUpperCase().replace('-', '_'), actorId: scope.actorId, reason: input.reason, fromStatus: item.status, toStatus: next, revision: item.revision + 1 });
            const loaded = await tx.hrTravelRequest.findUniqueOrThrow({ where: { id }, include: travelInclude });
            return presentTravel(loaded, tx, true, Boolean(scope.selfUserId));
        });
    }
}

export function addBenefitMonths(date: Date, offset: number): Date {
    const year = date.getUTCFullYear(); const month = date.getUTCMonth() + offset; const day = date.getUTCDate();
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(day, last)));
}

export function buildPrincipalOnlySchedule(amountValue: Prisma.Decimal.Value, count: number, firstDueDate: Date) {
    const amount = new Prisma.Decimal(amountValue).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (!Number.isInteger(count) || count <= 0 || amount.lessThanOrEqualTo(0)) throw new HrBenefitsError('Los parametros del calendario no son validos');
    const base = amount.dividedBy(count).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN); let allocated = new Prisma.Decimal(0);
    return Array.from({ length: count }, (_, index) => {
        const principal = index === count - 1 ? amount.minus(allocated) : base; allocated = allocated.plus(principal);
        return { number: index + 1, dueDate: addBenefitMonths(firstDueDate, index), scheduledPrincipal: principal, scheduledCharge: new Prisma.Decimal(0), scheduledTotal: principal };
    });
}

async function createPrincipalSchedule(tx: Prisma.TransactionClient, companyId: number, loanId: number, amount: Prisma.Decimal, count: number, firstDueDate: Date) {
    const version = await tx.hrLoanScheduleVersion.create({ data: { companyId, loanId, version: 1, principalOnly: true } });
    for (const installment of buildPrincipalOnlySchedule(amount, count, firstDueDate)) await tx.hrLoanInstallment.create({ data: { companyId, scheduleVersionId: version.id, ...installment } });
    return version;
}

export class HrLoanService {
    static async list(scope: Scope, filters: InputMap) {
        const p = paging(filters); const where: Prisma.HrLoanWhereInput = { companyId: scope.companyId, userId: scope.selfUserId ?? (filters.userId ? Number(filters.userId) : undefined), user: scope.selfUserId ? { accountType: 'INTERNAL', status: 'ACTIVE', employee: { is: { status: { in: ['ACTIVE', 'ON_LEAVE'] } } } } : undefined, status: enumFilter(filters.status, ['REQUESTED', 'APPROVED', 'REJECTED', 'DISBURSED', 'ACTIVE', 'PAID', 'CLOSED', 'CANCELLED', 'REVERSED'] as const), ...filterDates(filters, 'requestedAt', true) };
        const [items, total] = await Promise.all([prisma.hrLoan.findMany({ where, include: loanInclude, orderBy: { updatedAt: 'desc' }, skip: p.skip, take: p.pageSize }), prisma.hrLoan.count({ where })]);
        return { items: await Promise.all(items.map(item => presentLoan(item, prisma, false, Boolean(scope.selfUserId)))), pagination: { page: p.page, pageSize: p.pageSize, total, totalPages: Math.ceil(total / p.pageSize) } };
    }

    static async get(scope: Scope, id: number) {
        const item = await prisma.hrLoan.findFirst({ where: { id, companyId: scope.companyId, userId: scope.selfUserId, user: scope.selfUserId ? { accountType: 'INTERNAL', status: 'ACTIVE', employee: { is: { status: { in: ['ACTIVE', 'ON_LEAVE'] } } } } : undefined }, include: loanInclude });
        if (!item) throw new HrBenefitsError('Prestamo no encontrado', 404, 'HR_LOAN_NOT_FOUND');
        return presentLoan(item, prisma, true, Boolean(scope.selfUserId));
    }

    static async create(scope: Scope, payload: InputMap, key: string) {
        return idempotent(scope.companyId, key, `LOAN_CREATE:${scope.selfUserId ?? 'OWNER'}`, { actorId: scope.actorId, payload }, async tx => {
            const user = await ensureInternalUser(scope.companyId, scopedUser(scope, payload.userId), tx);
            const preferredInstallments = positiveInt(payload.preferredInstallments, 'preferredInstallments', 120);
            const item = await tx.hrLoan.create({ data: { companyId: scope.companyId, code: benefitCode('PRE'), userId: user.id, employeeId: user.employeeId, purpose: requiredText(payload.purpose, 'purpose'), currency: currency(payload.currency), requestedAmount: money(payload.requestedAmount, 'requestedAmount'), preferredInstallments, installmentCount: preferredInstallments, payrollDeductionRequested: payload.payrollDeductionRequested === true, firstPreferredDeductionDate: optionalDate(payload.firstPreferredDeductionDate, 'firstPreferredDeductionDate'), createdById: scope.actorId }, include: loanInclude });
            await trace(tx, { companyId: scope.companyId, resourceType: 'LOAN', resourceId: item.id, event: 'REQUEST', actorId: scope.actorId, toStatus: 'REQUESTED', revision: 0 });
            return presentLoan(item, tx, true, Boolean(scope.selfUserId));
        });
    }

    static async transition(scope: Scope, id: number, action: string, payload: InputMap, key: string) {
        if (scope.selfUserId) throw new HrBenefitsError('Las transiciones de prestamo requieren Owner', 403);
        return idempotent(scope.companyId, key, `LOAN_${action}:${id}`, { actorId: scope.actorId, payload }, async tx => {
            const item = await tx.hrLoan.findFirst({ where: { id, companyId: scope.companyId }, include: { ledger: { include: { reversalEntries: true } }, scheduleVersions: true, deduction: { include: { applications: { include: { reversals: true } } } } } });
            if (!item) throw new HrBenefitsError('Prestamo no encontrado', 404);
            const input = transitionInput(payload); if (item.revision !== input.expectedRevision) throw new HrBenefitsError('El prestamo cambio concurrentemente', 409, 'HR_BENEFITS_REVISION_CONFLICT');
            if (action === 'reverse' && !input.reference) throw new HrBenefitsError('reference es requerida para revertir el prestamo');
            let next: HrLoanStatus; const data: Prisma.HrLoanUpdateManyMutationInput = {};
            if (action === 'approve' && item.status === 'REQUESTED') {
                if (item.createdById === scope.actorId) throw new HrBenefitsError('Segregacion de funciones: quien creo la solicitud no puede aprobarla', 409, 'HR_BENEFITS_DUTY_SEGREGATION');
                const approvedAmount = money(payload.approvedAmount, 'approvedAmount'); const installmentCount = positiveInt(payload.installmentCount, 'installmentCount', 120); const firstDueDate = dateValue(payload.firstDueDate, 'firstDueDate');
                await createPrincipalSchedule(tx, scope.companyId, id, approvedAmount, installmentCount, firstDueDate);
                Object.assign(data, { approvedAmount, installmentCount, firstDueDate }); next = 'APPROVED';
            } else if (action === 'reject' && item.status === 'REQUESTED') next = 'REJECTED';
            else if (action === 'disburse' && item.status === 'APPROVED') {
                const approval = await tx.hrBenefitTrace.findFirst({ where: { companyId: scope.companyId, resourceType: 'LOAN', resourceId: id, event: 'APPROVE' }, orderBy: { id: 'desc' } });
                if (approval?.actorId === scope.actorId) throw new HrBenefitsError('Segregacion de funciones: quien aprobo no puede desembolsar', 409, 'HR_BENEFITS_DUTY_SEGREGATION');
                const reference = requiredText(payload.disbursementReference, 'disbursementReference', 160);
                await tx.hrLoanLedgerEntry.create({ data: { companyId: scope.companyId, loanId: id, type: 'DISBURSEMENT', amount: item.approvedAmount!, currency: item.currency, effectiveDate: input.effectiveDate, reference, reason: input.reason, actorId: scope.actorId } });
                Object.assign(data, { disbursedAmount: item.approvedAmount, outstandingBalance: item.approvedAmount }); next = 'DISBURSED';
                if (item.payrollDeductionRequested) {
                    const deduction = await tx.hrDeduction.create({ data: { companyId: scope.companyId, code: benefitCode('DED'), userId: item.userId, employeeId: item.employeeId, loanId: id, source: 'LOAN', status: 'ACTIVE', remainingAmount: item.approvedAmount, createdById: scope.actorId } });
                    const perPeriod = item.approvedAmount!.dividedBy(item.installmentCount).toDecimalPlaces(2, Prisma.Decimal.ROUND_UP);
                    await tx.hrDeductionVersion.create({ data: { companyId: scope.companyId, deductionId: deduction.id, version: 1, name: `Prestamo ${item.code}`, reason: `Deduccion vinculada al desembolso ${reference}`, currency: item.currency, frequency: 'ONCE', requestedAmount: item.approvedAmount!, applicableAmount: item.approvedAmount!, perPeriodLimit: perPeriod, priority: 100, effectiveFrom: item.firstDueDate! } });
                    await trace(tx, { companyId: scope.companyId, resourceType: 'DEDUCTION', resourceId: deduction.id, event: 'ACTIVATE_FROM_LOAN', actorId: scope.actorId, reason: input.reason, toStatus: 'ACTIVE', revision: 0, metadata: { loanId: id } });
                }
            } else if (action === 'payments' && ['DISBURSED', 'ACTIVE'].includes(item.status)) {
                const received = money(payload.receivedAmount, 'receivedAmount'); if (received.greaterThan(item.outstandingBalance)) throw new HrBenefitsError('El abono excede el saldo vigente');
                const reference = requiredText(payload.paymentReference, 'paymentReference', 160);
                await tx.hrLoanLedgerEntry.create({ data: { companyId: scope.companyId, loanId: id, type: 'PAYMENT', amount: received, currency: item.currency, effectiveDate: input.effectiveDate, reference, reason: input.reason, actorId: scope.actorId } });
                const balance = item.outstandingBalance.minus(received); data.outstandingBalance = balance; next = balance.isZero() ? 'PAID' : 'ACTIVE';
                if (item.deduction && received.greaterThan(0)) {
                    const remaining = Prisma.Decimal.max(0, (item.deduction.remainingAmount ?? new Prisma.Decimal(0)).minus(received));
                    await tx.hrDeduction.update({ where: { id: item.deduction.id }, data: { remainingAmount: remaining, status: remaining.isZero() ? 'COMPLETED' : undefined, revision: { increment: 1 } } });
                    await trace(tx, { companyId: scope.companyId, resourceType: 'DEDUCTION', resourceId: item.deduction.id, event: 'LOAN_PAYMENT_OFFSET', actorId: scope.actorId, reason: input.reason, revision: item.deduction.revision + 1, metadata: { loanId: id, amount: received.toFixed(2), remaining: remaining.toFixed(2) } });
                }
            } else if (action === 'close' && item.status === 'PAID') next = 'CLOSED';
            else if (action === 'cancel' && ['REQUESTED', 'APPROVED'].includes(item.status)) next = 'CANCELLED';
            else if (action === 'reverse' && ['DISBURSED', 'ACTIVE', 'PAID', 'CLOSED'].includes(item.status)) {
                const active = item.ledger.filter(entry => entry.type !== 'REVERSAL' && entry.reversalEntries.length === 0);
                for (const entry of active) await tx.hrLoanLedgerEntry.create({ data: { companyId: scope.companyId, loanId: id, type: 'REVERSAL', amount: entry.amount.negated(), currency: entry.currency, effectiveDate: input.effectiveDate, reference: `${input.reference ?? 'REV'}-${entry.id}`.slice(0, 160), reason: input.reason, actorId: scope.actorId, reversedEntryId: entry.id } });
                if (item.deduction) {
                    for (const application of item.deduction.applications.filter(value => value.kind === 'APPLIED' && value.reversals.length === 0)) await tx.hrDeductionApplication.create({ data: { companyId: scope.companyId, deductionId: item.deduction.id, versionId: application.versionId, payrollRunId: application.payrollRunId, kind: 'REVERSAL', amount: application.amount.negated(), currency: application.currency, reason: input.reason, actorId: scope.actorId, reversalOfId: application.id } });
                    await tx.hrDeduction.update({ where: { id: item.deduction.id }, data: { status: 'REVERSED', revision: { increment: 1 } } });
                }
                data.outstandingBalance = 0; next = 'REVERSED';
            } else throw new HrBenefitsError(`La transicion ${action} no corresponde al estado ${item.status}`, 409);
            data.status = next; await casLoan(tx, id, scope.companyId, input.expectedRevision, data);
            await trace(tx, { companyId: scope.companyId, resourceType: 'LOAN', resourceId: id, event: action.toUpperCase(), actorId: scope.actorId, reason: input.reason, fromStatus: item.status, toStatus: next, revision: item.revision + 1, metadata: action === 'approve' ? { schedule: 'PRINCIPAL_ONLY', charges: '0.00' } : undefined });
            const loaded = await tx.hrLoan.findUniqueOrThrow({ where: { id }, include: loanInclude }); return presentLoan(loaded, tx, true, Boolean(scope.selfUserId));
        });
    }
}

function deductionVersionData(payload: InputMap) {
    const requestedAmount = money(payload.requestedAmount, 'requestedAmount'); const perPeriodLimit = payload.perPeriodLimit ? money(payload.perPeriodLimit, 'perPeriodLimit') : null;
    const effectiveFrom = dateValue(payload.effectiveFrom, 'effectiveFrom'); const effectiveTo = optionalDate(payload.effectiveTo, 'effectiveTo');
    if (effectiveTo && effectiveTo < effectiveFrom) throw new HrBenefitsError('effectiveTo no puede ser anterior a effectiveFrom');
    const frequency = payload.frequency as HrDeductionFrequency; if (!['ONCE', 'RECURRING'].includes(frequency)) throw new HrBenefitsError('frequency no es valida');
    return { name: requiredText(payload.name, 'name', 120), reason: requiredText(payload.reason, 'reason'), currency: currency(payload.currency), frequency, requestedAmount, applicableAmount: Prisma.Decimal.min(requestedAmount, perPeriodLimit ?? requestedAmount), perPeriodLimit, priority: positiveInt(payload.priority, 'priority'), effectiveFrom, effectiveTo };
}

export class HrDeductionService {
    static async list(scope: Scope, filters: InputMap) {
        const p = paging(filters); const where: Prisma.HrDeductionWhereInput = { companyId: scope.companyId, userId: scope.selfUserId ?? (filters.userId ? Number(filters.userId) : undefined), user: scope.selfUserId ? { accountType: 'INTERNAL', status: 'ACTIVE', employee: { is: { status: { in: ['ACTIVE', 'ON_LEAVE'] } } } } : undefined, status: enumFilter(filters.status, ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'REVERSED'] as const), ...filterDates(filters, 'createdAt', true) };
        const [items, total] = await Promise.all([prisma.hrDeduction.findMany({ where, include: deductionInclude, orderBy: { updatedAt: 'desc' }, skip: p.skip, take: p.pageSize }), prisma.hrDeduction.count({ where })]);
        return { items: await Promise.all(items.map(item => presentDeduction(item, prisma, false, Boolean(scope.selfUserId)))), pagination: { page: p.page, pageSize: p.pageSize, total, totalPages: Math.ceil(total / p.pageSize) } };
    }

    static async get(scope: Scope, id: number) {
        const item = await prisma.hrDeduction.findFirst({ where: { id, companyId: scope.companyId, userId: scope.selfUserId, user: scope.selfUserId ? { accountType: 'INTERNAL', status: 'ACTIVE', employee: { is: { status: { in: ['ACTIVE', 'ON_LEAVE'] } } } } : undefined }, include: deductionInclude });
        if (!item) throw new HrBenefitsError('Deduccion no encontrada', 404, 'HR_DEDUCTION_NOT_FOUND');
        return presentDeduction(item, prisma, true, Boolean(scope.selfUserId));
    }

    static async create(scope: Scope, payload: InputMap, key: string) {
        if (scope.selfUserId) throw new HrBenefitsError('Las deducciones solo pueden ser creadas por Owner', 403);
        return idempotent(scope.companyId, key, 'DEDUCTION_CREATE', { actorId: scope.actorId, payload }, async tx => {
            const user = await ensureInternalUser(scope.companyId, positiveId(payload.userId, 'userId'), tx); const versionData = deductionVersionData(payload);
            const item = await tx.hrDeduction.create({ data: { companyId: scope.companyId, code: benefitCode('DED'), userId: user.id, employeeId: user.employeeId, remainingAmount: versionData.frequency === 'ONCE' ? versionData.requestedAmount : null, createdById: scope.actorId, versions: { create: { companyId: scope.companyId, version: 1, ...versionData } } }, include: deductionInclude });
            await trace(tx, { companyId: scope.companyId, resourceType: 'DEDUCTION', resourceId: item.id, event: 'CREATE_DRAFT', actorId: scope.actorId, reason: versionData.reason, toStatus: 'DRAFT', revision: 0 }); return presentDeduction(item, tx, true);
        });
    }

    static async update(scope: Scope, id: number, payload: InputMap, key: string) {
        return idempotent(scope.companyId, key, `DEDUCTION_UPDATE:${id}`, { actorId: scope.actorId, payload }, async tx => {
            const item = await tx.hrDeduction.findFirst({ where: { id, companyId: scope.companyId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } }); if (!item) throw new HrBenefitsError('Deduccion no encontrada', 404); if (item.status !== 'DRAFT') throw new HrBenefitsError('Solo una deduccion DRAFT puede editarse', 409);
            const expectedRevision = Number(payload.expectedRevision); if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HrBenefitsError('expectedRevision es requerido');
            const user = await ensureInternalUser(scope.companyId, positiveId(payload.userId, 'userId'), tx); const versionData = deductionVersionData(payload);
            await tx.hrDeductionVersion.create({ data: { companyId: scope.companyId, deductionId: id, version: (item.versions[0]?.version ?? 0) + 1, ...versionData } });
            await casDeduction(tx, id, scope.companyId, expectedRevision, { userId: user.id, employeeId: user.employeeId, remainingAmount: versionData.frequency === 'ONCE' ? versionData.requestedAmount : null });
            await trace(tx, { companyId: scope.companyId, resourceType: 'DEDUCTION', resourceId: id, event: 'NEW_VERSION', actorId: scope.actorId, reason: versionData.reason, revision: expectedRevision + 1 }); const loaded = await tx.hrDeduction.findUniqueOrThrow({ where: { id }, include: deductionInclude }); return presentDeduction(loaded, tx, true);
        });
    }

    static async transition(scope: Scope, id: number, action: string, payload: InputMap, key: string) {
        return idempotent(scope.companyId, key, `DEDUCTION_${action}:${id}`, { actorId: scope.actorId, payload }, async tx => {
            const item = await tx.hrDeduction.findFirst({ where: { id, companyId: scope.companyId }, include: { applications: { include: { reversals: true } } } }); if (!item) throw new HrBenefitsError('Deduccion no encontrada', 404); const input = transitionInput(payload); if (item.revision !== input.expectedRevision) throw new HrBenefitsError('La deduccion cambio concurrentemente', 409, 'HR_BENEFITS_REVISION_CONFLICT');
            if (action === 'reverse' && !input.reference) throw new HrBenefitsError('reference es requerida para revertir la deduccion');
            let next: HrDeductionStatus;
            if (action === 'activate' && item.status === 'DRAFT') { if (item.createdById === scope.actorId) throw new HrBenefitsError('Segregacion de funciones: quien creo la deduccion no puede activarla', 409, 'HR_BENEFITS_DUTY_SEGREGATION'); next = 'ACTIVE'; }
            else if (action === 'pause' && item.status === 'ACTIVE') next = 'PAUSED';
            else if (action === 'resume' && item.status === 'PAUSED') next = 'ACTIVE';
            else if (action === 'cancel' && ['DRAFT', 'ACTIVE', 'PAUSED'].includes(item.status)) {
                if (item.source === 'LOAN') throw new HrBenefitsError('Una deduccion de prestamo solo puede pausarse; su cancelacion se controla desde el prestamo', 409, 'HR_BENEFITS_LOAN_LIFECYCLE_REQUIRED');
                next = 'CANCELLED';
            }
            else if (action === 'reverse' && ['ACTIVE', 'PAUSED', 'COMPLETED'].includes(item.status)) {
                if (item.source === 'LOAN') throw new HrBenefitsError('Una deduccion de prestamo se revierte desde el prestamo para conservar ambos ledgers', 409, 'HR_BENEFITS_LOAN_REVERSAL_REQUIRED');
                for (const application of item.applications.filter(value => value.kind === 'APPLIED' && value.reversals.length === 0)) await tx.hrDeductionApplication.create({ data: { companyId: scope.companyId, deductionId: id, versionId: application.versionId, payrollRunId: application.payrollRunId, kind: 'REVERSAL', amount: application.amount.negated(), currency: application.currency, reason: input.reason, actorId: scope.actorId, reversalOfId: application.id } }); next = 'REVERSED';
            } else throw new HrBenefitsError(`La transicion ${action} no corresponde al estado ${item.status}`, 409);
            await casDeduction(tx, id, scope.companyId, input.expectedRevision, { status: next }); await trace(tx, { companyId: scope.companyId, resourceType: 'DEDUCTION', resourceId: id, event: action.toUpperCase(), actorId: scope.actorId, reason: input.reason, fromStatus: item.status, toStatus: next, revision: item.revision + 1 }); const loaded = await tx.hrDeduction.findUniqueOrThrow({ where: { id }, include: deductionInclude }); return presentDeduction(loaded, tx, true);
        });
    }
}

// Payroll integration. Components are projections; applications are committed only
// when the run is PAID. A changed revision makes payment fail and forces recalculation.
export async function projectBenefitDeductions(tx: Prisma.TransactionClient, input: { companyId: number; runId: number; userId: number; currency: string; cutoff: Date }) {
    const run = await tx.payrollRun.findFirst({ where: { id: input.runId, companyId: input.companyId }, select: { kind: true } });
    if (!run) throw new HrBenefitsError('Corrida de nomina no encontrada para proyectar deducciones', 404, 'HR_BENEFITS_PAYROLL_RUN_NOT_FOUND');
    if (run.kind !== 'REGULAR') return;
    const deductions = await tx.hrDeduction.findMany({ where: { companyId: input.companyId, userId: input.userId, status: 'ACTIVE', OR: [{ remainingAmount: null }, { remainingAmount: { gt: 0 } }] }, include: { versions: { where: { effectiveFrom: { lte: input.cutoff }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.cutoff } }] }, orderBy: { version: 'desc' }, take: 1 } }, orderBy: { createdAt: 'asc' } });
    const income = await tx.payrollComponent.aggregate({ where: { companyId: input.companyId, runId: input.runId, userId: input.userId, type: 'INCOME' }, _sum: { amount: true } });
    const existing = await tx.payrollComponent.aggregate({ where: { companyId: input.companyId, runId: input.runId, userId: input.userId, type: 'DEDUCTION' }, _sum: { amount: true } });
    let available = Prisma.Decimal.max(0, new Prisma.Decimal(income._sum.amount ?? 0).minus(existing._sum.amount ?? 0));
    for (const deduction of deductions.sort((a, b) => (a.versions[0]?.priority ?? 9999) - (b.versions[0]?.priority ?? 9999))) {
        const version = deduction.versions[0];
        if (!version) continue;
        if (version.currency !== input.currency) {
            const code = `BENEFIT_CURRENCY_MISMATCH_D${deduction.id}`;
            const message = `La deduccion ${deduction.code} (${deduction.id}) en ${version.currency} no puede proyectarse en nomina ${input.currency} sin una tasa FX legalmente validada`;
            const existingAnomaly = await tx.payrollAnomaly.findFirst({ where: {
                companyId: input.companyId, runId: input.runId, userId: input.userId, employeeId: deduction.employeeId,
                code, message, blocking: true, resolvedAt: null,
            }, select: { id: true } });
            if (!existingAnomaly) await tx.payrollAnomaly.create({ data: {
                companyId: input.companyId, runId: input.runId, userId: input.userId, employeeId: deduction.employeeId,
                code, severity: 'BLOCKING', blocking: true, message,
            } });
            continue;
        }
        if (available.isZero()) continue;
        const desired = Prisma.Decimal.min(version.applicableAmount, version.perPeriodLimit ?? version.applicableAmount, deduction.remainingAmount ?? version.applicableAmount);
        const amount = Prisma.Decimal.min(desired, available); if (amount.lessThanOrEqualTo(0)) continue;
        await tx.payrollComponent.create({ data: {
            companyId: input.companyId, runId: input.runId, userId: input.userId,
            code: `BENEFICIO_DED_${deduction.id}`, name: version.name, type: 'DEDUCTION', source: 'BENEFIT_DEDUCTION', amount,
            taxable: false, incomeTaxDeductible: false, socialSecurityApplicable: false, trainingContributionApplicable: false,
            reason: version.reason, traceReference: `deduction:${deduction.id};version:${version.id};revision:${deduction.revision}`,
        } });
        available = available.minus(amount);
    }
}

function parseDeductionTrace(value: string | null): { deductionId: number; versionId: number; revision: number } | null {
    const match = /^deduction:(\d+);version:(\d+);revision:(\d+)$/.exec(value ?? '');
    return match ? { deductionId: Number(match[1]), versionId: Number(match[2]), revision: Number(match[3]) } : null;
}

export async function commitBenefitDeductions(tx: Prisma.TransactionClient, input: { companyId: number; runId: number; actorId: number; effectiveDate: Date }) {
    const components = await tx.payrollComponent.findMany({ where: { companyId: input.companyId, runId: input.runId, source: 'BENEFIT_DEDUCTION' } });
    for (const component of components) {
        const source = parseDeductionTrace(component.traceReference); if (!source) throw new HrBenefitsError('Componente de deduccion sin traza valida', 409, 'HR_BENEFITS_PAYROLL_TRACE_INVALID');
        const deduction = await tx.hrDeduction.findFirst({ where: { id: source.deductionId, companyId: input.companyId }, include: { versions: { where: { id: source.versionId } }, loan: true } });
        if (!deduction || deduction.status !== 'ACTIVE' || deduction.revision !== source.revision || !deduction.versions[0]) throw new HrBenefitsError('Una deduccion cambio despues del calculo; recalcule la nomina', 409, 'HR_BENEFITS_PAYROLL_SOURCE_STALE');
        if (deduction.remainingAmount && component.amount.greaterThan(deduction.remainingAmount)) throw new HrBenefitsError('Saldo de deduccion insuficiente; recalcule la nomina', 409, 'HR_BENEFITS_PAYROLL_SOURCE_STALE');
        const application = await tx.hrDeductionApplication.create({ data: { companyId: input.companyId, deductionId: deduction.id, versionId: source.versionId, payrollRunId: input.runId, amount: component.amount, currency: deduction.versions[0].currency, componentId: component.id, reason: 'Aplicacion confirmada al marcar la nomina pagada', actorId: input.actorId } });
        const remaining = deduction.remainingAmount ? Prisma.Decimal.max(0, deduction.remainingAmount.minus(component.amount)) : null;
        await tx.hrDeduction.update({ where: { id: deduction.id }, data: { remainingAmount: remaining, lastPayrollApplicationId: String(application.id), status: remaining?.isZero() ? 'COMPLETED' : undefined, revision: { increment: 1 } } });
        await trace(tx, { companyId: input.companyId, resourceType: 'DEDUCTION', resourceId: deduction.id, event: 'PAYROLL_APPLICATION', actorId: input.actorId, reason: 'Aplicacion confirmada al marcar la nomina pagada', revision: deduction.revision + 1, metadata: { payrollRunId: input.runId, applicationId: application.id, componentId: component.id, amount: component.amount.toFixed(2) } });
        if (deduction.loanId) {
            const loan = await tx.hrLoan.findFirst({ where: { id: deduction.loanId, companyId: input.companyId } });
            if (!loan || component.amount.greaterThan(loan.outstandingBalance)) throw new HrBenefitsError('El saldo del prestamo no coincide con la deduccion; recalcule', 409, 'HR_BENEFITS_LOAN_BALANCE_STALE');
            const balance = loan.outstandingBalance.minus(component.amount);
            await tx.hrLoanLedgerEntry.create({ data: { companyId: input.companyId, loanId: loan.id, type: 'PAYROLL_DEDUCTION', amount: component.amount, currency: loan.currency, effectiveDate: input.effectiveDate, payrollRunId: input.runId, reference: `PAYROLL-${input.runId}`, reason: 'Deduccion aplicada por nomina pagada', actorId: input.actorId } });
            await tx.hrLoan.update({ where: { id: loan.id }, data: { outstandingBalance: balance, status: balance.isZero() ? 'PAID' : 'ACTIVE', revision: { increment: 1 } } });
            await trace(tx, { companyId: input.companyId, resourceType: 'LOAN', resourceId: loan.id, event: 'PAYROLL_DEDUCTION', actorId: input.actorId, reason: 'Deduccion aplicada por nomina pagada', fromStatus: loan.status, toStatus: balance.isZero() ? 'PAID' : 'ACTIVE', revision: loan.revision + 1, metadata: { payrollRunId: input.runId, amount: component.amount.toFixed(2), balance: balance.toFixed(2) } });
        }
    }
}

export async function reverseBenefitDeductions(tx: Prisma.TransactionClient, input: { companyId: number; runId: number; actorId: number; reason: string; effectiveDate: Date }) {
    const applications = await tx.hrDeductionApplication.findMany({ where: { companyId: input.companyId, payrollRunId: input.runId, kind: 'APPLIED' }, include: { reversals: true, deduction: { include: { loan: true } } } });
    for (const application of applications) {
        if (application.reversals.length) continue;
        await tx.hrDeductionApplication.create({ data: { companyId: input.companyId, deductionId: application.deductionId, versionId: application.versionId, payrollRunId: input.runId, kind: 'REVERSAL', amount: application.amount.negated(), currency: application.currency, reason: input.reason, actorId: input.actorId, reversalOfId: application.id } });
        const deduction = application.deduction;
        await tx.hrDeduction.update({ where: { id: deduction.id }, data: { remainingAmount: deduction.remainingAmount ? deduction.remainingAmount.plus(application.amount) : null, status: deduction.status === 'COMPLETED' ? 'ACTIVE' : undefined, revision: { increment: 1 } } });
        await trace(tx, { companyId: input.companyId, resourceType: 'DEDUCTION', resourceId: deduction.id, event: 'PAYROLL_APPLICATION_REVERSAL', actorId: input.actorId, reason: input.reason, fromStatus: deduction.status, toStatus: deduction.status === 'COMPLETED' ? 'ACTIVE' : deduction.status, revision: deduction.revision + 1, metadata: { payrollRunId: input.runId, applicationId: application.id, amount: application.amount.negated().toFixed(2) } });
        if (deduction.loanId) {
            const entry = await tx.hrLoanLedgerEntry.findFirst({ where: { companyId: input.companyId, loanId: deduction.loanId, payrollRunId: input.runId, type: 'PAYROLL_DEDUCTION', reversalEntries: { none: {} } } });
            if (entry) {
                await tx.hrLoanLedgerEntry.create({ data: { companyId: input.companyId, loanId: deduction.loanId, type: 'REVERSAL', amount: entry.amount.negated(), currency: entry.currency, effectiveDate: input.effectiveDate, payrollRunId: input.runId, reference: `VOID-PAYROLL-${input.runId}`, reason: input.reason, actorId: input.actorId, reversedEntryId: entry.id } });
                const loan = deduction.loan!; await tx.hrLoan.update({ where: { id: loan.id }, data: { outstandingBalance: loan.outstandingBalance.plus(entry.amount), status: 'ACTIVE', revision: { increment: 1 } } });
                await trace(tx, { companyId: input.companyId, resourceType: 'LOAN', resourceId: loan.id, event: 'PAYROLL_DEDUCTION_REVERSAL', actorId: input.actorId, reason: input.reason, fromStatus: loan.status, toStatus: 'ACTIVE', revision: loan.revision + 1, metadata: { payrollRunId: input.runId, amount: entry.amount.negated().toFixed(2) } });
            }
        }
    }
}
