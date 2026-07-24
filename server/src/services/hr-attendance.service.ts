import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma, type AttendanceEnforcementMode } from '@prisma/client';
import prisma from '../utils/prisma';
import { zonedDateKey, zonedDateTimeToUtc } from '../utils/timezone';
import { decryptBiometricTemplate } from '../utils/hr-biometric-crypto';
import { AuditLogService } from './audit-log.service';
import { AttendancePolicyService, BiometricService, HrAttendanceError, livenessActionFromNonce } from './hr-biometric.service';
import {
    createFaceVerificationProvider,
    FaceEvidenceRejectedError,
    FaceProviderUnavailableError,
    type FaceCaptureEvidence,
    type FaceVerificationProvider,
} from './hr-face-provider';

const ACTIONS = ['CHECK_IN', 'BREAK_START', 'BREAK_END', 'CHECK_OUT'] as const;
type Action = typeof ACTIONS[number];
type CheckStatus = 'PASSED' | 'FAILED' | 'REVIEW' | 'NOT_REQUIRED';
type EvidenceStatus = 'PASSED' | 'FAILED' | 'REVIEW' | 'NOT_REQUIRED' | 'ERROR';

export interface AttendanceCheck {
    status: CheckStatus;
    reasonCode?: string | null;
    message: string;
    measuredValue?: number | null;
    limitValue?: number | null;
}

function actionValue(value: unknown): Action {
    if (typeof value !== 'string' || !ACTIONS.includes(value as Action)) throw new HrAttendanceError('action inválido');
    return value as Action;
}

function requiredText(value: unknown, field: string, max = 1000): string {
    if (typeof value !== 'string' || !value.trim()) throw new HrAttendanceError(`${field} es requerido`);
    const normalized = value.trim();
    if (normalized.length > max) throw new HrAttendanceError(`${field} excede ${max} caracteres`);
    return normalized;
}

function positiveId(value: unknown, field: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new HrAttendanceError(`${field} debe ser un entero positivo`);
    return parsed;
}

function optionalNumber(value: unknown, field: string): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new HrAttendanceError(`${field} debe ser numérico`);
    return parsed;
}

function parseClientDate(value: unknown, field: string): Date | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) throw new HrAttendanceError(`${field} debe incluir offset o zona horaria`);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new HrAttendanceError(`${field} es inválido`);
    return parsed;
}

function json(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
}

function effectivePolicySnapshot(policy: Awaited<ReturnType<typeof AttendancePolicyService.getCurrent>>) {
    return {
        id: policy.id ?? null,
        branchId: policy.branchId ?? null,
        version: policy.version,
        timezone: policy.timezone,
        requireBiometric: policy.requireBiometric,
        requireLiveness: policy.requireLiveness,
        requireGeolocation: policy.requireGeolocation,
        maxLocationAccuracyM: policy.maxLocationAccuracyM,
        earlyCheckInMinutes: policy.earlyCheckInMinutes,
        lateCheckInToleranceM: policy.lateCheckInToleranceM,
        earlyCheckOutToleranceM: policy.earlyCheckOutToleranceM,
        lateCheckOutMinutes: policy.lateCheckOutMinutes,
        scheduleViolationMode: policy.scheduleViolationMode,
        geofenceViolationMode: policy.geofenceViolationMode,
        biometricViolationMode: policy.biometricViolationMode,
        allowUnscheduledPunch: policy.allowUnscheduledPunch,
        unscheduledViolationMode: policy.unscheduledViolationMode,
        allowManualFallback: policy.allowManualFallback,
        biometricConsentVersion: policy.biometricConsentVersion,
        biometricRetentionDays: policy.biometricRetentionDays,
    };
}

export function haversineDistanceM(latitude1: number, longitude1: number, latitude2: number, longitude2: number): number {
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const earthRadiusM = 6_371_000;
    const dLat = radians(latitude2 - latitude1);
    const dLon = radians(longitude2 - longitude1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(radians(latitude1)) * Math.cos(radians(latitude2)) * Math.sin(dLon / 2) ** 2;
    return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function dateBounds(dateKey: string, timezone: string): { start: Date; end: Date } {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!match) throw new HrAttendanceError('Fecha local inválida');
    const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: 0, minute: 0, second: 0 };
    const calendarCheck = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (
        calendarCheck.getUTCFullYear() !== parts.year
        || calendarCheck.getUTCMonth() + 1 !== parts.month
        || calendarCheck.getUTCDate() !== parts.day
    ) {
        throw new HrAttendanceError('Fecha local inválida');
    }
    const start = zonedDateTimeToUtc(parts, timezone);
    const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
    const end = zonedDateTimeToUtc({
        year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0, second: 0,
    }, timezone);
    return { start, end };
}

export function availableActionsFrom(events: Array<{ action: string }>): Action[] {
    const last = events[events.length - 1]?.action;
    if (!last || last === 'CHECK_OUT') return last === 'CHECK_OUT' ? [] : ['CHECK_IN'];
    if (last === 'CHECK_IN' || last === 'BREAK_END') return ['BREAK_START', 'CHECK_OUT'];
    if (last === 'BREAK_START') return ['BREAK_END'];
    return ['CHECK_IN'];
}

type EffectiveBranchAssignment = Prisma.EmployeeBranchAssignmentGetPayload<{
    include: {
        branch: {
            select: {
                id: true; name: true; code: true; timezone: true; status: true;
                attendanceEnabled: true; geofenceRadiusM: true; maxLocationAccuracyM: true;
            };
        };
    };
}>;

function assignmentCovers(
    assignment: Pick<EffectiveBranchAssignment, 'effectiveFrom' | 'effectiveTo'>,
    instant: Date,
    timezone: string,
) {
    const dateKey = zonedDateKey(instant, timezone);
    const from = assignment.effectiveFrom.toISOString().slice(0, 10);
    const to = assignment.effectiveTo?.toISOString().slice(0, 10) || null;
    return from <= dateKey && (to === null || to >= dateKey);
}

async function employeeBranchAssignments(companyId: number, userId: number): Promise<EffectiveBranchAssignment[]> {
    return prisma.employeeBranchAssignment.findMany({
        where: { companyId, employee: { companyId, userId } },
        include: {
            branch: {
                select: {
                    id: true, name: true, code: true, timezone: true, status: true,
                    attendanceEnabled: true, geofenceRadiusM: true, maxLocationAccuracyM: true,
                },
            },
        },
        orderBy: [{ isPrimary: 'desc' }, { effectiveFrom: 'desc' }],
    });
}

function check(status: CheckStatus, message: string, reasonCode?: string, measuredValue?: number | null, limitValue?: number | null): AttendanceCheck {
    return { status, message, ...(reasonCode ? { reasonCode } : {}), ...(measuredValue !== undefined ? { measuredValue } : {}), ...(limitValue !== undefined ? { limitValue } : {}) };
}

function decisionForViolation(current: 'ACCEPTED' | 'REVIEW' | 'REJECTED', status: CheckStatus | 'ERROR', enforcement: AttendanceEnforcementMode) {
    if (status === 'REVIEW') {
        return enforcement === 'WARN' || current === 'REJECTED' ? current : 'REVIEW' as const;
    }
    if (status !== 'FAILED' && status !== 'ERROR') return current;
    if (enforcement === 'BLOCK') return 'REJECTED' as const;
    if (enforcement === 'REVIEW' && current !== 'REJECTED') return 'REVIEW' as const;
    return current;
}

export function decisionForSelfEvidence(
    current: 'ACCEPTED' | 'REVIEW' | 'REJECTED',
    status: CheckStatus | 'ERROR',
) {
    return decisionForViolation(current, status, 'BLOCK');
}

function externalDecision(value: 'ACCEPTED' | 'REVIEW' | 'REJECTED') {
    return value === 'REVIEW' ? 'REVIEW_REQUIRED' as const : value;
}

const eventInclude = {
    user: { select: { id: true, name: true, username: true, accountType: true } },
    branch: { select: { id: true, name: true, code: true } },
    review: { select: { decision: true, reason: true, reviewerId: true, createdAt: true } },
} satisfies Prisma.AttendanceEventInclude;

type EventForApi = Prisma.AttendanceEventGetPayload<{ include: typeof eventInclude }>;

export function mapAttendanceEvent(event: EventForApi) {
    return {
        id: event.id,
        userId: event.userId,
        user: event.user,
        branchId: event.branchId,
        branch: event.branch,
        action: event.action,
        occurredAt: event.serverAt,
        source: event.source,
        decision: externalDecision(event.decision),
        reasonCode: event.reasonCode,
        message: event.message,
        scheduleId: event.scheduledShiftId,
        distanceM: event.distanceM === null ? null : Number(event.distanceM),
        locationAccuracyM: event.locationAccuracyM === null ? null : Number(event.locationAccuracyM),
        reviewedAt: event.review?.createdAt || null,
        reviewedById: event.review?.reviewerId || null,
        reviewDecision: event.review?.decision || null,
        reviewReason: event.review?.reason || null,
        checks: event.checks,
    };
}

function punchResult(event: EventForApi) {
    const checks = (event.checks || {}) as unknown as Record<string, AttendanceCheck>;
    const effectiveDecision = event.review?.decision === 'APPROVED'
        ? 'ACCEPTED' as const
        : event.review?.decision === 'REJECTED'
            ? 'REJECTED' as const
            : externalDecision(event.decision);
    return {
        decision: effectiveDecision,
        reasonCode: event.reasonCode,
        message: event.message || (event.decision === 'ACCEPTED' ? 'Marcaje aceptado' : event.decision === 'REVIEW' ? 'Marcaje enviado a revisión' : 'Marcaje rechazado'),
        event: mapAttendanceEvent(event),
        punch: effectiveDecision !== 'ACCEPTED' ? null : {
            id: event.id, action: event.action, occurredAt: event.serverAt,
            branchId: event.branchId, branch: event.branch, source: event.source,
            decision: effectiveDecision,
        },
        checks,
        serviceUnavailable: event.providerStatus === 'UNAVAILABLE' || event.providerStatus === 'ERROR',
    };
}

type EffectiveShift = Prisma.ScheduledShiftGetPayload<{
    include: {
        branch: { select: { id: true; name: true; code: true; timezone: true } };
        assignmentOverride: { select: { assignedUserId: true } };
    };
}>;

async function effectiveShifts(companyId: number, userId: number, from: Date, to: Date): Promise<EffectiveShift[]> {
    const shifts = await prisma.scheduledShift.findMany({
        where: {
            companyId, status: 'SCHEDULED', schedule: { status: 'PUBLISHED' },
            startAt: { lt: to }, endAt: { gt: from },
            OR: [
                { assignmentOverride: { is: { assignedUserId: userId } } },
                { assignmentOverride: { is: null }, userId },
            ],
        },
        include: {
            branch: { select: { id: true, name: true, code: true, timezone: true } },
            assignmentOverride: { select: { assignedUserId: true } },
        },
        orderBy: { startAt: 'asc' },
    });
    return shifts as EffectiveShift[];
}

function selectShift(shifts: EffectiveShift[], now: Date, policy: Awaited<ReturnType<typeof AttendancePolicyService.getCurrent>>) {
    const early = policy.earlyCheckInMinutes * 60_000;
    const late = policy.lateCheckOutMinutes * 60_000;
    return shifts
        .filter((shift) => now.getTime() >= shift.startAt.getTime() - early && now.getTime() <= shift.endAt.getTime() + late)
        .sort((left, right) => Math.abs(left.startAt.getTime() - now.getTime()) - Math.abs(right.startAt.getTime() - now.getTime()))[0] || null;
}

async function selectShiftUsingBranchPolicies(companyId: number, shifts: EffectiveShift[], now: Date) {
    const branchIds = [...new Set(shifts.map((shift) => shift.branchId))];
    const policies = new Map<number, Awaited<ReturnType<typeof AttendancePolicyService.getCurrent>>>();
    await Promise.all(branchIds.map(async (branchId) => {
        policies.set(branchId, await AttendancePolicyService.getCurrent(companyId, branchId));
    }));
    const shift = shifts
        .filter((candidate) => selectShift([candidate], now, policies.get(candidate.branchId)!) !== null)
        .sort((left, right) => Math.abs(left.startAt.getTime() - now.getTime()) - Math.abs(right.startAt.getTime() - now.getTime()))[0] || null;
    return {
        shift,
        policy: shift ? policies.get(shift.branchId)! : null,
    };
}

async function shiftById(companyId: number, userId: number, shiftId: number): Promise<EffectiveShift | null> {
    const shift = await prisma.scheduledShift.findFirst({
        where: {
            id: shiftId,
            companyId,
            OR: [
                { assignmentOverride: { is: { assignedUserId: userId } } },
                { assignmentOverride: { is: null }, userId },
            ],
        },
        include: {
            branch: { select: { id: true, name: true, code: true, timezone: true } },
            assignmentOverride: { select: { assignedUserId: true } },
        },
    });
    return shift as EffectiveShift | null;
}

async function lockAttendanceSubject(tx: Prisma.TransactionClient, companyId: number, userId: number) {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT id FROM \`User\`
        WHERE id = ${userId} AND companyId = ${companyId}
        FOR UPDATE
    `);
    if (rows.length !== 1) throw new HrAttendanceError('Usuario activo no encontrado', 404);
}

async function lockAttendanceDatePeriod(
    tx: Prisma.TransactionClient,
    companyId: number,
    localDate: Date,
): Promise<{ id: number; status: 'OPEN' | 'CLOSED' | 'REOPENED' } | null> {
    const rows = await tx.$queryRaw<Array<{ id: number; status: 'OPEN' | 'CLOSED' | 'REOPENED' }>>(Prisma.sql`
        SELECT id, status FROM AttendancePeriod
        WHERE companyId = ${companyId}
          AND dateFrom <= ${localDate}
          AND dateTo >= ${localDate}
        ORDER BY id DESC
        LIMIT 1
        FOR UPDATE
    `);
    return rows[0] || null;
}

async function effectiveSessionEvents(
    tx: Prisma.TransactionClient,
    companyId: number,
    userId: number,
    sessionKey: string,
    excludeEventId?: number,
) {
    const events = await tx.attendanceEvent.findMany({
        where: {
            companyId, userId, sessionKey,
            ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
        },
        include: {
            review: { select: { decision: true } },
            targetedCorrections: {
                where: { status: 'APPLIED' },
                select: { type: true, status: true, compensationEventId: true },
            },
        },
        orderBy: [{ serverAt: 'asc' }, { id: 'asc' }],
    });
    return events.filter(isEffectiveEvent);
}

async function effectiveSubjectEvents(
    tx: Prisma.TransactionClient,
    companyId: number,
    userId: number,
    excludeEventId?: number,
) {
    const events = await tx.attendanceEvent.findMany({
        where: {
            companyId, userId,
            ...(excludeEventId ? { id: { not: excludeEventId } } : {}),
            OR: [
                { decision: 'ACCEPTED' },
                { decision: 'REVIEW', review: { is: { decision: 'APPROVED' } } },
            ],
        },
        include: {
            review: { select: { decision: true } },
            targetedCorrections: {
                where: { status: 'APPLIED' },
                select: { type: true, status: true, compensationEventId: true },
            },
        },
        orderBy: [{ serverAt: 'asc' }, { id: 'asc' }],
    });
    return events.filter(isEffectiveEvent);
}

async function assertGlobalCandidateState(
    tx: Prisma.TransactionClient,
    candidate: { id?: number; companyId: number; userId: number; sessionKey: string; action: Action },
) {
    const effective = await effectiveSubjectEvents(tx, candidate.companyId, candidate.userId, candidate.id);
    const opened = openSessions(effective);
    if (candidate.action === 'CHECK_IN') {
        if (opened.length > 0) {
            throw new HrAttendanceError('Ya existe una entrada abierta; debe cerrarse o corregirse antes de otra entrada', 409, 'OPEN_ATTENDANCE_EXISTS');
        }
        return;
    }
    if (opened.length !== 1 || opened[0][0] !== candidate.sessionKey) {
        throw new HrAttendanceError('La acción requiere una única entrada abierta de la misma jornada', 409, 'OPEN_ATTENDANCE_REQUIRED');
    }
}

async function assertCandidateSequence(
    tx: Prisma.TransactionClient,
    candidate: { id?: number; companyId: number; userId: number; sessionKey: string; action: Action; serverAt: Date },
) {
    const related = await effectiveSessionEvents(
        tx,
        candidate.companyId,
        candidate.userId,
        candidate.sessionKey,
        candidate.id,
    );
    const sequence = related.map((event) => ({ action: event.action, serverAt: event.serverAt, id: event.id }));
    sequence.push({ action: candidate.action, serverAt: candidate.serverAt, id: candidate.id ?? Number.MAX_SAFE_INTEGER });
    sequence.sort((left, right) => left.serverAt.getTime() - right.serverAt.getTime() || left.id - right.id);
    assertValidActionSequence(sequence);
    return related;
}

function scheduleCheck(action: Action, shift: EffectiveShift | null, now: Date, policy: Awaited<ReturnType<typeof AttendancePolicyService.getCurrent>>): AttendanceCheck {
    if (!shift) {
        return policy.allowUnscheduledPunch
            ? check('REVIEW', 'No hay turno publicado; se permite bajo revisión', 'NO_SCHEDULE')
            : check('FAILED', 'No existe un turno publicado aplicable', 'NO_SCHEDULE');
    }
    if (action === 'CHECK_IN') {
        const earliest = new Date(shift.startAt.getTime() - policy.earlyCheckInMinutes * 60_000);
        const latest = new Date(shift.startAt.getTime() + policy.lateCheckInToleranceM * 60_000);
        if (now < earliest) return check('FAILED', 'Marcaje de entrada demasiado temprano', 'CHECK_IN_TOO_EARLY');
        if (now > latest) return check('FAILED', 'Marcaje de entrada fuera de tolerancia', 'CHECK_IN_LATE');
    }
    if (action === 'CHECK_OUT') {
        const earliest = new Date(shift.endAt.getTime() - policy.earlyCheckOutToleranceM * 60_000);
        const latest = new Date(shift.endAt.getTime() + policy.lateCheckOutMinutes * 60_000);
        if (now < earliest) return check('FAILED', 'Marcaje de salida demasiado temprano', 'CHECK_OUT_TOO_EARLY');
        if (now > latest) return check('FAILED', 'Marcaje de salida fuera de ventana', 'CHECK_OUT_LATE');
    }
    if ((action === 'BREAK_START' || action === 'BREAK_END') && (now < shift.startAt || now > shift.endAt)) {
        return check('FAILED', 'El descanso está fuera del turno', 'BREAK_OUTSIDE_SHIFT');
    }
    return check('PASSED', 'Horario validado contra el turno publicado');
}

export function evaluateGeofence(input: { latitude: number | null; longitude: number | null; accuracyM: number | null }, branch: {
    attendanceEnabled: boolean; latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null;
    geofenceRadiusM: number | null; maxLocationAccuracyM: number | null;
} | null, policy: Awaited<ReturnType<typeof AttendancePolicyService.getCurrent>>) {
    if (!policy.requireGeolocation) return {
        geofence: check('NOT_REQUIRED', 'Ubicación no requerida por la política'),
        locationAccuracy: check('NOT_REQUIRED', 'Precisión no requerida por la política'),
        distanceM: null as number | null,
    };
    if (input.latitude === null || input.longitude === null || input.accuracyM === null) return {
        geofence: check('FAILED', 'Falta evidencia de ubicación', 'LOCATION_REQUIRED'),
        locationAccuracy: check('FAILED', 'Falta precisión de ubicación', 'LOCATION_ACCURACY_REQUIRED'),
        distanceM: null,
    };
    if (input.latitude < -90 || input.latitude > 90 || input.longitude < -180 || input.longitude > 180 || input.accuracyM < 0) {
        return {
            geofence: check('FAILED', 'Coordenadas inválidas', 'LOCATION_INVALID'),
            locationAccuracy: check('FAILED', 'Precisión inválida', 'LOCATION_ACCURACY_INVALID'),
            distanceM: null,
        };
    }
    if (!branch?.attendanceEnabled || branch.latitude === null || branch.longitude === null || !branch.geofenceRadiusM) return {
        geofence: check('FAILED', 'La sucursal no tiene una geocerca habilitada', 'GEOFENCE_NOT_CONFIGURED'),
        locationAccuracy: check('REVIEW', 'No se pudo validar la precisión contra la sucursal', 'GEOFENCE_NOT_CONFIGURED'),
        distanceM: null,
    };
    const accuracyLimit = Math.min(policy.maxLocationAccuracyM, branch.maxLocationAccuracyM || policy.maxLocationAccuracyM);
    const distanceM = haversineDistanceM(input.latitude, input.longitude, Number(branch.latitude), Number(branch.longitude));
    const geofenceFits = distanceM + input.accuracyM <= branch.geofenceRadiusM;
    const centerIsInside = distanceM <= branch.geofenceRadiusM;
    return {
        // Conservative acceptance: the full reported accuracy circle must fit
        // inside the configured radius, not merely its center point.
        geofence: geofenceFits
            ? check('PASSED', 'Ubicación dentro de la geocerca', undefined, distanceM, branch.geofenceRadiusM)
            : centerIsInside
                ? check('FAILED', 'La ubicación es demasiado imprecisa para confirmar la geocerca', 'GEOFENCE_UNCERTAIN', distanceM, branch.geofenceRadiusM)
                : check('FAILED', 'Ubicación fuera de la geocerca', 'OUTSIDE_GEOFENCE', distanceM, branch.geofenceRadiusM),
        locationAccuracy: input.accuracyM <= accuracyLimit
            ? check('PASSED', 'Precisión de ubicación aceptable', undefined, input.accuracyM, accuracyLimit)
            : check('FAILED', 'Precisión insuficiente', 'LOCATION_ACCURACY_TOO_LOW', input.accuracyM, accuracyLimit),
        distanceM,
    };
}

type EffectiveAttendanceEvent = Prisma.AttendanceEventGetPayload<{
    include: {
        review: { select: { decision: true } };
        targetedCorrections: { select: { type: true; status: true; compensationEventId: true } };
    };
}>;

function isEffectiveEvent(event: EffectiveAttendanceEvent): boolean {
    const displaced = (event.targetedCorrections || []).some(correction =>
        correction.status === 'APPLIED'
        && (
            correction.type === 'VOID_PUNCH'
            || ((correction.type === 'CHANGE_TIME' || correction.type === 'ASSIGN_BRANCH') && correction.compensationEventId)
        ));
    if (displaced) return false;
    return (event.decision === 'ACCEPTED' && event.review?.decision !== 'REJECTED')
        || (event.decision === 'REVIEW' && event.review?.decision === 'APPROVED');
}

async function effectiveEventsInRange(companyId: number, userId: number, from: Date, to: Date) {
    const events = await prisma.attendanceEvent.findMany({
        where: {
            companyId, userId, serverAt: { gte: from, lt: to },
            OR: [
                { decision: 'ACCEPTED' },
                { decision: 'REVIEW', review: { is: { decision: 'APPROVED' } } },
            ],
        },
        include: {
            review: { select: { decision: true } },
            targetedCorrections: {
                where: { status: 'APPLIED' },
                select: { type: true, status: true, compensationEventId: true },
            },
        },
        orderBy: [{ serverAt: 'asc' }, { id: 'asc' }],
    });
    return events.filter(isEffectiveEvent);
}

function effectiveSessionKey(event: Pick<EffectiveAttendanceEvent, 'sessionKey' | 'scheduledShiftId' | 'branchId' | 'serverAt' | 'userId'>): string {
    return event.sessionKey || (event.scheduledShiftId
        ? `SHIFT:${event.scheduledShiftId}`
        : `LEGACY:${event.userId}:${event.branchId || 'NONE'}:${event.serverAt.toISOString().slice(0, 10)}`);
}

function groupSessions(events: EffectiveAttendanceEvent[]) {
    const groups = new Map<string, EffectiveAttendanceEvent[]>();
    for (const event of events) {
        const key = effectiveSessionKey(event);
        const values = groups.get(key) || [];
        values.push(event);
        groups.set(key, values);
    }
    for (const values of groups.values()) {
        values.sort((left, right) => left.serverAt.getTime() - right.serverAt.getTime() || left.id - right.id);
    }
    return groups;
}

function openSession(events: EffectiveAttendanceEvent[]) {
    return Array.from(groupSessions(events).entries())
        .filter(([, values]) => values[0]?.action === 'CHECK_IN' && values[values.length - 1]?.action !== 'CHECK_OUT')
        .sort((left, right) => right[1][right[1].length - 1].serverAt.getTime() - left[1][left[1].length - 1].serverAt.getTime())[0] || null;
}

function openSessions(events: EffectiveAttendanceEvent[]) {
    return Array.from(groupSessions(events).entries())
        .filter(([, values]) => values[0]?.action === 'CHECK_IN' && values[values.length - 1]?.action !== 'CHECK_OUT')
        .sort((left, right) => right[1][right[1].length - 1].serverAt.getTime() - left[1][left[1].length - 1].serverAt.getTime());
}

function staleOpenSession(
    open: [string, EffectiveAttendanceEvent[]] | null,
    shift: EffectiveShift | null,
    policy: Awaited<ReturnType<typeof AttendancePolicyService.getCurrent>>,
    now: Date,
) {
    if (!open) return false;
    if (shift) return now.getTime() > shift.endAt.getTime() + policy.lateCheckOutMinutes * 60_000;
    return zonedDateKey(open[1][0].serverAt, policy.timezone) < zonedDateKey(now, policy.timezone);
}

function assertValidActionSequence(events: Array<{ action: string }>) {
    const prior: Array<{ action: string }> = [];
    for (const event of events) {
        if (!availableActionsFrom(prior).includes(event.action as Action)) {
            throw new HrAttendanceError('La aprobación produciría una secuencia inválida; use una corrección compensatoria', 409, 'INVALID_REVIEW_SEQUENCE');
        }
        prior.push(event);
    }
}

export function locationFreshness(clientAt: Date | null, now: Date, required: boolean): AttendanceCheck {
    if (!required) return check('NOT_REQUIRED', 'Frescura de ubicación no requerida');
    if (!clientAt) return check('FAILED', 'Falta la hora de captura de ubicación', 'LOCATION_CAPTURE_TIME_REQUIRED');
    const ageMs = now.getTime() - clientAt.getTime();
    if (ageMs < -30_000) return check('FAILED', 'La ubicación tiene una hora futura', 'LOCATION_CAPTURE_IN_FUTURE', ageMs / 1000, 30);
    if (ageMs > 120_000) return check('FAILED', 'La ubicación es demasiado antigua', 'LOCATION_CAPTURE_STALE', ageMs / 1000, 120);
    return check('PASSED', 'Ubicación capturada recientemente', undefined, Math.max(0, ageMs / 1000), 120);
}

function requestHash(value: Record<string, unknown>): string {
    // Deliberately excludes capture bytes and any derivative of them. The
    // challenge identity binds the biometric attempt without retaining evidence.
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function claimPunchRequest(input: {
    companyId: number;
    userId: number;
    idempotencyKey: string;
    requestHash: string;
    challengeId: string;
    now: Date;
}): Promise<{ claimId: number; leaseAttempt: number; replay: EventForApi | null }> {
    const leaseExpiresAt = new Date(input.now.getTime() + 120_000);
    const loadExisting = async () => prisma.attendancePunchRequest.findUnique({
        where: { companyId_idempotencyKey: { companyId: input.companyId, idempotencyKey: input.idempotencyKey } },
    });
    let existing = await loadExisting();
    if (!existing) {
        try {
            const created = await prisma.attendancePunchRequest.create({
                data: {
                    companyId: input.companyId, userId: input.userId, idempotencyKey: input.idempotencyKey,
                    requestHash: input.requestHash, challengeId: input.challengeId, leaseExpiresAt,
                },
            });
            return { claimId: created.id, leaseAttempt: created.attempts, replay: null };
        } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
            existing = await loadExisting();
        }
    }
    if (!existing) throw new HrAttendanceError('No fue posible reclamar la idempotencia', 409, 'IDEMPOTENCY_IN_PROGRESS');
    if (existing.userId !== input.userId || existing.requestHash !== input.requestHash || existing.challengeId !== input.challengeId) {
        throw new HrAttendanceError('Idempotency-Key reutilizada con otro contenido', 409, 'IDEMPOTENCY_MISMATCH');
    }
    if (existing.eventId) {
        const event = await prisma.attendanceEvent.findFirst({
            where: { id: existing.eventId, companyId: input.companyId }, include: eventInclude,
        });
        if (!event) throw new HrAttendanceError('La respuesta idempotente no está disponible', 409, 'IDEMPOTENCY_STALE');
        return { claimId: existing.id, leaseAttempt: existing.attempts, replay: event };
    }
    const reclaimed = await prisma.attendancePunchRequest.updateMany({
        where: { id: existing.id, companyId: input.companyId, status: 'PROCESSING', leaseExpiresAt: { lte: input.now } },
        data: { leaseExpiresAt, attempts: { increment: 1 }, lastError: null },
    });
    if (reclaimed.count !== 1) throw new HrAttendanceError('El marcaje idempotente está en proceso', 409, 'IDEMPOTENCY_IN_PROGRESS');
    return { claimId: existing.id, leaseAttempt: existing.attempts + 1, replay: null };
}

export class AttendanceService {
    static async today(companyId: number, userId: number, activeBranchId?: number, now = new Date()) {
        const user = await prisma.user.findFirst({
            where: { id: userId, companyId, status: 'ACTIVE', accountType: 'INTERNAL', employee: { is: { status: 'ACTIVE' } } },
            select: { id: true },
        });
        if (!user) throw new HrAttendanceError('Usuario activo no encontrado', 404);
        const [shifts, history, assignments] = await Promise.all([
            effectiveShifts(companyId, userId, new Date(now.getTime() - 72 * 3600000), new Date(now.getTime() + 36 * 3600000)),
            effectiveEventsInRange(companyId, userId, new Date(0), new Date(now.getTime() + 1000)),
            employeeBranchAssignments(companyId, userId),
        ]);
        const open = openSession(history);
        const completedShiftIds = new Set(history.filter((event) => event.action === 'CHECK_OUT' && event.scheduledShiftId).map((event) => event.scheduledShiftId));
        const openShiftId = open?.[1][0].scheduledShiftId || null;
        const openShift = openShiftId
            ? shifts.find((shift) => shift.id === openShiftId) || await shiftById(companyId, userId, openShiftId)
            : null;
        const selected = openShift
            ? { shift: openShift, policy: await AttendancePolicyService.getCurrent(companyId, openShift.branchId) }
            : await selectShiftUsingBranchPolicies(companyId, shifts.filter((shift) => !completedShiftIds.has(shift.id)), now);
        const scheduledShift = selected.shift;
        const effectiveNow = assignments.filter((assignment) => assignment.branch.status === 'ACTIVE' && assignmentCovers(assignment, now, assignment.branch.timezone));
        const preferredAssignment = effectiveNow.find((assignment) => assignment.branchId === activeBranchId) || effectiveNow[0] || null;
        const targetBranchId = open?.[1][0].branchId || scheduledShift?.branchId || preferredAssignment?.branchId || null;
        const policy = selected.policy || await AttendancePolicyService.getCurrent(companyId, targetBranchId || undefined);
        const authorizationInstant = scheduledShift?.startAt || open?.[1][0].serverAt || now;
        const branchAssignment = targetBranchId
            ? assignments.find((assignment) => assignment.branchId === targetBranchId && assignment.branch.status === 'ACTIVE' && assignmentCovers(assignment, authorizationInstant, assignment.branch.timezone)) || null
            : null;
        const targetBranch = targetBranchId
            ? assignments.find((assignment) => assignment.branchId === targetBranchId)?.branch
                || scheduledShift?.branch
                || await prisma.branch.findFirst({ where: { id: targetBranchId, companyId }, select: { id: true, name: true, code: true, timezone: true, status: true } })
            : null;
        const branchAccuracyLimit = targetBranch && 'maxLocationAccuracyM' in targetBranch && typeof targetBranch.maxLocationAccuracyM === 'number'
            ? targetBranch.maxLocationAccuracyM
            : null;
        const branchGeofenceRadius = targetBranch && 'geofenceRadiusM' in targetBranch && typeof targetBranch.geofenceRadiusM === 'number'
            ? targetBranch.geofenceRadiusM
            : null;
        const effectiveAccuracyLimit = branchAccuracyLimit
            ? Math.min(policy.maxLocationAccuracyM, branchAccuracyLimit)
            : policy.maxLocationAccuracyM;
        const sessionEvents = open?.[1]
            || (scheduledShift ? history.filter((event) => event.scheduledShiftId === scheduledShift.id) : []);
        const stale = staleOpenSession(open, openShift, policy, now);
        const availableActions = !stale && branchAssignment && (scheduledShift || open || policy.allowUnscheduledPunch)
            ? availableActionsFrom(sessionEvents)
            : [];
        const bounds = dateBounds(zonedDateKey(now, policy.timezone), policy.timezone);
        const events = history.filter((event) =>
            (event.serverAt >= bounds.start && event.serverAt < bounds.end)
            || (open && effectiveSessionKey(event) === open[0]));
        return {
            serverTime: now, timezone: policy.timezone, availableActions,
            policy: effectivePolicySnapshot(policy),
            targetBranch: targetBranch ? { id: targetBranch.id, name: targetBranch.name, code: targetBranch.code } : null,
            locationRequirements: policy.requireGeolocation ? {
                maxAccuracyM: effectiveAccuracyLimit,
                geofenceRadiusM: branchGeofenceRadius ?? null,
            } : null,
            blockingIssue: stale && open ? {
                code: 'STALE_OPEN_ATTENDANCE' as const,
                message: 'Existe una entrada anterior sin salida fuera de su ventana válida. Solicita una corrección antes de iniciar otra jornada.',
                occurredAt: open[1][0].serverAt,
                branch: targetBranch ? { id: targetBranch.id, name: targetBranch.name, code: targetBranch.code } : null,
                resolution: 'REQUEST_CORRECTION' as const,
            } : null,
            punches: events.map((event) => ({
                id: event.id, action: event.action, occurredAt: event.serverAt, branchId: event.branchId,
                source: event.source,
                decision: event.review?.decision === 'APPROVED' ? 'ACCEPTED' as const : externalDecision(event.decision),
            })),
            scheduledShift: scheduledShift ? {
                id: scheduledShift.id, branchId: scheduledShift.branchId, branch: scheduledShift.branch,
                startAt: scheduledShift.startAt, endAt: scheduledShift.endAt,
            } : null,
        };
    }

    static async punch(input: {
        companyId: number; userId: number; activeBranchId?: number; idempotencyKey: string;
        action: unknown; challengeId: string; challengeToken?: string; evidence?: FaceCaptureEvidence;
        latitude?: unknown; longitude?: unknown; accuracyM?: unknown; locationCapturedAt?: unknown;
        deviceId?: unknown; deviceKey?: string;
    }, provider: FaceVerificationProvider = createFaceVerificationProvider(), now = new Date()) {
        const action = actionValue(input.action);
        const idempotencyKey = requiredText(input.idempotencyKey, 'Idempotency-Key', 128);
        const latitude = optionalNumber(input.latitude, 'latitude');
        const longitude = optionalNumber(input.longitude, 'longitude');
        const accuracyM = optionalNumber(input.accuracyM, 'accuracyM');
        const clientAt = parseClientDate(input.locationCapturedAt, 'locationCapturedAt');
        const user = await prisma.user.findFirst({
            where: {
                id: input.userId, companyId: input.companyId, status: 'ACTIVE',
                accountType: 'INTERNAL', employee: { is: { status: 'ACTIVE' } },
            },
            select: { id: true },
        });
        if (!user) throw new HrAttendanceError('El marcaje requiere un usuario interno vinculado a un empleado', 403, 'HR_INTERNAL_EMPLOYEE_REQUIRED');
        const requestedDeviceId = input.deviceId === undefined || input.deviceId === null || input.deviceId === '' ? null : positiveId(input.deviceId, 'X-Attendance-Device-Id');
        if (requestedDeviceId && process.env.HR_ATTENDANCE_KIOSK_ENABLED !== 'true') {
            throw new HrAttendanceError('El cliente de kiosco protegido no está habilitado en este despliegue', 503, 'KIOSK_DISABLED');
        }
        if ((requestedDeviceId && !input.deviceKey) || (!requestedDeviceId && input.deviceKey)) throw new HrAttendanceError('Las credenciales de dispositivo están incompletas', 401, 'DEVICE_CREDENTIALS_REQUIRED');
        let device: { id: number; branchId: number } | null = null;
        if (requestedDeviceId && input.deviceKey) {
            const stored = await prisma.attendanceDevice.findFirst({
                where: { id: requestedDeviceId, companyId: input.companyId, status: 'ACTIVE' },
                select: { id: true, branchId: true, keyHash: true },
            });
            const suppliedHash = createHash('sha256').update(input.deviceKey).digest('hex');
            const valid = stored && /^[0-9a-f]{64}$/i.test(stored.keyHash)
                && timingSafeEqual(Buffer.from(stored.keyHash, 'hex'), Buffer.from(suppliedHash, 'hex'));
            if (!valid || !stored) throw new HrAttendanceError('Dispositivo de asistencia inválido o revocado', 401, 'DEVICE_INVALID');
            device = { id: stored.id, branchId: stored.branchId };
        }
        const hash = requestHash({ userId: input.userId, action, challengeId: input.challengeId, latitude, longitude, accuracyM, clientAt: clientAt?.toISOString(), deviceId: device?.id || null });
        const prior = await prisma.attendanceEvent.findFirst({ where: { companyId: input.companyId, idempotencyKey }, include: eventInclude });
        if (prior) {
            if (prior.requestHash !== hash) throw new HrAttendanceError('Idempotency-Key reutilizada con otro contenido', 409, 'IDEMPOTENCY_MISMATCH');
            return punchResult(prior);
        }
        const claim = await claimPunchRequest({
            companyId: input.companyId, userId: input.userId, idempotencyKey,
            requestHash: hash, challengeId: input.challengeId, now,
        });
        if (claim.replay) return punchResult(claim.replay);
        const [broadShifts, history, assignments] = await Promise.all([
            effectiveShifts(input.companyId, input.userId, new Date(now.getTime() - 72 * 3600000), new Date(now.getTime() + 36 * 3600000)),
            effectiveEventsInRange(input.companyId, input.userId, new Date(0), new Date(now.getTime() + 1000)),
            employeeBranchAssignments(input.companyId, input.userId),
        ]);
        const open = openSession(history);
        const startedShiftIds = new Set(history.filter((event) => event.action === 'CHECK_IN' && event.scheduledShiftId).map((event) => event.scheduledShiftId));
        let shift: EffectiveShift | null = null;
        let selectedShiftPolicy: Awaited<ReturnType<typeof AttendancePolicyService.getCurrent>> | null = null;
        if (open?.[1][0].scheduledShiftId) {
            shift = broadShifts.find((candidate) => candidate.id === open[1][0].scheduledShiftId)
                || await shiftById(input.companyId, input.userId, open[1][0].scheduledShiftId);
            if (shift) selectedShiftPolicy = await AttendancePolicyService.getCurrent(input.companyId, shift.branchId);
        } else if (action === 'CHECK_IN') {
            const selected = await selectShiftUsingBranchPolicies(
                input.companyId,
                broadShifts.filter((candidate) => !startedShiftIds.has(candidate.id)),
                now,
            );
            shift = selected.shift;
            selectedShiftPolicy = selected.policy;
        }
        const effectiveNow = assignments.filter((assignment) => assignment.branch.status === 'ACTIVE' && assignmentCovers(assignment, now, assignment.branch.timezone));
        const preferredAssignment = effectiveNow.find((assignment) => assignment.branchId === input.activeBranchId) || effectiveNow[0] || null;
        const branchId = open?.[1][0].branchId || shift?.branchId || device?.branchId || preferredAssignment?.branchId || null;
        const authorizationInstant = shift?.startAt || open?.[1][0].serverAt || now;
        const effectiveAssignment = branchId
            ? assignments.find((assignment) => assignment.branchId === branchId && assignment.branch.status === 'ACTIVE' && assignmentCovers(assignment, authorizationInstant, assignment.branch.timezone)) || null
            : null;
        const branchAuthorization = effectiveAssignment
            ? check('PASSED', 'Adscripción RH vigente para la sucursal')
            : check('FAILED', 'El empleado no tiene una adscripción RH vigente para esta sucursal', 'EMPLOYEE_BRANCH_ASSIGNMENT_REQUIRED');
        const branch = branchId ? await prisma.branch.findFirst({
            where: { id: branchId, companyId: input.companyId },
            select: {
                id: true, name: true, code: true, status: true, timezone: true, attendanceEnabled: true,
                latitude: true, longitude: true, geofenceRadiusM: true, maxLocationAccuracyM: true,
            },
        }) : null;
        const geofenceVersion = branchId ? await prisma.branchGeofenceVersion.findFirst({
            where: { companyId: input.companyId, branchId }, orderBy: { version: 'desc' },
            select: {
                id: true, latitude: true, longitude: true, geofenceRadiusM: true,
                maxLocationAccuracyM: true, timezone: true, attendanceEnabled: true,
            },
        }) : null;
        const policy = selectedShiftPolicy || await AttendancePolicyService.getCurrent(input.companyId, branchId || undefined);
        const schedule = scheduleCheck(action, shift, now, policy);
        const stale = staleOpenSession(open, shift, policy, now);
        const sessionKey = open?.[0] || (shift ? `SHIFT:${shift.id}` : `UNSCHEDULED:${input.userId}:${zonedDateKey(now, policy.timezone)}:${claim.claimId}`);
        const sessionEvents = open?.[1] || history.filter((event) => effectiveSessionKey(event) === sessionKey);
        const allowedActions = availableActionsFrom(sessionEvents);
        const sequence = stale
            ? check('FAILED', 'La entrada anterior quedó fuera de su ventana válida y requiere corrección', 'STALE_OPEN_ATTENDANCE')
            : allowedActions.includes(action)
            ? check('PASSED', 'Secuencia de marcaje válida')
            : check('FAILED', `Acción fuera de secuencia; permitidas: ${allowedActions.join(', ') || 'ninguna'}`, 'INVALID_PUNCH_SEQUENCE');
        const deviceCheck = !device
            ? check('NOT_REQUIRED', 'Marcaje directo, sin kiosco')
            : device.branchId === branchId
                ? check('PASSED', 'Kiosco autorizado para la sucursal')
                : check('FAILED', 'El kiosco pertenece a otra sucursal', 'DEVICE_BRANCH_MISMATCH');
        const branchStatus = !branch
            ? check('FAILED', 'La sucursal no existe', 'BRANCH_NOT_FOUND')
            : branch.status !== 'ACTIVE'
                ? check('FAILED', 'La sucursal está inactiva', 'BRANCH_INACTIVE')
                : !geofenceVersion
                    ? check('FAILED', 'La sucursal no tiene una versión de geocerca auditable', 'GEOFENCE_VERSION_MISSING')
                    : check('PASSED', 'Sucursal activa y geocerca versionada');
        const geo = evaluateGeofence(
            { latitude, longitude, accuracyM },
            branchStatus.status === 'PASSED' ? geofenceVersion : null,
            policy,
        );
        const freshness = locationFreshness(clientAt, now, policy.requireGeolocation);
        let biometric: AttendanceCheck = policy.requireBiometric
            ? check('FAILED', 'No se proporcionó evidencia facial', 'FACE_CAPTURE_REQUIRED')
            : check('NOT_REQUIRED', 'Biometría no requerida');
        let faceStatus: EvidenceStatus = policy.requireBiometric ? 'FAILED' : 'NOT_REQUIRED';
        let livenessStatus: EvidenceStatus = policy.requireBiometric ? 'FAILED' : 'NOT_REQUIRED';
        let providerStatus: string | null = null;
        let providerScore: number | null = null;
        let biometricProfileId: number | null = null;
        let consumedChallengeId: string | null = null;
        let consumedChallenge: Awaited<ReturnType<typeof BiometricService.consumeChallenge>> | null = null;
        let challengeError: HrAttendanceError | null = null;
        try {
            consumedChallenge = await BiometricService.consumeChallenge({
                companyId: input.companyId, userId: input.userId,
                challengeId: input.challengeId, challengeToken: input.challengeToken,
                purpose: 'ATTENDANCE_PUNCH', action, useKey: idempotencyKey, requestHash: hash,
            });
            consumedChallengeId = input.challengeId;
        } catch (error) {
            challengeError = error instanceof HrAttendanceError ? error : new HrAttendanceError('Reto inválido', 401, 'CHALLENGE_INVALID');
        }
        if (challengeError?.code === 'IDEMPOTENCY_IN_PROGRESS') {
            const completed = await prisma.attendanceEvent.findFirst({ where: { companyId: input.companyId, idempotencyKey }, include: eventInclude });
            if (completed) return punchResult(completed);
            throw challengeError;
        }
        if (!challengeError && policy.requireBiometric && input.evidence && consumedChallenge) {
            const profile = await prisma.biometricProfile.findFirst({ where: { companyId: input.companyId, userId: input.userId, status: 'ACTIVE' } });
            if (!profile) {
                biometric = check('FAILED', 'No existe un perfil biométrico activo', 'BIOMETRIC_PROFILE_REQUIRED');
            } else if (!profile.retentionExpiresAt || profile.retentionExpiresAt <= now) {
                biometric = check('FAILED', 'El perfil biométrico expiró y debe reenrolarse', 'BIOMETRIC_RETENTION_EXPIRED');
            } else if (profile.consentVersion !== policy.biometricConsentVersion) {
                biometric = check('FAILED', 'El consentimiento biométrico debe renovarse', 'BIOMETRIC_CONSENT_STALE');
            } else {
                biometricProfileId = profile.id;
                try {
                    const verification = await provider.verifyOneToOne(
                        input.evidence,
                        decryptBiometricTemplate(profile.templateRef),
                        {
                            tenantRef: String(input.companyId),
                            subjectRef: String(input.userId),
                            challengeRef: consumedChallenge.id,
                            livenessAction: livenessActionFromNonce(consumedChallenge.nonce),
                            requireLiveness: policy.requireLiveness,
                        },
                    );
                    providerStatus = verification.providerStatus;
                    providerScore = verification.score;
                    faceStatus = verification.matched ? 'PASSED' : 'FAILED';
                    livenessStatus = verification.livenessPassed ? 'PASSED' : 'FAILED';
                    if (!verification.livenessPassed && policy.requireLiveness) biometric = check('FAILED', 'Prueba de vida fallida', 'LIVENESS_FAILED');
                    else if (!verification.matched) biometric = check('FAILED', 'El rostro no coincide con el perfil 1:1', 'FACE_NOT_MATCHED', verification.score);
                    else biometric = check('PASSED', 'Verificación facial 1:1 superada', undefined, verification.score);
                } catch (error) {
                    if (error instanceof FaceEvidenceRejectedError) {
                        faceStatus = 'FAILED';
                        livenessStatus = error.code.includes('LIVENESS') ? 'FAILED' : 'ERROR';
                        providerStatus = error.code;
                        biometric = check('FAILED', error.message, error.code);
                    } else {
                        faceStatus = 'ERROR';
                        livenessStatus = 'ERROR';
                        providerStatus = error instanceof FaceProviderUnavailableError ? 'UNAVAILABLE' : 'ERROR';
                        biometric = error instanceof FaceProviderUnavailableError
                            ? check('REVIEW', 'Proveedor facial no disponible', 'FACE_PROVIDER_UNAVAILABLE')
                            : check('REVIEW', 'El proveedor facial devolvió un error', 'FACE_PROVIDER_ERROR');
                    }
                }
            }
        }
        const checks = {
            schedule, geofence: geo.geofence, locationAccuracy: geo.locationAccuracy,
            locationFreshness: freshness, biometric, sequence, device: deviceCheck, branchAuthorization, branchStatus,
            policySnapshot: effectivePolicySnapshot(policy),
        };
        let decision: 'ACCEPTED' | 'REVIEW' | 'REJECTED' = 'ACCEPTED';
        const reasonCodes: string[] = [];
        const primaryReasonCodes: string[] = [];
        const addReason = (value?: string | null) => { if (value && !reasonCodes.includes(value)) reasonCodes.push(value); };
        const addPrimaryReason = (value?: string | null) => {
            addReason(value);
            if (value && !primaryReasonCodes.includes(value)) primaryReasonCodes.push(value);
        };
        if (challengeError) { decision = 'REJECTED'; addPrimaryReason(challengeError.code); }
        if (sequence.status === 'FAILED') { decision = 'REJECTED'; addPrimaryReason(sequence.reasonCode); }
        if (deviceCheck.status === 'FAILED') { decision = 'REJECTED'; addPrimaryReason(deviceCheck.reasonCode); }
        if (branchAuthorization.status === 'FAILED') { decision = 'REJECTED'; addPrimaryReason(branchAuthorization.reasonCode); }
        if (branchStatus.status === 'FAILED') { decision = 'REJECTED'; addPrimaryReason(branchStatus.reasonCode); }
        const scheduleMode = !shift ? (policy.allowUnscheduledPunch ? policy.unscheduledViolationMode : 'BLOCK') : policy.scheduleViolationMode;
        decision = decisionForViolation(decision, schedule.status, scheduleMode);
        // Identidad y ubicación son evidencia constitutiva del auto-marcaje. Una
        // configuración WARN nunca puede convertir evidencia fallida en tiempo
        // trabajado; las excepciones usan una corrección compensatoria auditada.
        decision = decisionForSelfEvidence(decision, geo.geofence.status);
        decision = decisionForSelfEvidence(decision, geo.locationAccuracy.status);
        decision = decisionForSelfEvidence(decision, freshness.status);
        decision = decisionForSelfEvidence(decision, biometric.status);
        // Infrastructure failures are never effective, even when the business
        // policy is WARN. The immutable attempt remains reviewable and returns 503.
        if ((providerStatus === 'UNAVAILABLE' || providerStatus === 'ERROR') && decision !== 'REJECTED') decision = 'REVIEW';
        [geo.geofence, geo.locationAccuracy, freshness, biometric, schedule].forEach((entry) => {
            if (entry.status === 'FAILED' || entry.status === 'REVIEW') addReason(entry.reasonCode);
        });
        [geo.geofence, geo.locationAccuracy, freshness, biometric].forEach((entry) => {
            if (entry.status === 'FAILED' || entry.status === 'REVIEW') addPrimaryReason(entry.reasonCode);
        });
        if ((schedule.status === 'FAILED' || schedule.status === 'REVIEW') && scheduleMode !== 'WARN') {
            addPrimaryReason(schedule.reasonCode);
        }
        const sequenceKey = decision === 'ACCEPTED' ? `${sessionKey}:${sessionEvents.length}` : null;
        const eventData: Prisma.AttendanceEventUncheckedCreateInput = {
            companyId: input.companyId, userId: input.userId, actorUserId: input.userId,
            branchId, scheduledShiftId: shift?.id || null, geofenceVersionId: geofenceVersion?.id || null, policyId: policy.id || null,
            policyVersion: policy.version, biometricProfileId, challengeId: consumedChallengeId,
            deviceId: device?.id || null,
            idempotencyKey, requestHash: hash, sessionKey, sequenceKey,
            action, source: device ? 'KIOSK' : 'SELF', serverAt: now, clientAt,
            latitude: latitude === null ? null : new Prisma.Decimal(latitude),
            longitude: longitude === null ? null : new Prisma.Decimal(longitude),
            locationAccuracyM: accuracyM === null ? null : new Prisma.Decimal(accuracyM),
            distanceM: geo.distanceM === null ? null : new Prisma.Decimal(geo.distanceM),
            faceStatus, livenessStatus, providerStatus, providerScore: providerScore === null ? null : new Prisma.Decimal(providerScore),
            decision, reasonCode: decision === 'ACCEPTED' ? null : primaryReasonCodes[0] || reasonCodes[0] || null, reasonCodes: json(reasonCodes),
            message: decision === 'ACCEPTED'
                ? 'Marcaje aceptado'
                : decision === 'REVIEW'
                    ? 'Marcaje enviado a revisión'
                    : challengeError?.message || (sequence.status === 'FAILED' ? sequence.message : 'Marcaje rechazado'),
            checks: json(checks),
        };
        let event: EventForApi;
        try {
            event = await prisma.$transaction(async (tx) => {
                const localDate = new Date(`${zonedDateKey(now, policy.timezone)}T00:00:00.000Z`);
                const period = await lockAttendanceDatePeriod(tx, input.companyId, localDate);
                await lockAttendanceSubject(tx, input.companyId, input.userId);
                const periodClosed = period?.status === 'CLOSED';
                let transactionalDecision: 'ACCEPTED' | 'REVIEW' | 'REJECTED' = periodClosed ? 'REJECTED' : decision;
                let transactionalReasonCodes = periodClosed
                    ? [...new Set([...reasonCodes, 'ATTENDANCE_PERIOD_CLOSED'])]
                    : reasonCodes;
                let transactionalSequenceKey = transactionalDecision === 'ACCEPTED' ? eventData.sequenceKey : null;
                let transactionalFailure: HrAttendanceError | null = null;
                if (transactionalDecision === 'ACCEPTED') {
                    try {
                        await assertGlobalCandidateState(tx, {
                            companyId: input.companyId, userId: input.userId, sessionKey, action,
                        });
                        const effective = await assertCandidateSequence(tx, {
                            companyId: input.companyId, userId: input.userId, sessionKey,
                            action, serverAt: now,
                        });
                        transactionalSequenceKey = `${sessionKey}:${effective.length}`;
                    } catch (candidateError) {
                        if (!(candidateError instanceof HrAttendanceError)) throw candidateError;
                        transactionalFailure = candidateError;
                        transactionalDecision = 'REJECTED';
                        transactionalSequenceKey = null;
                        transactionalReasonCodes = [...new Set([...transactionalReasonCodes, candidateError.code || 'CONCURRENT_SEQUENCE'])];
                    }
                }
                const created = await tx.attendanceEvent.create({
                    data: {
                        ...eventData,
                        sequenceKey: transactionalSequenceKey,
                        decision: transactionalDecision,
                        reasonCode: transactionalReasonCodes[0] || null,
                        reasonCodes: json(transactionalReasonCodes),
                        message: periodClosed
                            ? 'Marcaje rechazado porque el periodo de asistencia está cerrado'
                            : transactionalFailure?.message || eventData.message,
                        checks: periodClosed ? json({
                            ...checks,
                            periodStatus: check('FAILED', 'El periodo de asistencia está cerrado', 'ATTENDANCE_PERIOD_CLOSED'),
                        }) : transactionalFailure ? json({
                            ...checks,
                            sequence: check('FAILED', transactionalFailure.message, transactionalFailure.code || 'CONCURRENT_SEQUENCE'),
                        }) : eventData.checks,
                    },
                    include: eventInclude,
                });
                const completed = await tx.attendancePunchRequest.updateMany({
                    where: {
                        id: claim.claimId, companyId: input.companyId, status: 'PROCESSING',
                        requestHash: hash, attempts: claim.leaseAttempt, leaseExpiresAt: { gt: now },
                    },
                    data: { status: 'COMPLETED', eventId: created.id, leaseExpiresAt: now },
                });
                if (completed.count !== 1) throw new HrAttendanceError('La reclamación idempotente cambió concurrentemente', 409, 'IDEMPOTENCY_LOST');
                if (device) await tx.attendanceDevice.updateMany({ where: { id: device.id, companyId: input.companyId, status: 'ACTIVE' }, data: { lastSeenAt: now } });
                await AuditLogService.log({
                    companyId: input.companyId, userId: input.userId, entityType: 'AttendanceEvent', entityId: created.id,
                    action: 'CREATE', details: { action, decision: transactionalDecision, reasonCodes: transactionalReasonCodes, branchId, scheduledShiftId: shift?.id || null, attendancePeriodId: period?.id || null },
                }, tx);
                return created;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
            const duplicate = await prisma.attendanceEvent.findFirst({ where: { companyId: input.companyId, idempotencyKey }, include: eventInclude });
            if (duplicate) {
                if (duplicate.requestHash !== hash) throw new HrAttendanceError('Idempotency-Key reutilizada con otro contenido', 409, 'IDEMPOTENCY_MISMATCH');
                await prisma.attendancePunchRequest.updateMany({
                    where: {
                        id: claim.claimId, companyId: input.companyId, status: 'PROCESSING',
                        attempts: claim.leaseAttempt,
                    },
                    data: { status: 'COMPLETED', eventId: duplicate.id, leaseExpiresAt: now },
                });
                return punchResult(duplicate);
            }
            event = await prisma.$transaction(async (tx) => {
                await lockAttendanceSubject(tx, input.companyId, input.userId);
                const created = await tx.attendanceEvent.create({
                    data: {
                        ...eventData, challengeId: null, sequenceKey: null, decision: 'REJECTED', reasonCode: 'CONCURRENT_SEQUENCE',
                        reasonCodes: json([...reasonCodes, 'CONCURRENT_SEQUENCE']), message: 'Marcaje rechazado por concurrencia de secuencia',
                    }, include: eventInclude,
                });
                const completed = await tx.attendancePunchRequest.updateMany({
                    where: {
                        id: claim.claimId, companyId: input.companyId, status: 'PROCESSING',
                        attempts: claim.leaseAttempt,
                    },
                    data: { status: 'COMPLETED', eventId: created.id, leaseExpiresAt: now },
                });
                if (completed.count !== 1) throw new HrAttendanceError('La reclamación idempotente perdió su lease', 409, 'IDEMPOTENCY_LOST');
                await AuditLogService.log({
                    companyId: input.companyId, userId: input.userId, entityType: 'AttendanceEvent', entityId: created.id,
                    action: 'CREATE', details: { action, decision: 'REJECTED', reasonCodes: ['CONCURRENT_SEQUENCE'] },
                }, tx);
                return created;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        }
        return punchResult(event);
    }

    static async listEvents(companyId: number, filters: {
        dateFrom?: string; dateTo?: string; branchId?: number; userId?: number; action?: string; decision?: string; page?: number; limit?: number;
    }, scopeBranchId?: number) {
        const page = filters.page || 1;
        const limit = Math.min(filters.limit || 25, 100);
        const where: Prisma.AttendanceEventWhereInput = { companyId };
        const branchId = scopeBranchId || filters.branchId;
        if (branchId) where.branchId = branchId;
        if (filters.userId) where.userId = filters.userId;
        if (filters.action) where.action = actionValue(filters.action);
        if (filters.decision) {
            const decision = filters.decision === 'REVIEW_REQUIRED' ? 'REVIEW' : filters.decision;
            if (!['ACCEPTED', 'REVIEW', 'REJECTED'].includes(decision)) throw new HrAttendanceError('decision inválida');
            where.decision = decision as 'ACCEPTED' | 'REVIEW' | 'REJECTED';
        }
        if (filters.dateFrom || filters.dateTo) {
            if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
                throw new HrAttendanceError('Rango de fechas inválido');
            }
            if (branchId) {
                const timezone = (await prisma.branch.findFirst({
                    where: { id: branchId, companyId }, select: { timezone: true },
                }))?.timezone;
                if (!timezone) throw new HrAttendanceError('Sucursal no encontrada en la empresa', 404);
                const from = filters.dateFrom ? dateBounds(filters.dateFrom, timezone).start : null;
                const to = filters.dateTo ? dateBounds(filters.dateTo, timezone).end : null;
                where.serverAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
            } else {
                const branches = await prisma.branch.findMany({
                    where: { companyId }, select: { id: true, timezone: true },
                });
                const branchIdsByTimezone = new Map<string, number[]>();
                for (const branch of branches) {
                    const ids = branchIdsByTimezone.get(branch.timezone) || [];
                    ids.push(branch.id);
                    branchIdsByTimezone.set(branch.timezone, ids);
                }
                const ranges: Prisma.AttendanceEventWhereInput[] = [];
                for (const [timezone, ids] of branchIdsByTimezone) {
                    const from = filters.dateFrom ? dateBounds(filters.dateFrom, timezone).start : null;
                    const to = filters.dateTo ? dateBounds(filters.dateTo, timezone).end : null;
                    ranges.push({
                        branchId: { in: ids },
                        serverAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) },
                    });
                }
                const companyTimezone = (await AttendancePolicyService.getCurrent(companyId)).timezone;
                const companyFrom = filters.dateFrom ? dateBounds(filters.dateFrom, companyTimezone).start : null;
                const companyTo = filters.dateTo ? dateBounds(filters.dateTo, companyTimezone).end : null;
                ranges.push({
                    branchId: null,
                    serverAt: { ...(companyFrom ? { gte: companyFrom } : {}), ...(companyTo ? { lt: companyTo } : {}) },
                });
                where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: ranges }];
            }
        }
        const [items, total] = await prisma.$transaction([
            prisma.attendanceEvent.findMany({ where, include: eventInclude, orderBy: [{ serverAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
            prisma.attendanceEvent.count({ where }),
        ]);
        return { items: items.map(mapAttendanceEvent), pagination: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) } };
    }

    static async review(eventId: number, companyId: number, reviewerId: number, decisionValue: unknown, reasonValue: unknown, scopeBranchId?: number) {
        if (decisionValue !== 'APPROVED' && decisionValue !== 'REJECTED') throw new HrAttendanceError('decision inválida');
        const reason = requiredText(reasonValue, 'reason', 2000);
        const event = await prisma.attendanceEvent.findFirst({
            where: { id: eventId, companyId, decision: 'REVIEW', ...(scopeBranchId ? { branchId: scopeBranchId } : {}) },
            select: {
                id: true, userId: true, branchId: true, scheduledShiftId: true, sessionKey: true,
                action: true, serverAt: true, providerStatus: true, faceStatus: true, livenessStatus: true, checks: true,
                scheduledShift: { select: { startAt: true } },
            },
        });
        if (!event) throw new HrAttendanceError('Evento no encontrado', 404);
        const eventPolicy = await AttendancePolicyService.getCurrent(companyId, event.branchId || undefined);
        const eventLocalDate = new Date(`${zonedDateKey(event.serverAt, eventPolicy.timezone)}T00:00:00.000Z`);
        await prisma.$transaction(async (tx) => {
            const period = await lockAttendanceDatePeriod(tx, companyId, eventLocalDate);
            await lockAttendanceSubject(tx, companyId, event.userId);
            const stillReviewable = await tx.attendanceEvent.findFirst({
                where: { id: event.id, companyId, decision: 'REVIEW', review: { is: null } },
                select: { id: true },
            });
            if (!stillReviewable) throw new HrAttendanceError('El evento ya fue revisado concurrentemente', 409, 'REVIEW_ALREADY_DECIDED');
            if (decisionValue === 'APPROVED') {
                if (period?.status === 'CLOSED') {
                    throw new HrAttendanceError('Reabra el periodo de asistencia antes de aprobar este marcaje', 409, 'ATTENDANCE_PERIOD_CLOSED');
                }
                const checks = (event.checks || {}) as unknown as Record<string, AttendanceCheck | undefined>;
                const evidenceChecks = ['geofence', 'locationAccuracy', 'locationFreshness', 'biometric']
                    .map((key) => checks[key])
                    .filter((entry): entry is AttendanceCheck => Boolean(entry));
                const evidenceFailed = evidenceChecks.some((entry) => entry.status === 'FAILED' || entry.status === 'REVIEW');
                if (
                    event.providerStatus === 'UNAVAILABLE'
                    || event.providerStatus === 'ERROR'
                    || event.faceStatus === 'ERROR'
                    || event.livenessStatus === 'ERROR'
                    || evidenceFailed
                ) {
                    throw new HrAttendanceError(
                        'La evidencia facial o geográfica falló y no puede aprobarse como marcaje; use una corrección compensatoria',
                        409,
                        'ATTENDANCE_EVIDENCE_NOT_APPROVABLE',
                    );
                }
                if (event.branchId) {
                    const authorizationInstant = event.scheduledShift?.startAt || event.serverAt;
                    const authorizationDate = new Date(`${zonedDateKey(authorizationInstant, eventPolicy.timezone)}T00:00:00.000Z`);
                    const assignment = await tx.employeeBranchAssignment.findFirst({
                        where: {
                            companyId, branchId: event.branchId,
                            employee: { companyId, userId: event.userId },
                            effectiveFrom: { lte: authorizationDate },
                            OR: [{ effectiveTo: null }, { effectiveTo: { gte: authorizationDate } }],
                            branch: { status: 'ACTIVE' },
                        },
                        select: { id: true },
                    });
                    if (!assignment) {
                        throw new HrAttendanceError('La adscripción RH de la sucursal ya no es válida para este marcaje', 409, 'EMPLOYEE_BRANCH_ASSIGNMENT_REQUIRED');
                    }
                }
                const sessionKey = event.sessionKey || (event.scheduledShiftId
                    ? `SHIFT:${event.scheduledShiftId}`
                    : `LEGACY:${event.userId}:${event.branchId || 'NONE'}:${event.serverAt.toISOString().slice(0, 10)}`);
                await assertGlobalCandidateState(tx, {
                    id: event.id, companyId, userId: event.userId, sessionKey,
                    action: event.action,
                });
                await assertCandidateSequence(tx, {
                    id: event.id, companyId, userId: event.userId, sessionKey,
                    action: event.action, serverAt: event.serverAt,
                });
                const reserved = await tx.attendanceEvent.updateMany({
                    where: { id: event.id, companyId, decision: 'REVIEW', sequenceKey: null },
                    data: { sessionKey, sequenceKey: `${sessionKey}:APPROVED:${event.id}` },
                });
                if (reserved.count !== 1) throw new HrAttendanceError('No fue posible reservar la secuencia revisada', 409, 'REVIEW_SEQUENCE_CONFLICT');
            }
            const review = await tx.attendanceReview.create({
                data: { companyId, attendanceEventId: eventId, reviewerId, decision: decisionValue, reason },
            });
            await AuditLogService.log({
                companyId, userId: reviewerId, entityType: 'AttendanceReview', entityId: review.id,
                action: 'CREATE', details: { attendanceEventId: eventId, decision: decisionValue, reason },
            }, tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        const updated = await prisma.attendanceEvent.findFirst({ where: { id: eventId, companyId }, include: eventInclude });
        if (!updated) throw new HrAttendanceError('Evento no encontrado', 404);
        return mapAttendanceEvent(updated);
    }

    static async manual(input: {
        companyId: number; actorUserId: number; idempotencyKey: string; userId: unknown; branchId: unknown;
        action: unknown; occurredAt: unknown; reason: unknown; scheduleId?: unknown; targetEventId?: unknown;
    }, scopeBranchId?: number) {
        const userId = positiveId(input.userId, 'userId');
        const branchId = positiveId(input.branchId, 'branchId');
        if (scopeBranchId && branchId !== scopeBranchId) throw new HrAttendanceError('No autorizado para otra sucursal', 403);
        const action = actionValue(input.action);
        const occurredAt = parseClientDate(input.occurredAt, 'occurredAt');
        if (!occurredAt) throw new HrAttendanceError('occurredAt es requerido');
        if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw new HrAttendanceError('occurredAt no puede estar en el futuro');
        const reason = requiredText(input.reason, 'reason', 2000);
        const idempotencyKey = requiredText(input.idempotencyKey, 'Idempotency-Key', 128);
        const requestedShiftId = input.scheduleId === undefined || input.scheduleId === null ? null : positiveId(input.scheduleId, 'scheduleId');
        const targetEventId = input.targetEventId === undefined || input.targetEventId === null ? null : positiveId(input.targetEventId, 'targetEventId');
        const hash = requestHash({ userId, branchId, action, occurredAt: occurredAt.toISOString(), reason, requestedShiftId, targetEventId });
        const prior = await prisma.attendanceEvent.findFirst({ where: { companyId: input.companyId, idempotencyKey }, include: eventInclude });
        if (prior) {
            if (prior.requestHash !== hash) throw new HrAttendanceError('Idempotency-Key reutilizada con otro contenido', 409);
            return mapAttendanceEvent(prior);
        }
        const [user, branch, requestedShift, target] = await Promise.all([
            prisma.user.findFirst({
                where: {
                    id: userId, companyId: input.companyId, status: 'ACTIVE',
                    accountType: 'INTERNAL', employee: { is: { status: 'ACTIVE' } },
                },
                select: { id: true },
            }),
            prisma.branch.findFirst({
                where: { id: branchId, companyId: input.companyId, status: 'ACTIVE' },
                select: { id: true, timezone: true },
            }),
            requestedShiftId ? prisma.scheduledShift.findFirst({
                where: {
                    id: requestedShiftId, companyId: input.companyId, branchId,
                    status: 'SCHEDULED', schedule: { status: 'PUBLISHED' },
                    OR: [
                        { assignmentOverride: { is: { assignedUserId: userId } } },
                        { assignmentOverride: { is: null }, userId },
                    ],
                }, select: { id: true },
            }) : null,
            targetEventId ? prisma.attendanceEvent.findFirst({
                where: {
                    id: targetEventId, companyId: input.companyId, userId, branchId, action,
                    OR: [
                        { decision: 'REJECTED' },
                        { decision: 'REVIEW', review: { is: null } },
                        { decision: 'REVIEW', review: { is: { decision: 'REJECTED' } } },
                    ],
                    adjustments: { none: {} },
                },
                select: { id: true, scheduledShiftId: true, sessionKey: true },
            }) : null,
        ]);
        if (!user) throw new HrAttendanceError('Usuario no encontrado en la empresa', 404);
        if (!branch) throw new HrAttendanceError('Sucursal activa no encontrada en la empresa', 404);
        if (requestedShiftId && !requestedShift) throw new HrAttendanceError('El turno debe estar publicado, programado y asignado al usuario', 409, 'MANUAL_SHIFT_INVALID');
        if (targetEventId && !target) throw new HrAttendanceError('El evento objetivo no es compensable o ya fue ajustado', 409, 'MANUAL_TARGET_INVALID');
        const policy = await AttendancePolicyService.getCurrent(input.companyId, branchId);
        if (!policy.allowManualFallback) throw new HrAttendanceError('La política no permite ajustes manuales de asistencia', 409, 'MANUAL_FALLBACK_DISABLED');
        let scheduledShiftId = requestedShift?.id || target?.scheduledShiftId || null;
        if (!scheduledShiftId) {
            const candidates = (await effectiveShifts(
                input.companyId,
                userId,
                new Date(occurredAt.getTime() - 36 * 3600000),
                new Date(occurredAt.getTime() + 36 * 3600000),
            )).filter((candidate) => candidate.branchId === branchId);
            scheduledShiftId = selectShift(candidates, occurredAt, policy)?.id || null;
        }
        if (!scheduledShiftId) {
            throw new HrAttendanceError('Un marcaje manual independiente requiere un turno publicado aplicable', 409, 'MANUAL_PUBLISHED_SHIFT_REQUIRED');
        }
        const assignmentDate = new Date(`${zonedDateKey(occurredAt, branch.timezone)}T00:00:00.000Z`);
        const branchAssignment = await prisma.employeeBranchAssignment.findFirst({
            where: {
                companyId: input.companyId, branchId,
                employee: { companyId: input.companyId, userId },
                effectiveFrom: { lte: assignmentDate },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: assignmentDate } }],
                branch: { status: 'ACTIVE' },
            },
            select: { id: true },
        });
        if (!branchAssignment) {
            throw new HrAttendanceError('El empleado no tiene una adscripción RH vigente para la sucursal', 403, 'EMPLOYEE_BRANCH_ASSIGNMENT_REQUIRED');
        }
        const geofenceVersion = await prisma.branchGeofenceVersion.findFirst({
            where: { companyId: input.companyId, branchId }, orderBy: { version: 'desc' }, select: { id: true },
        });
        const sessionKey = target?.sessionKey || `SHIFT:${scheduledShiftId}`;
        const event = await prisma.$transaction(async (tx) => {
            const localDate = new Date(`${zonedDateKey(occurredAt, policy.timezone)}T00:00:00.000Z`);
            const period = await lockAttendanceDatePeriod(tx, input.companyId, localDate);
            if (period?.status === 'CLOSED') {
                throw new HrAttendanceError('Reabra el periodo de asistencia antes de crear un marcaje manual', 409, 'ATTENDANCE_PERIOD_CLOSED');
            }
            await lockAttendanceSubject(tx, input.companyId, userId);
            if (targetEventId) {
                const availableTarget = await tx.attendanceEvent.findFirst({
                    where: { id: targetEventId, companyId: input.companyId, adjustments: { none: {} } },
                    select: { id: true },
                });
                if (!availableTarget) throw new HrAttendanceError('El evento objetivo fue ajustado concurrentemente', 409, 'MANUAL_TARGET_CONFLICT');
            }
            await assertGlobalCandidateState(tx, {
                companyId: input.companyId, userId, sessionKey, action,
            });
            await assertCandidateSequence(tx, {
                companyId: input.companyId, userId, sessionKey, action, serverAt: occurredAt,
            });
            const created = await tx.attendanceEvent.create({
                data: {
                    companyId: input.companyId, userId, actorUserId: input.actorUserId, branchId,
                    scheduledShiftId, geofenceVersionId: geofenceVersion?.id || null,
                    policyId: policy.id || null, policyVersion: policy.version,
                    adjustsEventId: targetEventId, idempotencyKey, requestHash: hash,
                    sessionKey, sequenceKey: `${sessionKey}:MANUAL:${idempotencyKey}`,
                    action, source: 'MANUAL', serverAt: occurredAt, clientAt: occurredAt,
                    faceStatus: 'NOT_REQUIRED', livenessStatus: 'NOT_REQUIRED', providerStatus: 'MANUAL',
                    decision: 'ACCEPTED', reasonCode: 'MANUAL_ADJUSTMENT', reasonCodes: json(['MANUAL_ADJUSTMENT']),
                    message: reason, checks: json({
                        manual: check('PASSED', 'Ajuste manual autorizado'),
                        policySnapshot: effectivePolicySnapshot(policy),
                    }),
                }, include: eventInclude,
            });
            await AuditLogService.log({
                companyId: input.companyId, userId: input.actorUserId, entityType: 'AttendanceEvent', entityId: created.id,
                action: 'CREATE', details: { source: 'MANUAL', subjectUserId: userId, branchId, action, adjustsEventId: targetEventId, reason },
            }, tx);
            return created;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return mapAttendanceEvent(event);
    }
}

export class AttendanceDeviceService {
    static async list(companyId: number, scopeBranchId?: number) {
        return prisma.attendanceDevice.findMany({
            where: { companyId, ...(scopeBranchId ? { branchId: scopeBranchId } : {}) },
            select: {
                id: true, branchId: true, name: true, code: true, status: true,
                revokedAt: true, lastSeenAt: true, createdAt: true,
                branch: { select: { id: true, name: true, code: true } },
            }, orderBy: [{ status: 'asc' }, { name: 'asc' }],
        });
    }

    static async create(companyId: number, actorUserId: number, input: { branchId?: unknown; name?: unknown; code?: unknown }, scopeBranchId?: number) {
        const branchId = positiveId(input.branchId, 'branchId');
        if (scopeBranchId && branchId !== scopeBranchId) throw new HrAttendanceError('No autorizado para otra sucursal', 403);
        const branch = await prisma.branch.findFirst({ where: { id: branchId, companyId }, select: { id: true } });
        if (!branch) throw new HrAttendanceError('Sucursal no encontrada en la empresa', 404);
        const name = requiredText(input.name, 'name', 100);
        const code = requiredText(input.code, 'code', 50).toUpperCase();
        const key = randomBytes(32).toString('base64url');
        const keyHash = createHash('sha256').update(key).digest('hex');
        return prisma.$transaction(async (tx) => {
            const device = await tx.attendanceDevice.create({
                data: { companyId, branchId, name, code, keyHash, createdById: actorUserId },
                select: { id: true, branchId: true, name: true, code: true, status: true, createdAt: true },
            });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'AttendanceDevice', entityId: device.id,
                action: 'CREATE', details: { branchId, code },
            }, tx);
            return { ...device, key };
        });
    }

    static async revoke(id: number, companyId: number, actorUserId: number, scopeBranchId?: number) {
        const device = await prisma.attendanceDevice.findFirst({ where: { id, companyId, ...(scopeBranchId ? { branchId: scopeBranchId } : {}) }, select: { id: true, status: true } });
        if (!device) throw new HrAttendanceError('Dispositivo no encontrado', 404);
        return prisma.$transaction(async (tx) => {
            const updated = await tx.attendanceDevice.updateMany({
                where: { id, companyId, status: 'ACTIVE' },
                data: { status: 'REVOKED', revokedAt: new Date(), revokedById: actorUserId },
            });
            if (updated.count !== 1) throw new HrAttendanceError('Dispositivo ya revocado o modificado', 409);
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'AttendanceDevice', entityId: id,
                action: 'DELETE', details: { transition: 'REVOKED' },
            }, tx);
            return tx.attendanceDevice.findUnique({
                where: { id }, select: { id: true, branchId: true, name: true, code: true, status: true, revokedAt: true },
            });
        });
    }
}
