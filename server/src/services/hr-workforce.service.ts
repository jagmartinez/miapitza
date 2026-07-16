import { createHash } from 'node:crypto';
import {
    Prisma,
    type AttendanceAction,
    type AttendanceCorrectionType,
    type AttendanceCorrectionStatus,
    type AttendancePeriodStatus,
    type LeaveFraction,
    type LeaveRequestStatus,
    type OvertimeRequestStatus,
    type VacationBalanceUnit,
} from '@prisma/client';
import prisma from '../utils/prisma';
import { isValidTimeZone, zonedDateKey, zonedDateTimeToUtc } from '../utils/timezone';
import { AuditLogService } from './audit-log.service';
import { availableActionsFrom } from './hr-attendance.service';

type Db = Prisma.TransactionClient | typeof prisma;
type Decision = 'APPROVED' | 'REJECTED';

export class HrWorkforceError extends Error {
    constructor(message: string, public readonly statusCode = 400, public readonly code = 'HR_WORKFORCE_INVALID') {
        super(message);
    }
}

function requiredText(value: unknown, field: string, max = 2000): string {
    if (typeof value !== 'string' || !value.trim()) throw new HrWorkforceError(`${field} es requerido`);
    const normalized = value.trim();
    if (normalized.length > max) throw new HrWorkforceError(`${field} excede ${max} caracteres`);
    return normalized;
}

function optionalText(value: unknown, max = 2000): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new HrWorkforceError('El valor debe ser texto');
    const normalized = value.trim();
    if (normalized.length > max) throw new HrWorkforceError(`El valor excede ${max} caracteres`);
    return normalized || null;
}

function positiveId(value: unknown, field: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new HrWorkforceError(`${field} debe ser un entero positivo`);
    return parsed;
}

function positiveInt(value: unknown, field: string, max = 1_000_000): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) throw new HrWorkforceError(`${field} debe ser un entero positivo`);
    return parsed;
}

function dateValue(value: unknown, field: string): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HrWorkforceError(`${field} debe usar YYYY-MM-DD`);
    const result = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new HrWorkforceError(`${field} es inválida`);
    return result;
}

function dateKey(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function dateRangeKeys(from: Date, to: Date): string[] {
    const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days < 1 || days > 366) throw new HrWorkforceError('El rango debe contener entre 1 y 366 días');
    return Array.from({ length: days }, (_, index) => new Date(from.getTime() + index * 86_400_000).toISOString().slice(0, 10));
}

function localDateTime(value: unknown, timezone: unknown): { instant: Date; timezone: string } | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new HrWorkforceError('requestedOccurredAt debe ser datetime-local');
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
    if (!match) throw new HrWorkforceError('requestedOccurredAt debe usar YYYY-MM-DDTHH:mm');
    const zone = requiredText(timezone, 'requestedTimezone', 64);
    if (!isValidTimeZone(zone)) throw new HrWorkforceError('requestedTimezone no es una zona IANA válida');
    try {
        return {
            timezone: zone,
            instant: zonedDateTimeToUtc({
                year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
                hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] || 0),
            }, zone),
        };
    } catch (error) {
        throw new HrWorkforceError(error instanceof Error ? error.message : 'Hora local inválida');
    }
}

function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function requestHash(value: unknown): string {
    return createHash('sha256').update(stable(value)).digest('hex');
}

async function ensureUser(companyId: number, userId: number, db: Db = prisma, activeOnly = true) {
    const user = await db.user.findFirst({
        where: {
            id: userId, companyId, status: activeOnly ? 'ACTIVE' : undefined,
            accountType: 'INTERNAL',
            employee: activeOnly ? { is: { status: 'ACTIVE' } } : { isNot: null },
        },
        select: { id: true, name: true, username: true, branchId: true },
    });
    if (!user) throw new HrWorkforceError('El usuario no pertenece a la empresa o está inactivo', 404, 'HR_USER_NOT_FOUND');
    return user;
}

async function ensureBranch(companyId: number, branchId: number | null, db: Db = prisma) {
    if (!branchId) return null;
    const branch = await db.branch.findFirst({ where: { id: branchId, companyId }, select: { id: true, name: true, code: true, timezone: true } });
    if (!branch) throw new HrWorkforceError('La sucursal no pertenece a la empresa', 404, 'HR_BRANCH_NOT_FOUND');
    return branch;
}

async function assertDatesOpen(companyId: number, from: Date, to: Date, db: Db = prisma) {
    const period = await db.attendancePeriod.findFirst({
        where: { companyId, status: 'CLOSED', dateFrom: { lte: to }, dateTo: { gte: from } },
        select: { id: true, dateFrom: true, dateTo: true },
    });
    if (period) throw new HrWorkforceError(`El período ${dateKey(period.dateFrom)} a ${dateKey(period.dateTo)} está cerrado`, 409, 'HR_PERIOD_CLOSED');
}

async function lockAttendancePeriod(tx: Prisma.TransactionClient, companyId: number, periodId: number) {
    const rows = await tx.$queryRaw<Array<{ id: number; status: AttendancePeriodStatus; revision: number }>>(Prisma.sql`
        SELECT id, status, revision
        FROM \`AttendancePeriod\`
        WHERE id = ${periodId} AND companyId = ${companyId}
        FOR UPDATE
    `);
    if (!rows[0]) throw new HrWorkforceError('Período no encontrado', 404, 'HR_PERIOD_NOT_FOUND');
    return rows[0];
}

async function idempotent<T>(input: {
    companyId: number; key: string; operation: string; entityType: string; payload: unknown;
    execute: (tx: Prisma.TransactionClient) => Promise<{ entityId: number; value: T }>;
    load: (entityId: number) => Promise<T | null>;
}): Promise<T> {
    const key = requiredText(input.key, 'Idempotency-Key', 128);
    const hash = requestHash(input.payload);
    const replay = async () => {
        const record = await prisma.workforceIdempotencyRecord.findUnique({ where: { companyId_key: { companyId: input.companyId, key } } });
        if (!record) return null;
        if (record.operation !== input.operation || record.requestHash !== hash) {
            throw new HrWorkforceError('Idempotency-Key ya fue usado con otra operación o payload', 409, 'IDEMPOTENCY_CONFLICT');
        }
        if (record.response !== null) return record.response as T;
        const loaded = await input.load(record.entityId);
        if (!loaded) throw new HrWorkforceError('La respuesta idempotente ya no está disponible', 409, 'IDEMPOTENCY_STALE');
        return loaded;
    };
    const existing = await replay();
    if (existing) return existing;
    try {
        return await prisma.$transaction(async tx => {
            const record = await tx.workforceIdempotencyRecord.create({ data: {
                companyId: input.companyId, key, operation: input.operation, requestHash: hash,
                entityType: input.entityType, entityId: 0,
            } });
            const result = await input.execute(tx);
            const response = JSON.parse(JSON.stringify(result.value)) as Prisma.InputJsonValue;
            await tx.workforceIdempotencyRecord.update({
                where: { id: record.id },
                data: { entityId: result.entityId, response },
            });
            return result.value;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const loaded = await replay();
            if (loaded) return loaded;
        }
        throw error;
    }
}

const userSelect = { id: true, name: true, username: true } as const;
const branchSelect = { id: true, name: true, code: true } as const;

function page(input: { page?: number; limit?: number }) {
    const pageNumber = Number.isInteger(input.page) && Number(input.page) > 0 ? Number(input.page) : 1;
    const limit = Number.isInteger(input.limit) && Number(input.limit) > 0 ? Math.min(Number(input.limit), 100) : 50;
    return { page: pageNumber, limit, skip: (pageNumber - 1) * limit };
}

function pagination(total: number, current: { page: number; limit: number }) {
    return { page: current.page, limit: current.limit, total, totalPages: Math.max(1, Math.ceil(total / current.limit)) };
}

function periodApi(period: Prisma.AttendancePeriodGetPayload<{ include: {
    _count: { select: { summaries: true } };
} }>, counts?: {
    unresolvedIncidentCount: number;
    pendingCorrectionCount: number;
    pendingOvertimeCount: number;
    pendingLeaveCount: number;
}) {
    return {
        id: period.id, dateFrom: dateKey(period.dateFrom), dateTo: dateKey(period.dateTo), timezone: period.timezone,
        status: period.status, summaryCount: period._count.summaries, createdAt: period.createdAt,
        closedAt: period.closedAt, reopenedAt: period.reopenedAt, lastActionReason: period.lastActionReason,
        payrollReference: period.payrollEligible && period.status === 'CLOSED' ? `ATTENDANCE-PERIOD-${period.id}-R${period.revision}` : null,
        ...counts,
    };
}

function summaryApi(summary: Prisma.AttendanceDailySummaryGetPayload<{ include: {
    user: { select: typeof userSelect }; branch: { select: typeof branchSelect }; period: { select: { status: true } }; _count: { select: { incidents: true } };
} }>) {
    return {
        id: summary.id, date: dateKey(summary.date), timezone: summary.timezone, userId: summary.userId, user: summary.user,
        branchId: summary.branchId, branch: summary.branch, periodId: summary.periodId, periodStatus: summary.period?.status,
        scheduledMinutes: summary.scheduledMinutes, ordinaryMinutes: summary.ordinaryMinutes, breakMinutes: summary.breakMinutes,
        lateMinutes: summary.lateMinutes, earlyDepartureMinutes: summary.earlyDepartureMinutes,
        candidateOvertimeMinutes: summary.candidateOvertimeMinutes, approvedOvertimeMinutes: summary.approvedOvertimeMinutes,
        incidentCount: summary._count.incidents, calculatedAt: summary.calculatedAt, sourceRevision: summary.sourceRevision,
    };
}

function correctionApi(correction: Prisma.AttendanceCorrectionGetPayload<{ include: {
    user: { select: typeof userSelect }; requestedBranch: { select: typeof branchSelect };
} }>) {
    return {
        id: correction.id, userId: correction.userId, user: correction.user, dailySummaryId: correction.dailySummaryId,
        incidentId: correction.incidentId, targetEventId: correction.targetEventId, type: correction.type,
        requestedAction: correction.requestedAction,
        requestedOccurredAt: correction.requestedOccurredAt, requestedTimezone: correction.requestedTimezone,
        requestedBranchId: correction.requestedBranchId, requestedBranch: correction.requestedBranch, reason: correction.reason,
        status: correction.status, requestedById: correction.requestedById, decidedById: correction.decidedById,
        decisionReason: correction.decisionReason, createdAt: correction.createdAt, decidedAt: correction.decidedAt,
        appliedAt: correction.appliedAt, auditReference: correction.appliedAt ? `ATTENDANCE-CORRECTION-${correction.id}-R${correction.revision}` : null,
    };
}

function overtimeApi(request: Prisma.OvertimeRequestGetPayload<{ include: { user: { select: typeof userSelect } } }>) {
    return {
        id: request.id, userId: request.userId, user: request.user, dailySummaryId: request.dailySummaryId,
        date: dateKey(request.date), candidateMinutes: request.candidateMinutes, requestedMinutes: request.requestedMinutes,
        approvedMinutes: request.approvedMinutes, reason: request.reason, status: request.status,
        requestedById: request.requestedById, decisionReason: request.decisionReason, createdAt: request.createdAt,
        decidedAt: request.decidedAt, cancelledAt: request.cancelledAt,
    };
}

function leaveTypeApi(type: Prisma.LeaveTypeGetPayload<Record<string, never>>) {
    return { ...type };
}

function leaveRequestApi(request: Prisma.LeaveRequestGetPayload<{ include: {
    user: { select: typeof userSelect }; leaveType: true;
} }>) {
    return {
        id: request.id, userId: request.userId, user: request.user, leaveTypeId: request.leaveTypeId,
        leaveType: leaveTypeApi(request.leaveType), startDate: dateKey(request.startDate), endDate: dateKey(request.endDate),
        fraction: request.fraction, startTime: request.startTime, endTime: request.endTime,
        requestedAmount: Number(request.requestedAmount), balanceUnit: request.balanceUnit, reason: request.reason,
        status: request.status, decisionReason: request.decisionReason, createdAt: request.createdAt,
        submittedAt: request.submittedAt, decidedAt: request.decidedAt, cancelledAt: request.cancelledAt,
    };
}

const summaryInclude = {
    user: { select: userSelect }, branch: { select: branchSelect }, period: { select: { status: true } }, _count: { select: { incidents: true } },
} satisfies Prisma.AttendanceDailySummaryInclude;
const correctionInclude = { user: { select: userSelect }, requestedBranch: { select: branchSelect } } satisfies Prisma.AttendanceCorrectionInclude;
const overtimeInclude = { user: { select: userSelect } } satisfies Prisma.OvertimeRequestInclude;
const leaveRequestInclude = { user: { select: userSelect }, leaveType: true } satisfies Prisma.LeaveRequestInclude;

type EffectiveEvent = {
    id: number;
    action: 'CHECK_IN' | 'BREAK_START' | 'BREAK_END' | 'CHECK_OUT';
    occurredAt: Date;
    branchId: number | null;
    scheduledShiftId?: number | null;
    sessionKey?: string | null;
};

function minutesBetween(start: Date, end: Date): number {
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

function effectiveEvents(events: Array<{
    id: number; action: EffectiveEvent['action']; serverAt: Date; branchId: number | null;
    scheduledShiftId: number | null; sessionKey: string | null; decision: string;
    review: { decision: string } | null;
    targetedCorrections: Array<{ type: AttendanceCorrectionType; status: AttendanceCorrectionStatus; requestedOccurredAt: Date | null; requestedBranchId: number | null; compensationEventId: number | null }>;
}>): EffectiveEvent[] {
    const result: EffectiveEvent[] = [];
    for (const event of events) {
        const accepted = event.decision === 'ACCEPTED' || (event.decision === 'REVIEW' && event.review?.decision === 'APPROVED');
        if (!accepted) continue;
        const applied = event.targetedCorrections.filter(item => item.status === 'APPLIED');
        if (applied.some(item => item.type === 'VOID_PUNCH')) continue;
        const changed = applied.find(item => item.type === 'CHANGE_TIME' && item.requestedOccurredAt);
        // CHANGE_TIME is represented by a new immutable compensation event. The
        // original is removed here to avoid double counting it.
        if (changed?.compensationEventId) continue;
        const assigned = applied.find(item => item.type === 'ASSIGN_BRANCH' && item.requestedBranchId);
        if (assigned?.compensationEventId) continue;
        result.push({
            id: event.id,
            action: event.action,
            occurredAt: changed?.requestedOccurredAt || event.serverAt,
            branchId: assigned?.requestedBranchId || event.branchId,
            scheduledShiftId: event.scheduledShiftId,
            sessionKey: event.sessionKey,
        });
    }
    return result.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id - right.id);
}

export function deriveWorkedMinutes(events: EffectiveEvent[], paidBreakShiftIds: ReadonlySet<number> = new Set()) {
    let activeStart: Date | null = null;
    let activePaidBreak = false;
    let breakStart: Date | null = null;
    let sessionBreakMinutes = 0;
    let ordinaryMinutes = 0;
    let breakMinutes = 0;
    const anomalies: string[] = [];
    for (const event of events) {
        if (event.action === 'CHECK_IN') {
            if (activeStart) anomalies.push('DUPLICATE_CHECK_IN');
            else {
                activeStart = event.occurredAt;
                activePaidBreak = Boolean(event.scheduledShiftId && paidBreakShiftIds.has(event.scheduledShiftId));
                sessionBreakMinutes = 0;
            }
        } else if (event.action === 'BREAK_START') {
            if (!activeStart || breakStart) anomalies.push('INVALID_BREAK_START');
            else breakStart = event.occurredAt;
        } else if (event.action === 'BREAK_END') {
            if (!breakStart) anomalies.push('INVALID_BREAK_END');
            else {
                const duration = minutesBetween(breakStart, event.occurredAt);
                breakMinutes += duration;
                if (!activePaidBreak) sessionBreakMinutes += duration;
                breakStart = null;
            }
        } else if (event.action === 'CHECK_OUT') {
            if (!activeStart) anomalies.push('CHECK_OUT_WITHOUT_CHECK_IN');
            else {
                const total = minutesBetween(activeStart, event.occurredAt);
                const openBreak = breakStart && !activePaidBreak ? minutesBetween(breakStart, event.occurredAt) : 0;
                ordinaryMinutes += Math.max(0, total - sessionBreakMinutes - openBreak);
                if (openBreak) breakMinutes += openBreak;
                activeStart = null;
                activePaidBreak = false;
                breakStart = null;
                sessionBreakMinutes = 0;
            }
        }
    }
    if (activeStart) anomalies.push('MISSING_CHECK_OUT');
    if (breakStart) anomalies.push('OPEN_BREAK');
    return { ordinaryMinutes, breakMinutes, anomalies };
}

export function deriveWorkedIntervals(events: EffectiveEvent[]) {
    const intervals: Array<{ start: Date; end: Date }> = [];
    let activeStart: Date | null = null;
    let breakStart: Date | null = null;
    for (const event of [...events].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id - right.id)) {
        if (event.action === 'CHECK_IN' && !activeStart) {
            activeStart = event.occurredAt;
        } else if (event.action === 'BREAK_START' && activeStart && !breakStart) {
            if (event.occurredAt > activeStart) intervals.push({ start: activeStart, end: event.occurredAt });
            breakStart = event.occurredAt;
            activeStart = null;
        } else if (event.action === 'BREAK_END' && breakStart) {
            activeStart = event.occurredAt;
            breakStart = null;
        } else if (event.action === 'CHECK_OUT' && activeStart) {
            if (event.occurredAt > activeStart) intervals.push({ start: activeStart, end: event.occurredAt });
            activeStart = null;
            breakStart = null;
        }
    }
    return intervals;
}

export function hasAttendanceLeaveConflict(input: {
    firstIn?: Date;
    lastOut?: Date;
    fullyCovered: boolean;
    leaveIntervals: Array<{ start: Date; end: Date }>;
    workedIntervals: Array<{ start: Date; end: Date }>;
}) {
    if (input.fullyCovered && (input.firstIn || input.lastOut)) return true;
    return input.leaveIntervals.some(leaveInterval => (
        input.workedIntervals.some(workedInterval => (
            leaveInterval.start < workedInterval.end && leaveInterval.end > workedInterval.start
        ))
    ));
}

function dayBounds(date: string, timezone: string) {
    const parsed = dateValue(date, 'date');
    const [year, month, day] = date.split('-').map(Number);
    const next = new Date(parsed.getTime() + 86_400_000);
    return {
        start: zonedDateTimeToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, timezone),
        end: zonedDateTimeToUtc({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0, second: 0 }, timezone),
    };
}

function periodInstantBounds(from: Date, to: Date, timezone: string) {
    return {
        start: dayBounds(dateKey(from), timezone).start,
        end: dayBounds(dateKey(to), timezone).end,
    };
}

type ApprovedLeaveWindow = {
    id: number;
    fraction: LeaveFraction;
    startTime: string | null;
    endTime: string | null;
    startDate?: Date;
    endDate?: Date;
};

export function leaveIntervalsForShift(
    leaves: ApprovedLeaveWindow[],
    date: string,
    timezone: string,
    shift: { startAt: Date; endAt: Date },
) {
    const intervals = leaves.flatMap(leave => {
        if (leave.fraction === 'FULL_DAY') {
            const coversAttributedDate = !leave.startDate || !leave.endDate
                || (dateKey(leave.startDate) <= date && dateKey(leave.endDate) >= date);
            return coversAttributedDate ? [{ start: shift.startAt, end: shift.endAt }] : [];
        }
        if (!['HOURS', 'HALF_DAY'].includes(leave.fraction) || !leave.startTime || !leave.endTime) return [];
        const [startHour, startMinute] = leave.startTime.split(':').map(Number);
        const [endHour, endMinute] = leave.endTime.split(':').map(Number);
        const coverageDates = leave.startDate && leave.endDate
            ? dateRangeKeys(leave.startDate, leave.endDate)
            : [date];
        return coverageDates.flatMap(coverageDate => {
            const [year, month, day] = coverageDate.split('-').map(Number);
            const start = zonedDateTimeToUtc({ year, month, day, hour: startHour, minute: startMinute, second: 0 }, timezone);
            const end = zonedDateTimeToUtc({ year, month, day, hour: endHour, minute: endMinute, second: 0 }, timezone);
            const clippedStart = start > shift.startAt ? start : shift.startAt;
            const clippedEnd = end < shift.endAt ? end : shift.endAt;
            return clippedStart < clippedEnd ? [{ start: clippedStart, end: clippedEnd }] : [];
        });
    }).sort((left, right) => left.start.getTime() - right.start.getTime());

    const merged: Array<{ start: Date; end: Date }> = [];
    for (const interval of intervals) {
        const previous = merged[merged.length - 1];
        if (previous && interval.start <= previous.end) {
            if (interval.end > previous.end) previous.end = interval.end;
        } else {
            merged.push({ ...interval });
        }
    }
    let expectedStart = shift.startAt;
    for (const interval of merged) {
        if (interval.start <= expectedStart && interval.end > expectedStart) expectedStart = interval.end;
    }
    let expectedEnd = shift.endAt;
    for (const interval of [...merged].reverse()) {
        if (interval.end >= expectedEnd && interval.start < expectedEnd) expectedEnd = interval.start;
    }
    return {
        fullyCovered: expectedStart >= shift.endAt || expectedEnd <= shift.startAt,
        expectedStart,
        expectedEnd,
        intervals: merged,
    };
}

type SummarySourceState = {
    timezone: string;
    periodId: number | null;
    scheduledMinutes: number | null;
    ordinaryMinutes: number;
    breakMinutes: number;
    lateMinutes: number;
    earlyDepartureMinutes: number;
    candidateOvertimeMinutes: number;
    approvedOvertimeMinutes: number;
};

export function hasSummarySourceChanged(
    previous: SummarySourceState | null,
    next: SummarySourceState,
) {
    if (!previous) return true;
    return Object.keys(next).some(key => (
        previous[key as keyof SummarySourceState] !== next[key as keyof SummarySourceState]
    ));
}

export class AttendanceDerivedService {
    static async calculate(companyId: number, userId: number, date: string, branchId?: number | null, timezoneHint?: string) {
        await ensureUser(companyId, userId, prisma, false);
        const branch = await ensureBranch(companyId, branchId || null);
        const timezone = branch?.timezone || timezoneHint || 'America/Managua';
        if (!isValidTimeZone(timezone)) throw new HrWorkforceError('Zona horaria IANA inválida');
        const localDate = dateValue(date, 'date');
        const scopeKey = branchId ? `BRANCH:${branchId}` : 'UNASSIGNED';
        const existing = await prisma.attendanceDailySummary.findUnique({
            where: { companyId_userId_date_scopeKey: { companyId, userId, date: localDate, scopeKey } },
            include: summaryInclude,
        });
        if (existing?.period?.status === 'CLOSED') return summaryApi(existing);
        const period = await prisma.attendancePeriod.findFirst({
            where: { companyId, dateFrom: { lte: localDate }, dateTo: { gte: localDate } },
            orderBy: { id: 'desc' }, select: { id: true, status: true },
        });
        if (period?.status === 'CLOSED') {
            if (existing) return summaryApi(existing);
            throw new HrWorkforceError('El período está cerrado y no admite nuevos resúmenes', 409, 'HR_PERIOD_CLOSED');
        }

        const bounds = dayBounds(date, timezone);
        const candidateShifts = branchId ? await prisma.scheduledShift.findMany({
            where: {
                companyId, status: 'SCHEDULED', branchId,
                schedule: { status: 'PUBLISHED' },
                startAt: { lt: new Date(bounds.end.getTime() + 36 * 3600_000) },
                endAt: { gt: new Date(bounds.start.getTime() - 36 * 3600_000) },
                OR: [
                    { userId, assignmentOverride: null },
                    { assignmentOverride: { assignedUserId: userId } },
                ],
            },
            orderBy: { startAt: 'asc' },
        }) : [];
        // Attribute a shift to the local date on which it starts. This avoids
        // double-counting an overnight shift in both adjacent daily summaries.
        const shifts = candidateShifts.filter(shift => zonedDateKey(shift.startAt, timezone) === date);
        const eventStart = shifts.reduce((value, shift) => shift.startAt < value ? shift.startAt : value, bounds.start);
        const eventEnd = shifts.reduce((value, shift) => shift.endAt > value ? shift.endAt : value, bounds.end);
        const leaveCoverageEnd = shifts.reduce((value, shift) => {
            const shiftEndDate = dateValue(zonedDateKey(shift.endAt, timezone), 'shiftEndDate');
            return shiftEndDate > value ? shiftEndDate : value;
        }, localDate);
        const [rawEvents, approvedLeaves] = await Promise.all([
            prisma.attendanceEvent.findMany({
            where: { companyId, userId, serverAt: { gte: eventStart, lt: eventEnd } },
            include: {
                review: { select: { decision: true } },
                targetedCorrections: {
                    where: { status: 'APPLIED' },
                    select: { type: true, status: true, requestedOccurredAt: true, requestedBranchId: true, compensationEventId: true },
                },
            },
            orderBy: [{ serverAt: 'asc' }, { id: 'asc' }],
            }),
            prisma.leaveRequest.findMany({
                where: {
                    companyId, userId, status: 'APPROVED',
                    startDate: { lte: leaveCoverageEnd }, endDate: { gte: localDate },
                },
                select: { id: true, fraction: true, startTime: true, endTime: true, startDate: true, endDate: true },
            }),
        ]);
        const allEffective = effectiveEvents(rawEvents);
        const events = branchId ? allEffective.filter(event => event.branchId === branchId) : allEffective.filter(event => event.branchId === null);
        const worked = deriveWorkedMinutes(events, new Set(shifts.filter(shift => shift.paidBreak).map(shift => shift.id)));
        const scheduledMinutes = shifts.length
            ? shifts.reduce((total, shift) => total + minutesBetween(shift.startAt, shift.endAt) - (shift.paidBreak ? 0 : shift.breakMinutes), 0)
            : null;
        const shiftAssessments = shifts.map(shift => {
            const shiftEvents = events.filter(event => event.scheduledShiftId === shift.id || (
                !event.scheduledShiftId
                && event.occurredAt >= new Date(shift.startAt.getTime() - 6 * 3600_000)
                && event.occurredAt <= new Date(shift.endAt.getTime() + 6 * 3600_000)
            ));
            const firstIn = shiftEvents.find(event => event.action === 'CHECK_IN')?.occurredAt;
            const lastOut = [...shiftEvents].reverse().find(event => event.action === 'CHECK_OUT')?.occurredAt;
            const leaveCoverage = leaveIntervalsForShift(approvedLeaves, date, timezone, shift);
            return {
                shift,
                firstIn,
                lastOut,
                leaveCoverage,
                workedIntervals: deriveWorkedIntervals(shiftEvents),
                lateMinutes: firstIn && !leaveCoverage.fullyCovered
                    ? Math.max(0, minutesBetween(leaveCoverage.expectedStart, firstIn))
                    : 0,
                earlyDepartureMinutes: lastOut && !leaveCoverage.fullyCovered
                    ? Math.max(0, minutesBetween(lastOut, leaveCoverage.expectedEnd))
                    : 0,
            };
        });
        const lateMinutes = shiftAssessments.reduce((total, item) => total + item.lateMinutes, 0);
        const earlyDepartureMinutes = shiftAssessments.reduce((total, item) => total + item.earlyDepartureMinutes, 0);
        const candidateOvertimeMinutes = scheduledMinutes === null
            ? 0
            : Math.max(0, worked.ordinaryMinutes - scheduledMinutes);
        const approved = await prisma.overtimeRequest.aggregate({
            where: {
                companyId,
                userId,
                date: localDate,
                status: 'APPROVED',
                dailySummary: { scopeKey },
            },
            _sum: { approvedMinutes: true },
        });

        const generated: Array<{ key: string; type: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; message: string }> = [];
        if (scheduledMinutes === null && worked.ordinaryMinutes > 0) {
            generated.push({
                key: 'UNSCHEDULED_WORK',
                type: 'UNSCHEDULED_WORK',
                severity: 'CRITICAL',
                message: 'Existe tiempo trabajado sin un turno publicado; requiere corrección o autorización antes del cierre',
            });
        }
        for (const assessment of shiftAssessments) {
            if (!assessment.firstIn && !assessment.leaveCoverage.fullyCovered) generated.push({
                key: `MISSING_CHECK_IN:${assessment.shift.id}`,
                type: 'MISSING_CHECK_IN',
                severity: 'CRITICAL',
                message: `No existe marcaje de entrada para la porcion no cubierta del turno publicado ${assessment.shift.id}`,
            });
            if (!assessment.lastOut && !assessment.leaveCoverage.fullyCovered) generated.push({
                key: `MISSING_CHECK_OUT:${assessment.shift.id}`,
                type: 'MISSING_CHECK_OUT',
                severity: 'CRITICAL',
                message: `No existe marcaje de salida para la porcion no cubierta del turno publicado ${assessment.shift.id}`,
            });
            if (hasAttendanceLeaveConflict({
                firstIn: assessment.firstIn,
                lastOut: assessment.lastOut,
                fullyCovered: assessment.leaveCoverage.fullyCovered,
                leaveIntervals: assessment.leaveCoverage.intervals,
                workedIntervals: assessment.workedIntervals,
            })) {
                generated.push({
                    key: `ATTENDANCE_LEAVE_CONFLICT:${assessment.shift.id}`,
                    type: 'ATTENDANCE_LEAVE_CONFLICT',
                    severity: 'CRITICAL',
                    message: `El turno ${assessment.shift.id} registra trabajo durante un permiso aprobado; requiere segmentar el turno o corregir el marcaje`,
                });
            }
        }
        if (lateMinutes > 0) generated.push({ key: 'LATE_ARRIVAL', type: 'LATE_ARRIVAL', severity: 'WARNING', message: `Entrada tardía por ${lateMinutes} minutos` });
        if (earlyDepartureMinutes > 0) generated.push({ key: 'EARLY_DEPARTURE', type: 'EARLY_DEPARTURE', severity: 'WARNING', message: `Salida anticipada por ${earlyDepartureMinutes} minutos` });
        for (const anomaly of worked.anomalies) generated.push({ key: anomaly, type: anomaly, severity: 'WARNING', message: `Secuencia de marcaje irregular: ${anomaly}` });
        for (const event of rawEvents.filter(item => item.decision === 'REJECTED' || (item.decision === 'REVIEW' && item.review?.decision === 'REJECTED'))) {
            generated.push({ key: `REJECTED_EVENT:${event.id}`, type: 'REJECTED_ATTENDANCE_EVENT', severity: 'WARNING', message: `Marcaje ${event.id} rechazado` });
        }
        const dedupeKeys = generated.map(item => `${userId}:${date}:${scopeKey}:${item.key}`);
        return prisma.$transaction(async tx => {
            const currentPeriod = await tx.attendancePeriod.findFirst({
                where: { companyId, dateFrom: { lte: localDate }, dateTo: { gte: localDate } },
                orderBy: { id: 'desc' },
                select: { id: true, status: true },
            });
            const lockedPeriod = currentPeriod
                ? await lockAttendancePeriod(tx, companyId, currentPeriod.id)
                : null;
            if (lockedPeriod?.status === 'CLOSED') {
                const frozen = await tx.attendanceDailySummary.findUnique({
                    where: { companyId_userId_date_scopeKey: { companyId, userId, date: localDate, scopeKey } },
                    include: summaryInclude,
                });
                if (frozen) return summaryApi(frozen);
                throw new HrWorkforceError('El período está cerrado y no admite nuevos resúmenes', 409, 'HR_PERIOD_CLOSED');
            }
            const priorSummary = await tx.attendanceDailySummary.findUnique({
                where: { companyId_userId_date_scopeKey: { companyId, userId, date: localDate, scopeKey } },
                select: {
                    timezone: true, periodId: true, scheduledMinutes: true, ordinaryMinutes: true,
                    breakMinutes: true, lateMinutes: true, earlyDepartureMinutes: true,
                    candidateOvertimeMinutes: true, approvedOvertimeMinutes: true,
                },
            });
            const nextApprovedOvertimeMinutes = approved._sum.approvedMinutes || 0;
            const sourceChanged = hasSummarySourceChanged(priorSummary, {
                timezone,
                periodId: lockedPeriod?.id || null,
                scheduledMinutes,
                ordinaryMinutes: worked.ordinaryMinutes,
                breakMinutes: worked.breakMinutes,
                lateMinutes,
                earlyDepartureMinutes,
                candidateOvertimeMinutes,
                approvedOvertimeMinutes: nextApprovedOvertimeMinutes,
            });
            const summary = await tx.attendanceDailySummary.upsert({
                where: { companyId_userId_date_scopeKey: { companyId, userId, date: localDate, scopeKey } },
                create: {
                    companyId, userId, branchId: branchId || null, scopeKey, date: localDate, timezone, periodId: lockedPeriod?.id,
                    scheduledMinutes, ordinaryMinutes: worked.ordinaryMinutes, breakMinutes: worked.breakMinutes,
                    lateMinutes, earlyDepartureMinutes, candidateOvertimeMinutes,
                    approvedOvertimeMinutes: nextApprovedOvertimeMinutes,
                },
                update: {
                    timezone, periodId: lockedPeriod?.id, scheduledMinutes, ordinaryMinutes: worked.ordinaryMinutes,
                    breakMinutes: worked.breakMinutes, lateMinutes, earlyDepartureMinutes, candidateOvertimeMinutes,
                    approvedOvertimeMinutes: nextApprovedOvertimeMinutes, calculatedAt: new Date(),
                    sourceRevision: sourceChanged ? { increment: 1 } : undefined,
                },
                include: summaryInclude,
            });
            if (dedupeKeys.length) {
                await tx.attendanceIncident.updateMany({
                    where: { companyId, dailySummaryId: summary.id, status: 'OPEN', dedupeKey: { notIn: dedupeKeys } },
                    data: { status: 'RESOLVED', resolvedAt: new Date() },
                });
            } else {
                await tx.attendanceIncident.updateMany({ where: { companyId, dailySummaryId: summary.id, status: 'OPEN' }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
            }
            for (const item of generated) {
                const dedupeKey = `${userId}:${date}:${scopeKey}:${item.key}`;
                await tx.attendanceIncident.upsert({
                    where: { companyId_dedupeKey: { companyId, dedupeKey } },
                    create: { companyId, dailySummaryId: summary.id, userId, branchId: branchId || null, date: localDate, type: item.type, severity: item.severity, message: item.message, reasonCode: item.key, dedupeKey },
                    update: { dailySummaryId: summary.id, message: item.message, severity: item.severity, status: 'OPEN', resolvedAt: null },
                });
            }
            const refreshed = await tx.attendanceDailySummary.findUniqueOrThrow({ where: { id: summary.id }, include: summaryInclude });
            return summaryApi(refreshed);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    static async list(companyId: number, filters: { date?: string; dateFrom?: string; dateTo?: string; branchId?: number; userId?: number; page?: number; limit?: number }) {
        const today = new Date().toISOString().slice(0, 10);
        const from = dateValue(filters.date || filters.dateFrom || today, 'dateFrom');
        const to = dateValue(filters.date || filters.dateTo || today, 'dateTo');
        const keys = dateRangeKeys(from, to);
        const broadStart = new Date(from.getTime() - 86_400_000);
        const broadEnd = new Date(to.getTime() + 2 * 86_400_000);
        const [eventSources, scheduledSources] = await Promise.all([
            prisma.attendanceEvent.findMany({
                where: {
                    companyId,
                    userId: filters.userId,
                    branchId: filters.branchId,
                    serverAt: { gte: broadStart, lt: broadEnd },
                },
                distinct: ['userId', 'branchId'],
                select: { userId: true, branchId: true },
            }),
            prisma.scheduledShift.findMany({
                where: {
                    companyId,
                    branchId: filters.branchId,
                    status: 'SCHEDULED',
                    schedule: { status: 'PUBLISHED' },
                    startAt: { lt: broadEnd },
                    endAt: { gt: broadStart },
                    ...(filters.userId ? { OR: [
                        { userId: filters.userId, assignmentOverride: null },
                        { assignmentOverride: { assignedUserId: filters.userId } },
                    ] } : {}),
                },
                select: { userId: true, branchId: true, assignmentOverride: { select: { assignedUserId: true } } },
            }),
        ]);
        const sources = new Map<string, { userId: number; branchId: number | null }>();
        for (const source of eventSources) sources.set(`${source.userId}:${source.branchId || 0}`, source);
        for (const source of scheduledSources) {
            const effectiveUserId = source.assignmentOverride?.assignedUserId || source.userId;
            sources.set(`${effectiveUserId}:${source.branchId}`, { userId: effectiveUserId, branchId: source.branchId });
        }
        if (filters.userId && sources.size === 0) {
            const user = await ensureUser(companyId, filters.userId, prisma, false);
            const branchId = filters.branchId || user.branchId;
            sources.set(`${user.id}:${branchId || 0}`, { userId: user.id, branchId });
        }
        for (const source of sources.values()) {
            for (const key of keys) {
                await AttendanceDerivedService.calculate(companyId, source.userId, key, source.branchId);
            }
        }
        const current = page(filters);
        const where: Prisma.AttendanceDailySummaryWhereInput = {
            companyId, date: { gte: from, lte: to }, userId: filters.userId, branchId: filters.branchId,
        };
        const [items, total] = await Promise.all([
            prisma.attendanceDailySummary.findMany({ where, include: summaryInclude, orderBy: [{ date: 'desc' }, { userId: 'asc' }], skip: current.skip, take: current.limit }),
            prisma.attendanceDailySummary.count({ where }),
        ]);
        return { items: items.map(summaryApi), pagination: pagination(total, current) };
    }
}

export class AttendanceIncidentService {
    static async list(companyId: number, filters: { date?: string; dateFrom?: string; dateTo?: string; branchId?: number; userId?: number; status?: string; page?: number; limit?: number }) {
        const current = page(filters);
        const where: Prisma.AttendanceIncidentWhereInput = {
            companyId, userId: filters.userId, branchId: filters.branchId,
            status: filters.status as Prisma.EnumAttendanceIncidentStatusFilter | undefined,
            date: filters.date ? dateValue(filters.date, 'date') : {
                gte: filters.dateFrom ? dateValue(filters.dateFrom, 'dateFrom') : undefined,
                lte: filters.dateTo ? dateValue(filters.dateTo, 'dateTo') : undefined,
            },
        };
        const include = { user: { select: userSelect }, branch: { select: branchSelect } } satisfies Prisma.AttendanceIncidentInclude;
        const [items, total] = await Promise.all([
            prisma.attendanceIncident.findMany({ where, include, orderBy: [{ date: 'desc' }, { severity: 'desc' }], skip: current.skip, take: current.limit }),
            prisma.attendanceIncident.count({ where }),
        ]);
        return { items: items.map(item => ({ ...item, date: dateKey(item.date) })), pagination: pagination(total, current) };
    }
}

async function periodWithCounts(id: number, companyId: number) {
    const period = await prisma.attendancePeriod.findFirst({
        where: { id, companyId }, include: { _count: { select: { summaries: true } } },
    });
    if (!period) return null;
    const instants = periodInstantBounds(period.dateFrom, period.dateTo, period.timezone);
    const [unresolvedIncidentCount, pendingCorrectionCount, pendingOvertimeCount, pendingLeaveCount] = await Promise.all([
        prisma.attendanceIncident.count({ where: { companyId, status: 'OPEN', date: { gte: period.dateFrom, lte: period.dateTo } } }),
        prisma.attendanceCorrection.count({ where: { companyId, status: 'PENDING', OR: [
            { dailySummary: { date: { gte: period.dateFrom, lte: period.dateTo } } },
            { requestedOccurredAt: { gte: instants.start, lt: instants.end } },
        ] } }),
        prisma.overtimeRequest.count({ where: { companyId, status: 'PENDING', date: { gte: period.dateFrom, lte: period.dateTo } } }),
        prisma.leaveRequest.count({ where: {
            companyId,
            status: 'PENDING',
            startDate: { lte: period.dateTo },
            endDate: { gte: period.dateFrom },
        } }),
    ]);
    return periodApi(period, { unresolvedIncidentCount, pendingCorrectionCount, pendingOvertimeCount, pendingLeaveCount });
}

export class AttendancePeriodService {
    static async list(companyId: number, filters: { dateFrom?: string; dateTo?: string; status?: string; page?: number; limit?: number }) {
        const current = page(filters);
        const where: Prisma.AttendancePeriodWhereInput = {
            companyId,
            status: filters.status as AttendancePeriodStatus | undefined,
            dateFrom: filters.dateTo ? { lte: dateValue(filters.dateTo, 'dateTo') } : undefined,
            dateTo: filters.dateFrom ? { gte: dateValue(filters.dateFrom, 'dateFrom') } : undefined,
        };
        const [periods, total] = await Promise.all([
            prisma.attendancePeriod.findMany({ where, include: { _count: { select: { summaries: true } } }, orderBy: { dateFrom: 'desc' }, skip: current.skip, take: current.limit }),
            prisma.attendancePeriod.count({ where }),
        ]);
        const items = await Promise.all(periods.map(period => periodWithCounts(period.id, companyId)));
        return { items: items.filter(Boolean), pagination: pagination(total, current) };
    }

    static async create(companyId: number, actorId: number, body: Record<string, unknown>, idempotencyKey: string) {
        const dateFrom = dateValue(body.dateFrom, 'dateFrom');
        const dateTo = dateValue(body.dateTo, 'dateTo');
        dateRangeKeys(dateFrom, dateTo);
        const timezone = optionalText(body.timezone, 64) || 'America/Managua';
        if (!isValidTimeZone(timezone)) throw new HrWorkforceError('timezone no es una zona IANA válida');
        const reason = optionalText(body.reason, 2000);
        return idempotent({
            companyId, key: idempotencyKey, operation: 'PERIOD_CREATE', entityType: 'AttendancePeriod',
            payload: { dateFrom: dateKey(dateFrom), dateTo: dateKey(dateTo), timezone, reason },
            load: id => periodWithCounts(id, companyId),
            execute: async tx => {
                const overlap = await tx.attendancePeriod.findFirst({ where: { companyId, dateFrom: { lte: dateTo }, dateTo: { gte: dateFrom } } });
                if (overlap) throw new HrWorkforceError('El rango se solapa con otro período de asistencia', 409, 'HR_PERIOD_OVERLAP');
                const created = await tx.attendancePeriod.create({ data: { companyId, dateFrom, dateTo, timezone, lastActionReason: reason, createdById: actorId } });
                await AuditLogService.log({ companyId, userId: actorId, entityType: 'AttendancePeriod', entityId: created.id, action: 'CREATE', details: { dateFrom: dateKey(dateFrom), dateTo: dateKey(dateTo), timezone, reason } }, tx);
                return { entityId: created.id, value: periodApi(await tx.attendancePeriod.findUniqueOrThrow({ where: { id: created.id }, include: { _count: { select: { summaries: true } } } }), { unresolvedIncidentCount: 0, pendingCorrectionCount: 0, pendingOvertimeCount: 0, pendingLeaveCount: 0 }) };
            },
        });
    }

    static async close(id: number, companyId: number, actorId: number, reasonValue: unknown, idempotencyKey: string) {
        const reason = requiredText(reasonValue, 'reason');
        // Materialize all known summaries before the serializable close. New
        // corrections/overtime requests also lock against CLOSED inside their tx.
        const period = await prisma.attendancePeriod.findFirst({ where: { id, companyId } });
        if (!period) throw new HrWorkforceError('Período no encontrado', 404, 'HR_PERIOD_NOT_FOUND');
        const periodInstants = periodInstantBounds(period.dateFrom, period.dateTo, period.timezone);
        const [eventSources, scheduledSources] = await Promise.all([
            prisma.attendanceEvent.findMany({
                where: { companyId, serverAt: { gte: periodInstants.start, lt: periodInstants.end } },
                distinct: ['userId', 'branchId'], select: { userId: true, branchId: true },
            }),
            prisma.scheduledShift.findMany({
                where: {
                    companyId,
                    status: 'SCHEDULED',
                    schedule: { status: 'PUBLISHED' },
                    startAt: { lt: periodInstants.end },
                    endAt: { gt: periodInstants.start },
                },
                select: { userId: true, branchId: true, assignmentOverride: { select: { assignedUserId: true } } },
            }),
        ]);
        const sourceMap = new Map<string, { userId: number; branchId: number | null }>();
        for (const source of eventSources) sourceMap.set(`${source.userId}:${source.branchId || 0}`, source);
        for (const source of scheduledSources) {
            const effectiveUserId = source.assignmentOverride?.assignedUserId || source.userId;
            sourceMap.set(`${effectiveUserId}:${source.branchId}`, { userId: effectiveUserId, branchId: source.branchId });
        }
        for (const source of sourceMap.values()) {
            const user = await ensureUser(companyId, source.userId, prisma, false);
            for (const key of dateRangeKeys(period.dateFrom, period.dateTo)) {
                await AttendanceDerivedService.calculate(companyId, source.userId, key, source.branchId || user.branchId);
            }
        }
        return idempotent({
            companyId, key: idempotencyKey, operation: `PERIOD_CLOSE:${id}`, entityType: 'AttendancePeriod', payload: { id, reason },
            load: entityId => periodWithCounts(entityId, companyId),
            execute: async tx => {
                let current = await tx.attendancePeriod.findFirst({ where: { id, companyId } });
                if (!current) throw new HrWorkforceError('Período no encontrado', 404, 'HR_PERIOD_NOT_FOUND');
                const locked = await lockAttendancePeriod(tx, companyId, id);
                current = { ...current, status: locked.status, revision: locked.revision };
                if (current.status === 'CLOSED') throw new HrWorkforceError('El período ya está cerrado', 409, 'HR_PERIOD_ALREADY_CLOSED');
                const instants = periodInstantBounds(current.dateFrom, current.dateTo, current.timezone);
                const [critical, pendingCorrections, overtime, leave, attendanceReviews] = await Promise.all([
                    tx.attendanceIncident.count({ where: { companyId, status: 'OPEN', severity: 'CRITICAL', date: { gte: current.dateFrom, lte: current.dateTo } } }),
                    tx.attendanceCorrection.findMany({
                        where: { companyId, status: 'PENDING' },
                        select: {
                            dailySummary: { select: { date: true, timezone: true } },
                            requestedOccurredAt: true,
                            requestedTimezone: true,
                            requestedBranch: { select: { timezone: true } },
                            targetEvent: {
                                select: {
                                    serverAt: true,
                                    branch: { select: { timezone: true } },
                                },
                            },
                        },
                    }),
                    tx.overtimeRequest.count({ where: { companyId, status: 'PENDING', date: { gte: current.dateFrom, lte: current.dateTo } } }),
                    tx.leaveRequest.count({ where: {
                        companyId,
                        status: 'PENDING',
                        startDate: { lte: current.dateTo },
                        endDate: { gte: current.dateFrom },
                    } }),
                    tx.attendanceEvent.count({ where: {
                        companyId,
                        decision: 'REVIEW',
                        review: { is: null },
                        serverAt: { gte: instants.start, lt: instants.end },
                    } }),
                ]);
                const fromKey = dateKey(current.dateFrom);
                const toKey = dateKey(current.dateTo);
                const inPeriod = (value: Date, timezone: string) => {
                    const key = zonedDateKey(value, timezone);
                    return key >= fromKey && key <= toKey;
                };
                const corrections = pendingCorrections.filter(correction => {
                    if (correction.dailySummary) {
                        const key = dateKey(correction.dailySummary.date);
                        if (key >= fromKey && key <= toKey) return true;
                    }
                    if (correction.requestedOccurredAt) {
                        const timezone = correction.requestedBranch?.timezone
                            || correction.dailySummary?.timezone
                            || correction.requestedTimezone
                            || current.timezone;
                        if (inPeriod(correction.requestedOccurredAt, timezone)) return true;
                    }
                    return Boolean(
                        correction.targetEvent
                        && inPeriod(
                            correction.targetEvent.serverAt,
                            correction.targetEvent.branch?.timezone || current.timezone,
                        )
                    );
                }).length;
                if (critical || corrections || overtime || leave || attendanceReviews) {
                    if (attendanceReviews) {
                        throw new HrWorkforceError(`No se puede cerrar: ${attendanceReviews} marcajes pendientes de revisión`, 409, 'HR_PERIOD_PENDING_ATTENDANCE_REVIEWS');
                    }
                    throw new HrWorkforceError(`No se puede cerrar: ${critical} incidencias críticas, ${corrections} correcciones, ${overtime} horas extra y ${leave} ausencias pendientes`, 409, 'HR_PERIOD_PENDING_ITEMS');
                }
                const changed = await tx.attendancePeriod.updateMany({
                    where: { id, companyId, status: { in: ['OPEN', 'REOPENED'] }, revision: current.revision },
                    data: { status: 'CLOSED', closedById: actorId, closedAt: new Date(), payrollEligible: true, lastActionReason: reason, revision: { increment: 1 } },
                });
                if (changed.count !== 1) throw new HrWorkforceError('El período cambió concurrentemente', 409, 'HR_PERIOD_CAS_CONFLICT');
                await tx.attendanceDailySummary.updateMany({ where: { companyId, date: { gte: current.dateFrom, lte: current.dateTo } }, data: { periodId: id } });
                await AuditLogService.log({ companyId, userId: actorId, entityType: 'AttendancePeriod', entityId: id, action: 'UPDATE', details: { transition: `${current.status}->CLOSED`, reason, payrollEligible: true } }, tx);
                const updated = await tx.attendancePeriod.findUniqueOrThrow({ where: { id }, include: { _count: { select: { summaries: true } } } });
                return { entityId: id, value: periodApi(updated, { unresolvedIncidentCount: 0, pendingCorrectionCount: 0, pendingOvertimeCount: 0, pendingLeaveCount: 0 }) };
            },
        });
    }

    static async reopen(id: number, companyId: number, actorId: number, reasonValue: unknown, idempotencyKey: string) {
        const reason = requiredText(reasonValue, 'reason');
        return idempotent({
            companyId, key: idempotencyKey, operation: `PERIOD_REOPEN:${id}`, entityType: 'AttendancePeriod', payload: { id, reason },
            load: entityId => periodWithCounts(entityId, companyId),
            execute: async tx => {
                let current = await tx.attendancePeriod.findFirst({ where: { id, companyId } });
                if (!current) throw new HrWorkforceError('Período no encontrado', 404, 'HR_PERIOD_NOT_FOUND');
                const locked = await lockAttendancePeriod(tx, companyId, id);
                current = { ...current, status: locked.status, revision: locked.revision };
                if (current.status !== 'CLOSED') throw new HrWorkforceError('Solo un período cerrado puede reabrirse', 409, 'HR_PERIOD_NOT_CLOSED');
                const payrollDependency = await tx.payrollAttendanceDependency.findFirst({ where: { companyId, attendancePeriodId: id, run: { status: { not: 'VOID' } } }, select: { runId: true } });
                if (payrollDependency) throw new HrWorkforceError(`No se puede reabrir: la corrida de nómina ${payrollDependency.runId} depende de este período y no está VOID`, 409, 'HR_PERIOD_USED_BY_PAYROLL');
                const changed = await tx.attendancePeriod.updateMany({
                    where: { id, companyId, status: 'CLOSED', revision: current.revision },
                    data: { status: 'REOPENED', reopenedById: actorId, reopenedAt: new Date(), payrollEligible: false, lastActionReason: reason, revision: { increment: 1 } },
                });
                if (changed.count !== 1) throw new HrWorkforceError('El período cambió concurrentemente', 409, 'HR_PERIOD_CAS_CONFLICT');
                await AuditLogService.log({ companyId, userId: actorId, entityType: 'AttendancePeriod', entityId: id, action: 'UPDATE', details: { transition: 'CLOSED->REOPENED', reason, payrollEligible: false } }, tx);
                const updated = await tx.attendancePeriod.findUniqueOrThrow({ where: { id }, include: { _count: { select: { summaries: true } } } });
                return { entityId: id, value: periodApi(updated) };
            },
        });
    }
}

async function correctionById(id: number, companyId: number) {
    const correction = await prisma.attendanceCorrection.findFirst({ where: { id, companyId }, include: correctionInclude });
    return correction ? correctionApi(correction) : null;
}

function assertCanonicalSequence(events: Array<{ action: AttendanceAction; occurredAt: Date; id: number }>) {
    const prior: Array<{ action: AttendanceAction }> = [];
    for (const event of [...events].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id - right.id)) {
        if (!availableActionsFrom(prior).includes(event.action)) {
            throw new HrWorkforceError('La corrección produciría una secuencia de marcaje inválida', 409, 'HR_CORRECTION_INVALID_SEQUENCE');
        }
        prior.push({ action: event.action });
    }
}

async function effectiveCorrectionSession(
    tx: Prisma.TransactionClient,
    companyId: number,
    userId: number,
    sessionKey: string,
) {
    const events = await tx.attendanceEvent.findMany({
        where: { companyId, userId, sessionKey },
        include: {
            review: { select: { decision: true } },
            targetedCorrections: {
                where: { status: 'APPLIED' },
                select: { type: true, status: true, requestedOccurredAt: true, requestedBranchId: true, compensationEventId: true },
            },
        },
        orderBy: [{ serverAt: 'asc' }, { id: 'asc' }],
    });
    return effectiveEvents(events);
}

export class AttendanceCorrectionService {
    static async list(companyId: number, filters: { userId?: number; status?: string; page?: number; limit?: number }) {
        const current = page(filters);
        const where: Prisma.AttendanceCorrectionWhereInput = { companyId, userId: filters.userId, status: filters.status as AttendanceCorrectionStatus | undefined };
        const [items, total] = await Promise.all([
            prisma.attendanceCorrection.findMany({ where, include: correctionInclude, orderBy: { createdAt: 'desc' }, skip: current.skip, take: current.limit }),
            prisma.attendanceCorrection.count({ where }),
        ]);
        return { items: items.map(correctionApi), pagination: pagination(total, current) };
    }

    static async create(companyId: number, actorId: number, body: Record<string, unknown>, idempotencyKey: string, forcedUserId?: number) {
        const type = requiredText(body.type, 'type', 32) as AttendanceCorrectionType;
        if (!['ADD_PUNCH', 'VOID_PUNCH', 'CHANGE_TIME', 'ASSIGN_BRANCH', 'OTHER'].includes(type)) throw new HrWorkforceError('type inválido');
        const reason = requiredText(body.reason, 'reason');
        const requestedAction = body.requestedAction === undefined
            ? null
            : requiredText(body.requestedAction, 'requestedAction', 32) as AttendanceAction;
        if (requestedAction && !['CHECK_IN', 'BREAK_START', 'BREAK_END', 'CHECK_OUT'].includes(requestedAction)) {
            throw new HrWorkforceError('requestedAction inválida');
        }
        if (type === 'ADD_PUNCH' && !requestedAction) {
            throw new HrWorkforceError('requestedAction es requerida para ADD_PUNCH');
        }
        const requestedBranchId = body.requestedBranchId ? positiveId(body.requestedBranchId, 'requestedBranchId') : null;
        if (type === 'ASSIGN_BRANCH' && !requestedBranchId) throw new HrWorkforceError('requestedBranchId es requerido para ASSIGN_BRANCH');
        const requestedBranch = await ensureBranch(companyId, requestedBranchId);
        const dailySummaryId = body.dailySummaryId ? positiveId(body.dailySummaryId, 'dailySummaryId') : null;
        const incidentId = body.incidentId ? positiveId(body.incidentId, 'incidentId') : null;
        const targetEventId = body.targetEventId ? positiveId(body.targetEventId, 'targetEventId') : null;
        if (['VOID_PUNCH', 'CHANGE_TIME', 'ASSIGN_BRANCH'].includes(type) && !targetEventId) throw new HrWorkforceError('targetEventId es requerido para este tipo');
        const [summary, incident, event] = await Promise.all([
            dailySummaryId ? prisma.attendanceDailySummary.findFirst({ where: { id: dailySummaryId, companyId } }) : null,
            incidentId ? prisma.attendanceIncident.findFirst({ where: { id: incidentId, companyId } }) : null,
            targetEventId ? prisma.attendanceEvent.findFirst({ where: { id: targetEventId, companyId } }) : null,
        ]);
        if (dailySummaryId && !summary) throw new HrWorkforceError('Resumen diario no encontrado', 404);
        if (incidentId && !incident) throw new HrWorkforceError('Incidencia no encontrada', 404);
        if (targetEventId && !event) throw new HrWorkforceError('Marcaje objetivo no encontrado', 404);
        const userId = forcedUserId || (body.userId ? positiveId(body.userId, 'userId') : summary?.userId || incident?.userId || event?.userId || actorId);
        const user = await ensureUser(companyId, userId);
        if ([summary?.userId, incident?.userId, event?.userId].some(value => value && value !== userId)) throw new HrWorkforceError('Las referencias no pertenecen al mismo usuario', 409);
        const eventBranch = event?.branchId ? await ensureBranch(companyId, event.branchId) : null;
        const userBranch = user.branchId ? await ensureBranch(companyId, user.branchId) : null;
        const canonicalTimezone = requestedBranch?.timezone || summary?.timezone || eventBranch?.timezone || userBranch?.timezone;
        if (['ADD_PUNCH', 'CHANGE_TIME'].includes(type) && !canonicalTimezone) {
            throw new HrWorkforceError('No existe una sucursal autoritativa para interpretar la hora solicitada', 409, 'HR_CORRECTION_TIMEZONE_CONTEXT_REQUIRED');
        }
        if (
            body.requestedTimezone !== undefined
            && canonicalTimezone
            && requiredText(body.requestedTimezone, 'requestedTimezone', 64) !== canonicalTimezone
        ) {
            throw new HrWorkforceError('La zona horaria solicitada no coincide con la sucursal autoritativa', 409, 'HR_CORRECTION_TIMEZONE_MISMATCH');
        }
        const requested = localDateTime(body.requestedOccurredAt, canonicalTimezone);
        if (['ADD_PUNCH', 'CHANGE_TIME'].includes(type) && !requested) throw new HrWorkforceError('requestedOccurredAt es requerido para este tipo');
        const effectiveInstant = requested?.instant || event?.serverAt || (summary ? new Date(`${dateKey(summary.date)}T12:00:00Z`) : new Date());
        const effectiveDate = summary?.date || dateValue(zonedDateKey(effectiveInstant, canonicalTimezone || 'America/Managua'), 'date');
        await assertDatesOpen(companyId, effectiveDate, effectiveDate);
        let sourceDate: Date | null = null;
        if (event && ['VOID_PUNCH', 'CHANGE_TIME', 'ASSIGN_BRANCH'].includes(type)) {
            sourceDate = dateValue(zonedDateKey(event.serverAt, eventBranch?.timezone || canonicalTimezone || 'America/Managua'), 'date');
            await assertDatesOpen(companyId, sourceDate, sourceDate);
        }
        const payload = {
            userId, dailySummaryId, incidentId, targetEventId, type, requestedAction,
            requestedOccurredAt: requested?.instant.toISOString(), requestedTimezone: requested?.timezone,
            requestedBranchId, reason,
        };
        return idempotent({
            companyId, key: idempotencyKey, operation: 'CORRECTION_CREATE', entityType: 'AttendanceCorrection', payload,
            load: id => correctionById(id, companyId),
            execute: async tx => {
                await assertDatesOpen(companyId, effectiveDate, effectiveDate, tx);
                if (sourceDate) await assertDatesOpen(companyId, sourceDate, sourceDate, tx);
                const created = await tx.attendanceCorrection.create({ data: {
                    companyId, userId, dailySummaryId, incidentId, targetEventId, type, requestedAction,
                    requestedOccurredAt: requested?.instant, requestedTimezone: requested?.timezone,
                    requestedBranchId, reason, status: 'PENDING', requestedById: actorId,
                }, include: correctionInclude });
                await AuditLogService.log({ companyId, userId: actorId, entityType: 'AttendanceCorrection', entityId: created.id, action: 'CREATE', details: { type, userId, reason, status: 'PENDING' } }, tx);
                return { entityId: created.id, value: correctionApi(created) };
            },
        });
    }

    static async decide(id: number, companyId: number, actorId: number, decisionValue: unknown, reasonValue: unknown, idempotencyKey: string) {
        const decision = requiredText(decisionValue, 'decision', 16) as Decision;
        if (!['APPROVED', 'REJECTED'].includes(decision)) throw new HrWorkforceError('decision inválida');
        const reason = requiredText(reasonValue, 'reason');
        return idempotent({
            companyId, key: idempotencyKey, operation: `CORRECTION_DECIDE:${id}`, entityType: 'AttendanceCorrection', payload: { id, decision, reason },
            load: entityId => correctionById(entityId, companyId),
            execute: async tx => {
                const current = await tx.attendanceCorrection.findFirst({
                    where: { id, companyId }, include: { targetEvent: true, dailySummary: true, requestedBranch: true },
                });
                if (!current) throw new HrWorkforceError('Corrección no encontrada', 404, 'HR_CORRECTION_NOT_FOUND');
                if (current.status !== 'PENDING') throw new HrWorkforceError('La corrección ya fue decidida', 409, 'HR_WORKFLOW_CAS_CONFLICT');
                if (actorId === current.userId) {
                    throw new HrWorkforceError('Una persona no puede decidir su propia corrección', 409, 'HR_SELF_APPROVAL_FORBIDDEN');
                }
                const subjectUser = await ensureUser(companyId, current.userId, tx);
                const targetBranch = current.targetEvent?.branchId
                    ? await ensureBranch(companyId, current.targetEvent.branchId, tx)
                    : null;
                const subjectBranch = subjectUser.branchId
                    ? await ensureBranch(companyId, subjectUser.branchId, tx)
                    : null;
                const timezone = current.requestedBranch?.timezone
                    || current.dailySummary?.timezone
                    || targetBranch?.timezone
                    || subjectBranch?.timezone;
                if (current.requestedOccurredAt && !timezone) {
                    throw new HrWorkforceError('No existe una sucursal autoritativa para interpretar la correccion', 409, 'HR_CORRECTION_TIMEZONE_CONTEXT_REQUIRED');
                }
                if (current.requestedTimezone && timezone && current.requestedTimezone !== timezone) {
                    throw new HrWorkforceError('La zona horaria almacenada no coincide con la sucursal autoritativa', 409, 'HR_CORRECTION_TIMEZONE_MISMATCH');
                }
                const instant = current.requestedOccurredAt || current.targetEvent?.serverAt || (current.dailySummary ? new Date(`${dateKey(current.dailySummary.date)}T12:00:00Z`) : new Date());
                const effectiveDate = current.dailySummary?.date || dateValue(zonedDateKey(instant, timezone || 'America/Managua'), 'date');
                await assertDatesOpen(companyId, effectiveDate, effectiveDate, tx);
                if (current.targetEvent && ['VOID_PUNCH', 'CHANGE_TIME', 'ASSIGN_BRANCH'].includes(current.type)) {
                    const sourceDate = dateValue(zonedDateKey(current.targetEvent.serverAt, targetBranch?.timezone || timezone || 'America/Managua'), 'date');
                    await assertDatesOpen(companyId, sourceDate, sourceDate, tx);
                }
                let compensationEventId: number | null = null;
                if (decision === 'APPROVED' && current.targetEventId) {
                    const conflicting = await tx.attendanceCorrection.findFirst({
                        where: {
                            companyId,
                            targetEventId: current.targetEventId,
                            id: { not: id },
                            status: 'APPLIED',
                            type: { in: ['VOID_PUNCH', 'CHANGE_TIME', 'ASSIGN_BRANCH'] },
                        },
                        select: { id: true },
                    });
                    if (conflicting && ['VOID_PUNCH', 'CHANGE_TIME', 'ASSIGN_BRANCH'].includes(current.type)) {
                        throw new HrWorkforceError('El marcaje ya tiene una corrección incompatible aplicada', 409, 'HR_CORRECTION_CONFLICT');
                    }
                }
                if (decision === 'APPROVED' && ['ADD_PUNCH', 'VOID_PUNCH', 'CHANGE_TIME', 'ASSIGN_BRANCH'].includes(current.type)) {
                    const action = current.type === 'ADD_PUNCH'
                        ? current.requestedAction
                        : current.targetEvent?.action;
                    if (!action) throw new HrWorkforceError('No se pudo inferir la acción compensatoria', 409);
                    const branchId = current.requestedBranchId || current.targetEvent?.branchId || subjectUser.branchId;
                    await ensureBranch(companyId, branchId, tx);
                    let scheduledShiftId = current.targetEvent?.scheduledShiftId || null;
                    let sessionKey = current.targetEvent?.sessionKey || null;
                    if (!scheduledShiftId && current.type === 'ADD_PUNCH') {
                        const shift = await tx.scheduledShift.findFirst({
                            where: {
                                companyId, branchId: branchId || undefined, status: 'SCHEDULED',
                                schedule: { status: 'PUBLISHED' },
                                startAt: { lte: instant }, endAt: { gte: instant },
                                OR: [
                                    { userId: current.userId, assignmentOverride: null },
                                    { assignmentOverride: { assignedUserId: current.userId } },
                                ],
                            },
                            select: { id: true },
                        });
                        if (!shift) throw new HrWorkforceError('ADD_PUNCH requiere un turno publicado aplicable', 409, 'HR_CORRECTION_PUBLISHED_SHIFT_REQUIRED');
                        scheduledShiftId = shift.id;
                    }
                    sessionKey = sessionKey || (scheduledShiftId
                        ? `SHIFT:${scheduledShiftId}`
                        : `LEGACY:${current.userId}:${branchId || 'NONE'}:${instant.toISOString().slice(0, 10)}`);
                    const effective = await effectiveCorrectionSession(tx, companyId, current.userId, sessionKey);
                    const simulated = current.targetEventId
                        ? effective.filter(event => event.id !== current.targetEventId)
                        : effective;
                    if (current.type !== 'VOID_PUNCH') {
                        simulated.push({
                            id: Number.MAX_SAFE_INTEGER, action, occurredAt: instant,
                            branchId: branchId || null, scheduledShiftId, sessionKey,
                        });
                    }
                    assertCanonicalSequence(simulated.map(event => ({ id: event.id, action: event.action, occurredAt: event.occurredAt })));
                    if (current.type !== 'VOID_PUNCH') {
                    const event = await tx.attendanceEvent.create({ data: {
                        companyId, userId: current.userId, actorUserId: actorId, branchId,
                        scheduledShiftId, sessionKey,
                        sequenceKey: `${sessionKey}:CORRECTION:${current.id}`,
                        geofenceVersionId: current.targetEvent?.geofenceVersionId,
                        policyId: current.targetEvent?.policyId,
                        policyVersion: current.targetEvent?.policyVersion,
                        adjustsEventId: current.targetEventId,
                        idempotencyKey: `workforce-correction:${current.id}:${current.revision + 1}`,
                        requestHash: requestHash({ correctionId: current.id, action, instant: instant.toISOString(), branchId }),
                        action, source: 'MANUAL', serverAt: instant, clientAt: instant,
                        faceStatus: 'NOT_REQUIRED', livenessStatus: 'NOT_REQUIRED', providerStatus: 'MANUAL_CORRECTION', decision: 'ACCEPTED',
                        reasonCode: current.type, reasonCodes: [current.type], message: `${current.reason}\nAprobación: ${reason}`,
                    } });
                    compensationEventId = event.id;
                    }
                }
                const status: AttendanceCorrectionStatus = decision === 'APPROVED' ? 'APPLIED' : 'REJECTED';
                const changed = await tx.attendanceCorrection.updateMany({
                    where: { id, companyId, status: 'PENDING', revision: current.revision },
                    data: { status, decidedById: actorId, decisionReason: reason, decidedAt: new Date(), appliedAt: decision === 'APPROVED' ? new Date() : null, compensationEventId, revision: { increment: 1 } },
                });
                if (changed.count !== 1) throw new HrWorkforceError('La corrección cambió concurrentemente', 409, 'HR_WORKFLOW_CAS_CONFLICT');
                if (decision === 'APPROVED' && current.incidentId) {
                    await tx.attendanceIncident.updateMany({ where: { id: current.incidentId, companyId, status: 'OPEN' }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: actorId } });
                }
                await AuditLogService.log({ companyId, userId: actorId, entityType: 'AttendanceCorrection', entityId: id, action: 'UPDATE', details: { transition: `PENDING->${status}`, reason, compensationEventId } }, tx);
                const updated = await tx.attendanceCorrection.findUniqueOrThrow({ where: { id }, include: correctionInclude });
                return { entityId: id, value: correctionApi(updated) };
            },
        });
    }
}

async function overtimeById(id: number, companyId: number) {
    const request = await prisma.overtimeRequest.findFirst({ where: { id, companyId }, include: overtimeInclude });
    return request ? overtimeApi(request) : null;
}

export class OvertimeService {
    static async list(companyId: number, filters: { date?: string; dateFrom?: string; dateTo?: string; userId?: number; status?: string; page?: number; limit?: number }) {
        const current = page(filters);
        const where: Prisma.OvertimeRequestWhereInput = {
            companyId, userId: filters.userId, status: filters.status as OvertimeRequestStatus | undefined,
            date: filters.date ? dateValue(filters.date, 'date') : {
                gte: filters.dateFrom ? dateValue(filters.dateFrom, 'dateFrom') : undefined,
                lte: filters.dateTo ? dateValue(filters.dateTo, 'dateTo') : undefined,
            },
        };
        const [items, total] = await Promise.all([
            prisma.overtimeRequest.findMany({ where, include: overtimeInclude, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: current.skip, take: current.limit }),
            prisma.overtimeRequest.count({ where }),
        ]);
        return { items: items.map(overtimeApi), pagination: pagination(total, current) };
    }

    static async create(companyId: number, actorId: number, body: Record<string, unknown>, idempotencyKey: string, forcedUserId?: number) {
        const userId = forcedUserId || (body.userId ? positiveId(body.userId, 'userId') : actorId);
        const user = await ensureUser(companyId, userId);
        const date = dateValue(body.date, 'date');
        const requestedMinutes = positiveInt(body.requestedMinutes, 'requestedMinutes', 10_080);
        const reason = requiredText(body.reason, 'reason');
        const dailySummaryId = body.dailySummaryId ? positiveId(body.dailySummaryId, 'dailySummaryId') : null;
        await assertDatesOpen(companyId, date, date);
        let summary = dailySummaryId ? await prisma.attendanceDailySummary.findFirst({ where: { id: dailySummaryId, companyId, userId } }) : null;
        if (dailySummaryId && !summary) throw new HrWorkforceError('El resumen diario no pertenece al usuario', 404);
        if (!summary) {
            await AttendanceDerivedService.calculate(companyId, userId, dateKey(date), user.branchId);
            summary = await prisma.attendanceDailySummary.findFirst({ where: { companyId, userId, date }, orderBy: { candidateOvertimeMinutes: 'desc' } });
        }
        const candidateMinutes = summary?.candidateOvertimeMinutes ?? 0;
        const approved = await prisma.overtimeRequest.aggregate({
            where: {
                companyId,
                userId,
                date,
                dailySummaryId: summary?.id,
                status: 'APPROVED',
            },
            _sum: { approvedMinutes: true },
        });
        const remainingCandidateMinutes = Math.max(0, candidateMinutes - Number(approved._sum.approvedMinutes || 0));
        if (requestedMinutes > remainingCandidateMinutes) {
            throw new HrWorkforceError(`Los minutos solicitados exceden el candidato disponible (${remainingCandidateMinutes})`, 409, 'HR_OVERTIME_EXCEEDS_CANDIDATE');
        }
        const payload = { userId, dailySummaryId: summary?.id || null, date: dateKey(date), requestedMinutes, reason };
        return idempotent({
            companyId, key: idempotencyKey, operation: 'OVERTIME_CREATE', entityType: 'OvertimeRequest', payload,
            load: id => overtimeById(id, companyId),
            execute: async tx => {
                await assertDatesOpen(companyId, date, date, tx);
                const open = await tx.overtimeRequest.findFirst({ where: {
                    companyId, userId, date, dailySummaryId: summary?.id, status: 'PENDING',
                } });
                if (open) throw new HrWorkforceError('Ya existe una solicitud pendiente para esa fecha', 409, 'HR_OVERTIME_OVERLAP');
                const approvedInTx = await tx.overtimeRequest.aggregate({
                    where: {
                        companyId,
                        userId,
                        date,
                        dailySummaryId: summary?.id,
                        status: 'APPROVED',
                    },
                    _sum: { approvedMinutes: true },
                });
                const remainingInTx = Math.max(0, candidateMinutes - Number(approvedInTx._sum.approvedMinutes || 0));
                if (requestedMinutes > remainingInTx) {
                    throw new HrWorkforceError(`Los minutos solicitados exceden el candidato disponible (${remainingInTx})`, 409, 'HR_OVERTIME_EXCEEDS_CANDIDATE');
                }
                const created = await tx.overtimeRequest.create({ data: {
                    companyId, userId, dailySummaryId: summary?.id, date, candidateMinutes,
                    summarySourceRevision: summary?.sourceRevision,
                    requestedMinutes, reason, status: 'PENDING', requestedById: actorId,
                }, include: overtimeInclude });
                await AuditLogService.log({ companyId, userId: actorId, entityType: 'OvertimeRequest', entityId: created.id, action: 'CREATE', details: { userId, date: dateKey(date), requestedMinutes, candidateMinutes, status: 'PENDING' } }, tx);
                return { entityId: created.id, value: overtimeApi(created) };
            },
        });
    }

    static async decide(id: number, companyId: number, actorId: number, body: Record<string, unknown>, idempotencyKey: string) {
        const decision = requiredText(body.decision, 'decision', 16) as Decision;
        if (!['APPROVED', 'REJECTED'].includes(decision)) throw new HrWorkforceError('decision inválida');
        const reason = requiredText(body.reason, 'reason');
        return idempotent({
            companyId, key: idempotencyKey, operation: `OVERTIME_DECIDE:${id}`, entityType: 'OvertimeRequest', payload: { id, decision, reason, approvedMinutes: body.approvedMinutes },
            load: entityId => overtimeById(entityId, companyId),
            execute: async tx => {
                const current = await tx.overtimeRequest.findFirst({ where: { id, companyId } });
                if (!current) throw new HrWorkforceError('Solicitud de horas extra no encontrada', 404);
                if (current.status !== 'PENDING') throw new HrWorkforceError('La solicitud ya fue decidida', 409, 'HR_WORKFLOW_CAS_CONFLICT');
                if (actorId === current.userId) {
                    throw new HrWorkforceError('Una persona no puede decidir sus propias horas extra', 409, 'HR_SELF_APPROVAL_FORBIDDEN');
                }
                await assertDatesOpen(companyId, current.date, current.date, tx);
                const approvedMinutes = decision === 'APPROVED'
                    ? (body.approvedMinutes === undefined ? current.requestedMinutes : positiveInt(body.approvedMinutes, 'approvedMinutes', current.requestedMinutes))
                    : null;
                if (approvedMinutes && approvedMinutes > current.requestedMinutes) throw new HrWorkforceError('approvedMinutes no puede exceder requestedMinutes');
                if (decision === 'APPROVED') {
                    const currentSummary = current.dailySummaryId
                        ? await tx.attendanceDailySummary.findFirst({
                            where: { id: current.dailySummaryId, companyId, userId: current.userId },
                            select: { candidateOvertimeMinutes: true, sourceRevision: true },
                        })
                        : null;
                    if (!currentSummary || current.summarySourceRevision !== currentSummary.sourceRevision) {
                        throw new HrWorkforceError('El resumen de asistencia cambió; recalcule y vuelva a solicitar las horas extra', 409, 'HR_OVERTIME_SUMMARY_STALE');
                    }
                    const alreadyApproved = await tx.overtimeRequest.aggregate({
                        where: {
                            companyId,
                            userId: current.userId,
                            date: current.date,
                            dailySummaryId: current.dailySummaryId,
                            id: { not: id },
                            status: 'APPROVED',
                        },
                        _sum: { approvedMinutes: true },
                    });
                    const approvedTotal = Number(alreadyApproved._sum.approvedMinutes || 0) + Number(approvedMinutes || 0);
                    const candidate = currentSummary.candidateOvertimeMinutes;
                    if (approvedTotal > candidate) {
                        throw new HrWorkforceError(`La aprobación excede el candidato calculado (${candidate} minutos)`, 409, 'HR_OVERTIME_EXCEEDS_CANDIDATE');
                    }
                }
                const status: OvertimeRequestStatus = decision;
                const changed = await tx.overtimeRequest.updateMany({
                    where: { id, companyId, status: 'PENDING', revision: current.revision },
                    data: { status, approvedMinutes, decidedById: actorId, decisionReason: reason, decidedAt: new Date(), revision: { increment: 1 } },
                });
                if (changed.count !== 1) throw new HrWorkforceError('La solicitud cambió concurrentemente', 409, 'HR_WORKFLOW_CAS_CONFLICT');
                if (decision === 'APPROVED' && current.dailySummaryId) {
                    const approved = await tx.overtimeRequest.aggregate({ where: { dailySummaryId: current.dailySummaryId, status: 'APPROVED' }, _sum: { approvedMinutes: true } });
                    await tx.attendanceDailySummary.update({ where: { id: current.dailySummaryId }, data: { approvedOvertimeMinutes: approved._sum.approvedMinutes || 0, sourceRevision: { increment: 1 } } });
                }
                await AuditLogService.log({ companyId, userId: actorId, entityType: 'OvertimeRequest', entityId: id, action: 'UPDATE', details: { transition: `PENDING->${status}`, approvedMinutes, reason } }, tx);
                const updated = await tx.overtimeRequest.findUniqueOrThrow({ where: { id }, include: overtimeInclude });
                return { entityId: id, value: overtimeApi(updated) };
            },
        });
    }

    static async cancel(id: number, companyId: number, actorId: number, reasonValue: unknown, idempotencyKey: string, selfOnly = false) {
        const reason = requiredText(reasonValue, 'reason');
        return idempotent({
            companyId, key: idempotencyKey, operation: `OVERTIME_CANCEL:${id}`, entityType: 'OvertimeRequest', payload: { id, reason },
            load: entityId => overtimeById(entityId, companyId),
            execute: async tx => {
                const current = await tx.overtimeRequest.findFirst({ where: { id, companyId, ...(selfOnly ? { userId: actorId } : {}) } });
                if (!current) throw new HrWorkforceError('Solicitud de horas extra no encontrada', 404);
                if (current.status !== 'PENDING') throw new HrWorkforceError('Solo una solicitud pendiente puede cancelarse', 409, 'HR_WORKFLOW_CAS_CONFLICT');
                await assertDatesOpen(companyId, current.date, current.date, tx);
                const changed = await tx.overtimeRequest.updateMany({ where: { id, companyId, status: 'PENDING', revision: current.revision }, data: {
                    status: 'CANCELLED', cancelledAt: new Date(), decisionReason: reason, revision: { increment: 1 },
                } });
                if (changed.count !== 1) throw new HrWorkforceError('La solicitud cambió concurrentemente', 409, 'HR_WORKFLOW_CAS_CONFLICT');
                await AuditLogService.log({ companyId, userId: actorId, entityType: 'OvertimeRequest', entityId: id, action: 'CANCEL', details: { reason } }, tx);
                const updated = await tx.overtimeRequest.findUniqueOrThrow({ where: { id }, include: overtimeInclude });
                return { entityId: id, value: overtimeApi(updated) };
            },
        });
    }
}

function unitValue(value: unknown): VacationBalanceUnit {
    const unit = requiredText(value, 'unit', 16) as VacationBalanceUnit;
    if (!['DAYS', 'HOURS', 'MINUTES'].includes(unit)) throw new HrWorkforceError('unit inválido');
    return unit;
}

function fractionValue(value: unknown): LeaveFraction {
    const fraction = requiredText(value, 'fraction', 16) as LeaveFraction;
    if (!['FULL_DAY', 'HALF_DAY', 'HOURS'].includes(fraction)) throw new HrWorkforceError('fraction inválida');
    return fraction;
}

export function leaveAmount(from: Date, to: Date, fraction: LeaveFraction, startTime: string | null, endTime: string | null, unit: VacationBalanceUnit): number {
    const days = dateRangeKeys(from, to).length;
    let workDays: number;
    if (fraction === 'FULL_DAY') workDays = days;
    else if (fraction === 'HALF_DAY') {
        if (!startTime || !endTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
            throw new HrWorkforceError('startTime y endTime HH:mm son requeridos para HALF_DAY');
        }
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        const halfDayMinutes = endH * 60 + endM - (startH * 60 + startM);
        if (halfDayMinutes !== 240) {
            throw new HrWorkforceError('HALF_DAY debe indicar un intervalo exacto de 4 horas');
        }
        workDays = days * 0.5;
    } else {
        if (days !== 1) throw new HrWorkforceError('Una ausencia por horas debe iniciar y finalizar el mismo día');
        if (!startTime || !endTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
            throw new HrWorkforceError('startTime y endTime HH:mm son requeridos para HOURS');
        }
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        const minutes = endH * 60 + endM - (startH * 60 + startM);
        if (minutes <= 0) throw new HrWorkforceError('endTime debe ser posterior a startTime');
        if (unit === 'MINUTES') return minutes;
        if (unit === 'HOURS') return minutes / 60;
        return minutes / 480;
    }
    if (unit === 'DAYS') return workDays;
    if (unit === 'HOURS') return workDays * 8;
    return workDays * 480;
}

function leaveRequestsOverlap(left: {
    startDate: Date; endDate: Date; fraction: LeaveFraction; startTime: string | null; endTime: string | null;
}, right: {
    startDate: Date; endDate: Date; fraction: LeaveFraction; startTime: string | null; endTime: string | null;
}) {
    if (left.startDate > right.endDate || left.endDate < right.startDate) return false;
    const sameSingleDay = dateKey(left.startDate) === dateKey(left.endDate)
        && dateKey(right.startDate) === dateKey(right.endDate)
        && dateKey(left.startDate) === dateKey(right.startDate);
    if (
        sameSingleDay
        && ['HOURS', 'HALF_DAY'].includes(left.fraction)
        && ['HOURS', 'HALF_DAY'].includes(right.fraction)
        && left.startTime && left.endTime && right.startTime && right.endTime
    ) {
        return left.startTime < right.endTime && left.endTime > right.startTime;
    }
    return true;
}

function assertLeaveEvidenceFlow(leaveType: { requiresAttachment: boolean }) {
    if (!leaveType.requiresAttachment) return;
    throw new HrWorkforceError(
        'Este tipo exige evidencia, pero el repositorio documental seguro aun no esta habilitado',
        409,
        'HR_LEAVE_EVIDENCE_FLOW_REQUIRED',
    );
}

async function ensureBalance(companyId: number, userId: number, leaveTypeId: number | null, unit: VacationBalanceUnit, asOf: Date, db: Db = prisma) {
    const scopeKey = leaveTypeId ? `LEAVE_TYPE:${leaveTypeId}` : `GENERIC:${unit}`;
    const balance = await db.vacationBalance.upsert({
        where: { companyId_userId_scopeKey: { companyId, userId, scopeKey } },
        create: { companyId, userId, leaveTypeId, scopeKey, unit, asOf },
        update: { sourceRevision: { increment: 1 } },
    });
    if (balance.asOf < asOf) {
        return db.vacationBalance.update({ where: { id: balance.id }, data: { asOf } });
    }
    return balance;
}

async function ledgerBalance(balanceId: number, db: Db = prisma) {
    const total = await db.vacationLedgerEntry.aggregate({ where: { balanceId }, _sum: { amount: true } });
    return Number(total._sum.amount || 0);
}

export class LeaveTypeService {
    static async list(companyId: number, active?: boolean) {
        const items = await prisma.leaveType.findMany({ where: { companyId, active }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
        return items.map(leaveTypeApi);
    }

    static async create(companyId: number, actorId: number, body: Record<string, unknown>) {
        const code = requiredText(body.code, 'code', 50).toUpperCase();
        const name = requiredText(body.name, 'name', 100);
        const data = {
            companyId, code, name, description: optionalText(body.description, 5000),
            paid: body.paid === true, active: body.active === undefined ? true : body.active === true,
            balanceTracked: body.balanceTracked === true, unit: unitValue(body.unit), requiresAttachment: body.requiresAttachment === true,
        };
        const created = await prisma.$transaction(async tx => {
            const item = await tx.leaveType.create({ data });
            await AuditLogService.log({ companyId, userId: actorId, entityType: 'LeaveType', entityId: item.id, action: 'CREATE', details: { code, name } }, tx);
            return item;
        });
        return leaveTypeApi(created);
    }

    static async update(id: number, companyId: number, actorId: number, body: Record<string, unknown>) {
        const current = await prisma.leaveType.findFirst({ where: { id, companyId } });
        if (!current) throw new HrWorkforceError('Tipo de permiso no encontrado', 404);
        const data: Prisma.LeaveTypeUpdateInput = {
            code: body.code === undefined ? undefined : requiredText(body.code, 'code', 50).toUpperCase(),
            name: body.name === undefined ? undefined : requiredText(body.name, 'name', 100),
            description: body.description === undefined ? undefined : optionalText(body.description, 5000),
            paid: body.paid === undefined ? undefined : body.paid === true,
            active: body.active === undefined ? undefined : body.active === true,
            balanceTracked: body.balanceTracked === undefined ? undefined : body.balanceTracked === true,
            unit: body.unit === undefined ? undefined : unitValue(body.unit),
            requiresAttachment: body.requiresAttachment === undefined ? undefined : body.requiresAttachment === true,
        };
        if (body.unit && body.unit !== current.unit) {
            const ledgerCount = await prisma.vacationLedgerEntry.count({ where: { balance: { leaveTypeId: id } } });
            if (ledgerCount) throw new HrWorkforceError('No se puede cambiar la unidad de un tipo con movimientos de saldo', 409);
        }
        const changesPayrollMeaning =
            (body.paid !== undefined && body.paid !== current.paid) ||
            (body.balanceTracked !== undefined && body.balanceTracked !== current.balanceTracked) ||
            (body.unit !== undefined && body.unit !== current.unit);
        if (changesPayrollMeaning) {
            const approvedHistory = await prisma.leaveRequest.count({
                where: { companyId, leaveTypeId: id, status: 'APPROVED' },
            });
            if (approvedHistory) {
                throw new HrWorkforceError('No se puede alterar la semántica de un tipo con ausencias aprobadas; cree un tipo nuevo', 409, 'HR_LEAVE_TYPE_HISTORY_IMMUTABLE');
            }
        }
        const updated = await prisma.$transaction(async tx => {
            const item = await tx.leaveType.update({ where: { id }, data });
            await AuditLogService.log({ companyId, userId: actorId, entityType: 'LeaveType', entityId: id, action: 'UPDATE', details: { fields: Object.keys(body) } }, tx);
            return item;
        });
        return leaveTypeApi(updated);
    }
}

export class LeaveRequestService {
    static async list(companyId: number, filters: { dateFrom?: string; dateTo?: string; branchId?: number; userId?: number; status?: string; page?: number; limit?: number }) {
        const current = page(filters);
        const where: Prisma.LeaveRequestWhereInput = {
            companyId, userId: filters.userId, branchId: filters.branchId, status: filters.status as LeaveRequestStatus | undefined,
            startDate: filters.dateTo ? { lte: dateValue(filters.dateTo, 'dateTo') } : undefined,
            endDate: filters.dateFrom ? { gte: dateValue(filters.dateFrom, 'dateFrom') } : undefined,
        };
        const [items, total] = await Promise.all([
            prisma.leaveRequest.findMany({ where, include: leaveRequestInclude, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], skip: current.skip, take: current.limit }),
            prisma.leaveRequest.count({ where }),
        ]);
        return { items: items.map(leaveRequestApi), pagination: pagination(total, current) };
    }

    static async create(companyId: number, actorId: number, body: Record<string, unknown>, forcedUserId?: number) {
        const userId = forcedUserId || (body.userId ? positiveId(body.userId, 'userId') : actorId);
        const user = await ensureUser(companyId, userId);
        const leaveTypeId = positiveId(body.leaveTypeId, 'leaveTypeId');
        const leaveType = await prisma.leaveType.findFirst({ where: { id: leaveTypeId, companyId, active: true } });
        if (!leaveType) throw new HrWorkforceError('Tipo de permiso no encontrado o inactivo', 404);
        assertLeaveEvidenceFlow(leaveType);
        const startDate = dateValue(body.startDate, 'startDate');
        const endDate = dateValue(body.endDate, 'endDate');
        dateRangeKeys(startDate, endDate);
        const fraction = fractionValue(body.fraction);
        const startTime = optionalText(body.startTime, 5);
        const endTime = optionalText(body.endTime, 5);
        const requestedAmount = leaveAmount(startDate, endDate, fraction, startTime, endTime, leaveType.unit);
        const reason = requiredText(body.reason, 'reason');
        await assertDatesOpen(companyId, startDate, endDate);
        const created = await prisma.$transaction(async tx => {
            await assertDatesOpen(companyId, startDate, endDate, tx);
            if (leaveType.balanceTracked) {
                // Provision the type-specific ledger before approval so Owner can
                // accrue/adjust the balance without inventing a generic bucket.
                await ensureBalance(companyId, userId, leaveTypeId, leaveType.unit, startDate, tx);
            }
            const request = await tx.leaveRequest.create({ data: {
                companyId, userId, branchId: user.branchId, leaveTypeId, startDate, endDate, fraction,
                startTime, endTime, requestedAmount, balanceUnit: leaveType.unit, reason,
                status: 'DRAFT', requestedById: actorId,
            }, include: leaveRequestInclude });
            await AuditLogService.log({ companyId, userId: actorId, entityType: 'LeaveRequest', entityId: request.id, action: 'CREATE', details: { userId, leaveTypeId, startDate: dateKey(startDate), endDate: dateKey(endDate), requestedAmount, status: 'DRAFT' } }, tx);
            return request;
        });
        return leaveRequestApi(created);
    }

    static async submit(id: number, companyId: number, actorId: number, selfOnly = false) {
        return prisma.$transaction(async tx => {
            const current = await tx.leaveRequest.findFirst({
                where: { id, companyId, ...(selfOnly ? { userId: actorId } : {}) },
                include: { leaveType: true },
            });
            if (!current) throw new HrWorkforceError('Solicitud de permiso no encontrada', 404);
            if (current.status !== 'DRAFT') throw new HrWorkforceError('Solo un borrador puede enviarse', 409, 'HR_WORKFLOW_CAS_CONFLICT');
            await ensureUser(companyId, current.userId, tx);
            assertLeaveEvidenceFlow(current.leaveType);
            await assertDatesOpen(companyId, current.startDate, current.endDate, tx);
            const overlapCandidates = await tx.leaveRequest.findMany({ where: {
                companyId, userId: current.userId, id: { not: id }, status: { in: ['PENDING', 'APPROVED'] },
                startDate: { lte: current.endDate }, endDate: { gte: current.startDate },
            } });
            const overlap = overlapCandidates.some(candidate => leaveRequestsOverlap(current, candidate));
            if (overlap) throw new HrWorkforceError('La solicitud se solapa con otra ausencia pendiente o aprobada', 409, 'HR_LEAVE_OVERLAP');
            const changed = await tx.leaveRequest.updateMany({ where: { id, companyId, status: 'DRAFT', revision: current.revision }, data: { status: 'PENDING', submittedAt: new Date(), revision: { increment: 1 } } });
            if (changed.count !== 1) throw new HrWorkforceError('La solicitud cambió concurrentemente', 409, 'HR_WORKFLOW_CAS_CONFLICT');
            await AuditLogService.log({ companyId, userId: actorId, entityType: 'LeaveRequest', entityId: id, action: 'UPDATE', details: { transition: 'DRAFT->PENDING' } }, tx);
            return leaveRequestApi(await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: leaveRequestInclude }));
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    static async decide(id: number, companyId: number, actorId: number, decisionValue: unknown, reasonValue: unknown) {
        const decision = requiredText(decisionValue, 'decision', 16) as Decision;
        if (!['APPROVED', 'REJECTED'].includes(decision)) throw new HrWorkforceError('decision inválida');
        const reason = requiredText(reasonValue, 'reason');
        return prisma.$transaction(async tx => {
            const current = await tx.leaveRequest.findFirst({ where: { id, companyId }, include: { leaveType: true } });
            if (!current) throw new HrWorkforceError('Solicitud de permiso no encontrada', 404);
            if (current.status !== 'PENDING') throw new HrWorkforceError('La solicitud ya fue decidida', 409, 'HR_WORKFLOW_CAS_CONFLICT');
            if (actorId === current.userId) {
                throw new HrWorkforceError('Una persona no puede decidir su propia ausencia', 409, 'HR_SELF_APPROVAL_FORBIDDEN');
            }
            await assertDatesOpen(companyId, current.startDate, current.endDate, tx);
            if (decision === 'APPROVED') {
                assertLeaveEvidenceFlow(current.leaveType);
                const overlapCandidates = await tx.leaveRequest.findMany({ where: {
                    companyId, userId: current.userId, id: { not: id }, status: 'APPROVED',
                    startDate: { lte: current.endDate }, endDate: { gte: current.startDate },
                } });
                const overlap = overlapCandidates.some(candidate => leaveRequestsOverlap(current, candidate));
                if (overlap) throw new HrWorkforceError('La ausencia se solapa con otra ya aprobada', 409, 'HR_LEAVE_OVERLAP');
                if (current.leaveType.balanceTracked) {
                    const balance = await ensureBalance(companyId, current.userId, current.leaveTypeId, current.balanceUnit, current.endDate, tx);
                    const available = await ledgerBalance(balance.id, tx);
                    const requested = Number(current.requestedAmount);
                    if (available < requested) throw new HrWorkforceError(`Saldo insuficiente: disponible ${available}, solicitado ${requested}`, 409, 'HR_VACATION_INSUFFICIENT_BALANCE');
                    await tx.vacationLedgerEntry.create({ data: {
                        companyId, balanceId: balance.id, userId: current.userId, leaveRequestId: id,
                        effectiveDate: current.startDate, amount: -requested, unit: current.balanceUnit,
                        type: 'USAGE', reason: `Permiso aprobado: ${current.reason}`, reference: `LEAVE-${id}`,
                        actorId, resultingBalance: available - requested,
                    } });
                }
            }
            const status: LeaveRequestStatus = decision;
            const changed = await tx.leaveRequest.updateMany({ where: { id, companyId, status: 'PENDING', revision: current.revision }, data: {
                status, decidedById: actorId, decisionReason: reason, decidedAt: new Date(), revision: { increment: 1 },
            } });
            if (changed.count !== 1) throw new HrWorkforceError('La solicitud cambió concurrentemente', 409, 'HR_WORKFLOW_CAS_CONFLICT');
            await AuditLogService.log({ companyId, userId: actorId, entityType: 'LeaveRequest', entityId: id, action: 'UPDATE', details: { transition: `PENDING->${status}`, reason } }, tx);
            return leaveRequestApi(await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: leaveRequestInclude }));
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    static async cancel(id: number, companyId: number, actorId: number, reasonValue: unknown, selfOnly = false) {
        const reason = requiredText(reasonValue, 'reason');
        return prisma.$transaction(async tx => {
            const current = await tx.leaveRequest.findFirst({
                where: { id, companyId, ...(selfOnly ? { userId: actorId } : {}) },
                include: { leaveType: true },
            });
            if (!current) throw new HrWorkforceError('Solicitud de permiso no encontrada', 404);
            if (!['DRAFT', 'PENDING', 'APPROVED'].includes(current.status)) throw new HrWorkforceError('La solicitud no admite cancelación', 409, 'HR_WORKFLOW_CAS_CONFLICT');
            if (current.status === 'APPROVED' && selfOnly) {
                throw new HrWorkforceError('Una ausencia aprobada sólo puede revertirse por Owner', 403, 'HR_OWNER_REVERSAL_REQUIRED');
            }
            await assertDatesOpen(companyId, current.startDate, current.endDate, tx);
            if (current.status === 'APPROVED' && current.leaveType.balanceTracked) {
                const usage = await tx.vacationLedgerEntry.findFirst({
                    where: { companyId, leaveRequestId: id, type: 'USAGE' },
                    select: { balanceId: true, amount: true, unit: true },
                });
                if (!usage) throw new HrWorkforceError('No existe el asiento original para revertir la ausencia', 409, 'HR_VACATION_USAGE_MISSING');
                const available = await ledgerBalance(usage.balanceId, tx);
                const reversalAmount = Math.abs(Number(usage.amount));
                await tx.vacationLedgerEntry.create({ data: {
                    companyId,
                    balanceId: usage.balanceId,
                    userId: current.userId,
                    leaveRequestId: id,
                    effectiveDate: current.startDate,
                    amount: reversalAmount,
                    unit: usage.unit,
                    type: 'REVERSAL',
                    reason: `Reversión de ausencia aprobada: ${reason}`,
                    reference: `LEAVE-CANCEL-${id}`,
                    actorId,
                    resultingBalance: available + reversalAmount,
                } });
            }
            const changed = await tx.leaveRequest.updateMany({ where: { id, companyId, status: current.status, revision: current.revision }, data: {
                status: 'CANCELLED', cancelledAt: new Date(), decisionReason: reason, revision: { increment: 1 },
            } });
            if (changed.count !== 1) throw new HrWorkforceError('La solicitud cambió concurrentemente', 409, 'HR_WORKFLOW_CAS_CONFLICT');
            await AuditLogService.log({ companyId, userId: actorId, entityType: 'LeaveRequest', entityId: id, action: 'CANCEL', details: { reason } }, tx);
            return leaveRequestApi(await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: leaveRequestInclude }));
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    static async calendar(companyId: number, filters: { dateFrom?: string; dateTo?: string; branchId?: number; userId?: number; status?: string }) {
        const from = filters.dateFrom ? dateValue(filters.dateFrom, 'dateFrom') : new Date();
        const to = filters.dateTo ? dateValue(filters.dateTo, 'dateTo') : new Date(from.getTime() + 31 * 86_400_000);
        dateRangeKeys(from, to);
        const requests = await prisma.leaveRequest.findMany({
            where: {
                companyId, userId: filters.userId, branchId: filters.branchId,
                status: filters.status ? filters.status as LeaveRequestStatus : { in: ['PENDING', 'APPROVED'] },
                startDate: { lte: to }, endDate: { gte: from },
            }, include: leaveRequestInclude, orderBy: { startDate: 'asc' },
        });
        return requests.flatMap(request => dateRangeKeys(
            request.startDate < from ? from : request.startDate,
            request.endDate > to ? to : request.endDate,
        ).map(date => ({
            id: `${request.id}:${date}`, leaveRequestId: request.id, userId: request.userId, user: request.user,
            leaveTypeId: request.leaveTypeId, leaveType: leaveTypeApi(request.leaveType), date,
            fraction: request.fraction, status: request.status, branchId: request.branchId,
        })));
    }
}

function decimalAmount(value: unknown, field: string, options: { nonZero?: boolean; max?: number } = {}): number {
    const parsed = Number(value);
    const max = options.max ?? 1_000_000;
    if (!Number.isFinite(parsed) || Math.abs(parsed) > max) {
        throw new HrWorkforceError(`${field} debe ser un número entre -${max} y ${max}`);
    }
    if (options.nonZero && parsed === 0) throw new HrWorkforceError(`${field} no puede ser cero`);
    if (Math.round(parsed * 10_000) !== parsed * 10_000) {
        throw new HrWorkforceError(`${field} admite como máximo cuatro decimales`);
    }
    return parsed;
}

const vacationBalanceInclude = {
    user: { select: userSelect },
    leaveType: true,
} satisfies Prisma.VacationBalanceInclude;

function vacationLedgerApi(entry: Prisma.VacationLedgerEntryGetPayload<Record<string, never>>) {
    return {
        id: entry.id,
        balanceId: entry.balanceId,
        userId: entry.userId,
        effectiveDate: dateKey(entry.effectiveDate),
        amount: Number(entry.amount),
        unit: entry.unit,
        type: entry.type,
        reason: entry.reason,
        reference: entry.reference,
        actorId: entry.actorId,
        resultingBalance: Number(entry.resultingBalance),
        createdAt: entry.createdAt,
    };
}

export class VacationService {
    static async listBalances(companyId: number, filters: { userId?: number; branchId?: number; page?: number; limit?: number }) {
        const current = page(filters);
        const where: Prisma.VacationBalanceWhereInput = {
            companyId,
            userId: filters.userId,
            user: filters.branchId ? { branchId: filters.branchId } : undefined,
        };
        const [balances, total] = await Promise.all([
            prisma.vacationBalance.findMany({
                where,
                include: vacationBalanceInclude,
                orderBy: [{ userId: 'asc' }, { id: 'asc' }],
                skip: current.skip,
                take: current.limit,
            }),
            prisma.vacationBalance.count({ where }),
        ]);
        const items = await Promise.all(balances.map(async balance => {
            const [ledger, accrued, used, pending] = await Promise.all([
                prisma.vacationLedgerEntry.aggregate({ where: { balanceId: balance.id }, _sum: { amount: true } }),
                prisma.vacationLedgerEntry.aggregate({ where: { balanceId: balance.id, type: 'ACCRUAL' }, _sum: { amount: true } }),
                prisma.vacationLedgerEntry.aggregate({ where: { balanceId: balance.id, type: 'USAGE' }, _sum: { amount: true } }),
                balance.leaveTypeId
                    ? prisma.leaveRequest.aggregate({
                        where: {
                            companyId,
                            userId: balance.userId,
                            leaveTypeId: balance.leaveTypeId,
                            status: 'PENDING',
                        },
                        _sum: { requestedAmount: true },
                    })
                    : Promise.resolve({ _sum: { requestedAmount: null } }),
            ]);
            const ledgerTotal = Number(ledger._sum.amount || 0);
            const pendingTotal = Number(pending._sum.requestedAmount || 0);
            return {
                id: balance.id,
                userId: balance.userId,
                user: balance.user,
                leaveTypeId: balance.leaveTypeId,
                leaveType: balance.leaveType ? leaveTypeApi(balance.leaveType) : null,
                periodLabel: balance.periodLabel || balance.leaveType?.name || null,
                unit: balance.unit,
                accrued: Number(accrued._sum.amount || 0),
                used: Math.abs(Number(used._sum.amount || 0)),
                pending: pendingTotal,
                available: ledgerTotal - pendingTotal,
                asOf: dateKey(balance.asOf),
                sourceRevision: balance.sourceRevision,
            };
        }));
        return { items, pagination: pagination(total, current) };
    }

    static async listLedger(companyId: number, filters: {
        dateFrom?: string;
        dateTo?: string;
        userId?: number;
        branchId?: number;
        page?: number;
        limit?: number;
    }) {
        const current = page(filters);
        const where: Prisma.VacationLedgerEntryWhereInput = {
            companyId,
            userId: filters.userId,
            user: filters.branchId ? { branchId: filters.branchId } : undefined,
            effectiveDate: {
                gte: filters.dateFrom ? dateValue(filters.dateFrom, 'dateFrom') : undefined,
                lte: filters.dateTo ? dateValue(filters.dateTo, 'dateTo') : undefined,
            },
        };
        const [items, total] = await Promise.all([
            prisma.vacationLedgerEntry.findMany({
                where,
                orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
                skip: current.skip,
                take: current.limit,
            }),
            prisma.vacationLedgerEntry.count({ where }),
        ]);
        return { items: items.map(vacationLedgerApi), pagination: pagination(total, current) };
    }

    static async adjust(companyId: number, actorId: number, body: Record<string, unknown>, idempotencyKey: string) {
        const userId = positiveId(body.userId, 'userId');
        const balanceId = body.balanceId ? positiveId(body.balanceId, 'balanceId') : null;
        const effectiveDate = dateValue(body.effectiveDate, 'effectiveDate');
        const amount = decimalAmount(body.amount, 'amount', { nonZero: true });
        const unit = unitValue(body.unit);
        const reason = requiredText(body.reason, 'reason');
        const reference = optionalText(body.reference, 191);
        await ensureUser(companyId, userId);
        await assertDatesOpen(companyId, effectiveDate, effectiveDate);
        const requestedBalance = balanceId
            ? await prisma.vacationBalance.findFirst({ where: { id: balanceId, companyId, userId } })
            : null;
        if (balanceId && !requestedBalance) throw new HrWorkforceError('Saldo de vacaciones no encontrado', 404);
        if (requestedBalance && requestedBalance.unit !== unit) {
            throw new HrWorkforceError('La unidad del ajuste no coincide con la del saldo', 409, 'HR_VACATION_UNIT_MISMATCH');
        }
        let resolvedLeaveTypeId: number | null = requestedBalance?.leaveTypeId || null;
        if (!requestedBalance) {
            const candidates = await prisma.leaveType.findMany({
                where: { companyId, active: true, balanceTracked: true, unit },
                select: { id: true },
                take: 2,
            });
            if (candidates.length > 1) {
                throw new HrWorkforceError('Hay varios saldos rastreados con esa unidad; seleccione un saldo objetivo', 409, 'HR_VACATION_BALANCE_REQUIRED');
            }
            resolvedLeaveTypeId = candidates[0]?.id || null;
        }
        const payload = { userId, balanceId, resolvedLeaveTypeId, effectiveDate: dateKey(effectiveDate), amount, unit, reason, reference };
        return idempotent({
            companyId,
            key: idempotencyKey,
            operation: 'VACATION_ADJUSTMENT_CREATE',
            entityType: 'VacationLedgerEntry',
            payload,
            load: async id => {
                const entry = await prisma.vacationLedgerEntry.findFirst({ where: { id, companyId } });
                return entry ? vacationLedgerApi(entry) : null;
            },
            execute: async tx => {
                await assertDatesOpen(companyId, effectiveDate, effectiveDate, tx);
                let balance;
                if (requestedBalance) {
                    const currentBalance = await tx.vacationBalance.findFirst({
                        where: { id: requestedBalance.id, companyId, userId },
                    });
                    if (!currentBalance) throw new HrWorkforceError('Saldo de vacaciones no encontrado', 404);
                    balance = await tx.vacationBalance.update({
                        where: { id: currentBalance.id },
                        data: {
                            asOf: currentBalance.asOf < effectiveDate ? effectiveDate : currentBalance.asOf,
                            sourceRevision: { increment: 1 },
                        },
                    });
                } else {
                    balance = await ensureBalance(companyId, userId, resolvedLeaveTypeId, unit, effectiveDate, tx);
                }
                const before = await ledgerBalance(balance.id, tx);
                const entry = await tx.vacationLedgerEntry.create({ data: {
                    companyId,
                    balanceId: balance.id,
                    userId,
                    effectiveDate,
                    amount,
                    unit,
                    type: 'ADJUSTMENT',
                    reason,
                    reference,
                    actorId,
                    resultingBalance: before + amount,
                } });
                await AuditLogService.log({
                    companyId,
                    userId: actorId,
                    entityType: 'VacationLedgerEntry',
                    entityId: entry.id,
                    action: 'CREATE',
                    details: { userId, balanceId: balance.id, effectiveDate: dateKey(effectiveDate), amount, unit, reason, reference },
                }, tx);
                return { entityId: entry.id, value: vacationLedgerApi(entry) };
            },
        });
    }
}

export class WorkforcePortalService {
    static async getMyWorkforce(companyId: number, userId: number, timezone: string, filters: {
        date?: string;
        dateFrom?: string;
        dateTo?: string;
        page?: number;
        limit?: number;
    }) {
        await ensureUser(companyId, userId);
        const bounded = { ...filters, userId, limit: Math.min(filters.limit || 100, 100) };
        const attendance = await AttendanceDerivedService.list(companyId, bounded);
        const [incidents, corrections, overtime, leave, balances, ledger] = await Promise.all([
            AttendanceIncidentService.list(companyId, bounded),
            AttendanceCorrectionService.list(companyId, bounded),
            OvertimeService.list(companyId, bounded),
            LeaveRequestService.list(companyId, bounded),
            VacationService.listBalances(companyId, { userId }),
            VacationService.listLedger(companyId, bounded),
        ]);
        return {
            serverTime: new Date().toISOString(),
            timezone,
            attendanceSummaries: attendance.items,
            incidents: incidents.items,
            corrections: corrections.items,
            overtimeRequests: overtime.items,
            leaveRequests: leave.items,
            vacationBalances: balances.items,
            vacationLedger: ledger.items,
        };
    }
}
