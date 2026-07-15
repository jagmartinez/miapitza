import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { isValidTimeZone, getZonedParts, zonedDateKey, zonedDateTimeToUtc } from '../utils/timezone';
import { AuditLogService } from './audit-log.service';

export class HrScheduleError extends Error {
    constructor(message: string, public readonly statusCode = 400) {
        super(message);
        this.name = 'HrScheduleError';
    }
}

const SCHEDULE_STATUSES = ['DRAFT', 'PUBLISHED', 'SUPERSEDED', 'CANCELLED'] as const;
const SWAP_STATUSES = ['PENDING', 'ACCEPTED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

type ScheduleStatusValue = typeof SCHEDULE_STATUSES[number];

function requiredText(value: unknown, field: string, max = 191): string {
    if (typeof value !== 'string' || !value.trim()) throw new HrScheduleError(`${field} es requerido`);
    const normalized = value.trim();
    if (normalized.length > max) throw new HrScheduleError(`${field} excede ${max} caracteres`);
    return normalized;
}

function optionalText(value: unknown, field: string, max = 5000): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') throw new HrScheduleError(`${field} debe ser texto`);
    const normalized = value.trim();
    if (normalized.length > max) throw new HrScheduleError(`${field} excede ${max} caracteres`);
    return normalized || null;
}

function positiveInt(value: unknown, field: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new HrScheduleError(`${field} debe ser un entero positivo`);
    return parsed;
}

async function ensureSchedulableUser(
    companyId: number,
    userId: number,
    db: Prisma.TransactionClient | typeof prisma = prisma,
) {
    const user = await db.user.findFirst({
        where: {
            id: userId, companyId, status: 'ACTIVE', accountType: 'INTERNAL',
            employee: { is: { status: 'ACTIVE' } },
        },
        select: { id: true },
    });
    if (!user) throw new HrScheduleError('El horario requiere un usuario interno con empleado activo', 403);
}

function nonNegativeInt(value: unknown, field: string, fallback = 0): number {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) throw new HrScheduleError(`${field} debe ser un entero mayor o igual a cero`);
    return parsed;
}

function optionalId(value: unknown, field: string): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return positiveInt(value, field);
}

function parseTimeMinute(value: unknown, field: string): number {
    const text = requiredText(value, field, 5);
    const match = /^(\d{2}):(\d{2})$/.exec(text);
    if (!match) throw new HrScheduleError(`${field} debe tener formato HH:mm`);
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) throw new HrScheduleError(`${field} no es una hora válida`);
    return hour * 60 + minute;
}

function minuteToTime(value: number): string {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function parseDateKey(value: unknown, field: string): { key: string; date: Date } {
    const text = requiredText(value, field, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) throw new HrScheduleError(`${field} debe tener formato YYYY-MM-DD`);
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (
        date.getUTCFullYear() !== Number(match[1]) ||
        date.getUTCMonth() !== Number(match[2]) - 1 ||
        date.getUTCDate() !== Number(match[3])
    ) throw new HrScheduleError(`${field} no es una fecha válida`);
    return { key: text, date };
}

function parseWeekStart(value: unknown): { key: string; date: Date } {
    const parsed = parseDateKey(value, 'weekStart');
    if (parsed.date.getUTCDay() !== 1) throw new HrScheduleError('weekStart debe ser lunes');
    return parsed;
}

function addDateKey(key: string, days: number): string {
    const date = parseDateKey(key, 'date').date;
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function parseInstant(value: unknown, field: string): Date {
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
        throw new HrScheduleError(`${field} debe incluir zona horaria u offset`);
    }
    const result = new Date(value);
    if (Number.isNaN(result.getTime())) throw new HrScheduleError(`${field} no es un instante válido`);
    return result;
}

function localDateTime(dateKey: string, minute: number, timeZone: string, addDays = 0): Date {
    const date = parseDateKey(dateKey, 'date').date;
    date.setUTCDate(date.getUTCDate() + addDays);
    try {
        return zonedDateTimeToUtc({
            year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
            hour: Math.floor(minute / 60), minute: minute % 60, second: 0,
        }, timeZone);
    } catch (error) {
        if (error instanceof RangeError) {
            throw new HrScheduleError(`La hora local no existe en ${timeZone} por un cambio de horario`);
        }
        throw error;
    }
}

interface Interval {
    userId: number;
    startAt: Date;
    endAt: Date;
    status?: 'SCHEDULED' | 'CANCELLED';
    id?: number;
}

export function assertNoShiftOverlaps(intervals: Interval[]): void {
    const byUser = new Map<number, Interval[]>();
    for (const interval of intervals.filter((entry) => entry.status !== 'CANCELLED')) {
        const values = byUser.get(interval.userId) || [];
        values.push(interval);
        byUser.set(interval.userId, values);
    }
    for (const [userId, values] of byUser) {
        values.sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
        for (let index = 1; index < values.length; index += 1) {
            if (values[index].startAt < values[index - 1].endAt) {
                throw new HrScheduleError(`El usuario ${userId} tiene turnos solapados`, 409);
            }
        }
    }
}

function assertScopedBranch(branchId: number, scopeBranchId?: number) {
    if (scopeBranchId && branchId !== scopeBranchId) {
        throw new HrScheduleError('No autorizado para operar horarios de otra sucursal', 403);
    }
}

function assertCompanyWideScheduleMutation(scopeBranchId?: number) {
    if (scopeBranchId) {
        throw new HrScheduleError(
            'Los horarios semanales se publican a nivel empresa; se requiere alcance de todas las sucursales',
            403,
        );
    }
}

function isPrismaConflict(error: unknown, code: string): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

async function serializableTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await prisma.$transaction(operation, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            });
        } catch (error) {
            if (!isPrismaConflict(error, 'P2034')) throw error;
            if (attempt === maxAttempts) {
                throw new HrScheduleError('La operación tuvo un conflicto concurrente; recargue e intente nuevamente', 409);
            }
        }
    }
    throw new HrScheduleError('No fue posible completar la operación concurrente', 409);
}

async function cancelOpenSwapsForSchedule(
    tx: Prisma.TransactionClient,
    scheduleId: number,
    companyId: number,
    actorUserId: number,
    reason: 'SCHEDULE_CANCELLED' | 'SCHEDULE_SUPERSEDED',
) {
    const openRequests = await tx.shiftSwapRequest.findMany({
        where: { companyId, scheduleId, status: { in: ['PENDING', 'ACCEPTED'] } },
        select: { id: true },
    });
    if (openRequests.length === 0) return;
    const requestIds = openRequests.map((request) => request.id);
    await tx.shiftSwapRequest.updateMany({
        where: { companyId, id: { in: requestIds }, status: { in: ['PENDING', 'ACCEPTED'] } },
        data: {
            status: 'CANCELLED', decidedById: actorUserId, decidedAt: new Date(),
            decisionNotes: reason, openRequesterKey: null, openOfferedKey: null,
        },
    });
    await tx.shiftSwapReservation.deleteMany({
        where: { companyId, swapRequestId: { in: requestIds } },
    });
    await AuditLogService.log({
        companyId, userId: actorUserId, entityType: 'WeeklySchedule', entityId: scheduleId,
        action: 'UPDATE', details: { transition: 'CANCEL_OPEN_SWAPS', reason, requestIds },
    }, tx);
}

const templateInclude = {
    branch: { select: { id: true, name: true, code: true, status: true, timezone: true } },
    jobPosition: { select: { id: true, name: true, code: true, active: true } },
} satisfies Prisma.ShiftTemplateInclude;

function mapTemplate<T extends { startMinute: number; endMinute: number }>(template: T) {
    return {
        ...template,
        startTime: minuteToTime(template.startMinute),
        endTime: minuteToTime(template.endMinute),
        crossesMidnight: template.endMinute <= template.startMinute,
    };
}

export class ShiftTemplateService {
    static async list(companyId: number, filters: { branchId?: number; active?: boolean } = {}, scopeBranchId?: number) {
        const branchId = scopeBranchId || filters.branchId;
        const templates = await prisma.shiftTemplate.findMany({
            where: { companyId, ...(branchId ? { branchId } : {}), ...(filters.active !== undefined ? { active: filters.active } : {}) },
            include: templateInclude,
            orderBy: [{ active: 'desc' }, { name: 'asc' }],
        });
        return templates.map(mapTemplate);
    }

    static async getById(id: number, companyId: number, scopeBranchId?: number) {
        const template = await prisma.shiftTemplate.findFirst({
            where: { id, companyId, ...(scopeBranchId ? { branchId: scopeBranchId } : {}) },
            include: templateInclude,
        });
        if (!template) throw new HrScheduleError('Plantilla de turno no encontrada', 404);
        return mapTemplate(template);
    }

    private static async normalize(companyId: number, input: Record<string, unknown>, existing?: {
        branchId: number; jobPositionId: number | null; startMinute: number; endMinute: number;
        breakMinutes: number; paidBreak: boolean; name: string; code: string; notes: string | null;
    }, scopeBranchId?: number) {
        const branchId = input.branchId !== undefined ? positiveInt(input.branchId, 'branchId') : existing?.branchId;
        if (!branchId) throw new HrScheduleError('branchId es requerido');
        assertScopedBranch(branchId, scopeBranchId);
        const branch = await prisma.branch.findFirst({
            where: { id: branchId, companyId, status: 'ACTIVE' },
            select: { id: true, timezone: true },
        });
        if (!branch) throw new HrScheduleError('Sucursal activa no encontrada en la empresa', 404);
        const jobPositionId = input.jobPositionId !== undefined
            ? optionalId(input.jobPositionId, 'jobPositionId')
            : existing?.jobPositionId;
        if (jobPositionId && !await prisma.jobPosition.findFirst({ where: { id: jobPositionId, companyId, active: true }, select: { id: true } })) {
            throw new HrScheduleError('Puesto activo no encontrado en la empresa', 404);
        }
        const startMinute = input.startTime !== undefined ? parseTimeMinute(input.startTime, 'startTime') : existing?.startMinute;
        const endMinute = input.endTime !== undefined ? parseTimeMinute(input.endTime, 'endTime') : existing?.endMinute;
        if (startMinute === undefined || endMinute === undefined) throw new HrScheduleError('startTime y endTime son requeridos');
        if (startMinute === endMinute) throw new HrScheduleError('La plantilla no puede representar un turno de 24 horas');
        const durationMinutes = endMinute > startMinute ? endMinute - startMinute : 1440 - startMinute + endMinute;
        const breakMinutes = input.breakMinutes !== undefined
            ? nonNegativeInt(input.breakMinutes, 'breakMinutes')
            : existing?.breakMinutes || 0;
        if (breakMinutes >= durationMinutes) throw new HrScheduleError('El descanso debe ser menor que la duración del turno');
        return {
            branchId, jobPositionId,
            name: input.name !== undefined ? requiredText(input.name, 'name', 100) : existing?.name || '',
            code: input.code !== undefined ? requiredText(input.code, 'code', 30).toUpperCase() : existing?.code || '',
            startMinute, endMinute, breakMinutes,
            paidBreak: input.paidBreak !== undefined ? Boolean(input.paidBreak) : existing?.paidBreak || false,
            timezone: branch.timezone,
            notes: input.notes !== undefined ? optionalText(input.notes, 'notes') : existing?.notes,
        };
    }

    static async create(companyId: number, input: Record<string, unknown>, actorUserId: number, scopeBranchId?: number) {
        const data = await this.normalize(companyId, input, undefined, scopeBranchId);
        const template = await prisma.$transaction(async (tx) => {
            const created = await tx.shiftTemplate.create({ data: { companyId, ...data } });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'ShiftTemplate', entityId: created.id,
                action: 'CREATE', details: { code: created.code, branchId: created.branchId },
            }, tx);
            return created;
        });
        return mapTemplate(template);
    }

    static async update(id: number, companyId: number, input: Record<string, unknown>, actorUserId: number, scopeBranchId?: number) {
        const existing = await this.getById(id, companyId, scopeBranchId);
        const data = await this.normalize(companyId, input, existing, scopeBranchId);
        const active = input.active !== undefined ? Boolean(input.active) : existing.active;
        const template = await prisma.$transaction(async (tx) => {
            const updated = await tx.shiftTemplate.update({ where: { id }, data: { ...data, active } });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'ShiftTemplate', entityId: id,
                action: 'UPDATE', details: { fields: Object.keys(input) },
            }, tx);
            return updated;
        });
        return mapTemplate(template);
    }
}

const scheduleInclude = {
    createdBy: { select: { id: true, name: true } },
    publishedBy: { select: { id: true, name: true } },
    shifts: {
        include: {
            user: { select: { id: true, name: true, username: true, accountType: true, status: true } },
            branch: { select: { id: true, name: true, code: true, timezone: true } },
            jobPosition: { select: { id: true, name: true, code: true } },
            shiftTemplate: { select: { id: true, name: true, code: true } },
            assignmentOverride: {
                select: {
                    id: true, assignedUserId: true, swapRequestId: true, effectiveAt: true,
                    assignedUser: { select: { id: true, name: true, username: true, accountType: true, status: true } },
                },
            },
        },
        orderBy: [{ startAt: 'asc' as const }, { userId: 'asc' as const }],
    },
    acknowledgements: { select: { id: true, userId: true, acknowledgedAt: true } },
} satisfies Prisma.WeeklyScheduleInclude;

function effectiveShiftUserId(shift: { userId: number; assignmentOverride?: { assignedUserId: number } | null }): number {
    return shift.assignmentOverride?.assignedUserId ?? shift.userId;
}

function mapSchedule<T extends { shifts: Array<{
    userId: number; startAt: Date; endAt: Date; timezoneSnapshot: string;
    user?: unknown; assignmentOverride?: { assignedUserId: number; assignedUser?: unknown } | null;
}> }>(schedule: T) {
    return {
        ...schedule,
        shifts: schedule.shifts.map((shift) => {
            const start = getZonedParts(shift.startAt, shift.timezoneSnapshot);
            const end = getZonedParts(shift.endAt, shift.timezoneSnapshot);
            return {
                ...shift,
                originalUserId: shift.userId,
                originalUser: shift.user,
                userId: effectiveShiftUserId(shift),
                user: shift.assignmentOverride?.assignedUser ?? shift.user,
                date: zonedDateKey(shift.startAt, shift.timezoneSnapshot),
                startTime: `${String(start.hour).padStart(2, '0')}:${String(start.minute).padStart(2, '0')}`,
                endTime: `${String(end.hour).padStart(2, '0')}:${String(end.minute).padStart(2, '0')}`,
            };
        }),
    };
}

export interface ScheduledShiftInput {
    userId: number;
    branchId: number;
    jobPositionId?: number | null;
    shiftTemplateId?: number | null;
    date?: string;
    startTime?: string;
    endTime?: string;
    startAt?: string;
    endAt?: string;
    breakMinutes?: number;
    paidBreak?: boolean;
    notes?: string | null;
    status?: 'SCHEDULED' | 'CANCELLED';
}

interface NormalizedScheduledShift {
    companyId: number;
    scheduleId: number;
    userId: number;
    branchId: number;
    jobPositionId: number | null;
    shiftTemplateId: number | null;
    startAt: Date;
    endAt: Date;
    timezoneSnapshot: string;
    breakMinutes: number;
    paidBreak: boolean;
    notes: string | null;
    status: 'SCHEDULED' | 'CANCELLED';
}

export class WeeklyScheduleService {
    static async list(companyId: number, filters: {
        weekStart?: string; status?: string; branchId?: number; userId?: number; jobPositionId?: number;
    } = {}, scopeBranchId?: number) {
        const where: Prisma.WeeklyScheduleWhereInput = { companyId };
        if (filters.weekStart) where.weekStart = parseWeekStart(filters.weekStart).date;
        if (filters.status) {
            if (!SCHEDULE_STATUSES.includes(filters.status as ScheduleStatusValue)) throw new HrScheduleError('Estado de agenda inválido');
            where.status = filters.status as ScheduleStatusValue;
        }
        const branchId = scopeBranchId || filters.branchId;
        const effectiveUserFilter = filters.userId ? {
            OR: [
                { assignmentOverride: { is: { assignedUserId: filters.userId } } },
                { userId: filters.userId, assignmentOverride: { is: null } },
            ],
        } : {};
        if (branchId || filters.userId || filters.jobPositionId) {
            where.shifts = { some: {
                ...(branchId ? { branchId } : {}),
                ...effectiveUserFilter,
                ...(filters.jobPositionId ? { jobPositionId: filters.jobPositionId } : {}),
            } };
        }
        const shiftFilter = {
            ...(branchId ? { branchId } : {}),
            ...effectiveUserFilter,
            ...(filters.jobPositionId ? { jobPositionId: filters.jobPositionId } : {}),
        };
        const schedules = await prisma.weeklySchedule.findMany({
            where,
            include: {
                ...scheduleInclude,
                shifts: {
                    ...scheduleInclude.shifts,
                    ...(branchId || filters.userId || filters.jobPositionId ? { where: shiftFilter } : {}),
                },
            },
            orderBy: [{ weekStart: 'desc' }, { version: 'desc' }],
        });
        return schedules.map((schedule) => {
            const mapped = mapSchedule(schedule);
            if (!branchId && !filters.userId && !filters.jobPositionId) return mapped;
            const visibleUsers = new Set(mapped.shifts.map((shift) => shift.userId));
            return {
                ...mapped,
                acknowledgements: mapped.acknowledgements.filter((entry) => visibleUsers.has(entry.userId)),
            };
        });
    }

    static async getById(id: number, companyId: number, scopeBranchId?: number) {
        const schedule = await prisma.weeklySchedule.findFirst({ where: { id, companyId }, include: scheduleInclude });
        if (!schedule) throw new HrScheduleError('Agenda semanal no encontrada', 404);
        if (scopeBranchId && schedule.shifts.length > 0 && schedule.shifts.some((shift) => shift.branchId !== scopeBranchId)) {
            throw new HrScheduleError('La agenda contiene turnos fuera de la sucursal autorizada', 403);
        }
        return mapSchedule(schedule);
    }

    static async createDraft(companyId: number, input: {
        weekStart?: string; notes?: string | null; shifts?: ScheduledShiftInput[];
    }, actorUserId: number, scopeBranchId?: number) {
        assertCompanyWideScheduleMutation(scopeBranchId);
        const week = parseWeekStart(input.weekStart);
        const shifts = await this.normalizeShifts(companyId, 0, week.key, input.shifts || [], scopeBranchId);
        const [latest, currentPublished] = await Promise.all([
            prisma.weeklySchedule.findFirst({ where: { companyId, weekStart: week.date }, orderBy: { version: 'desc' }, select: { version: true } }),
            prisma.weeklySchedule.findFirst({ where: { companyId, weekStart: week.date, status: 'PUBLISHED' }, select: { id: true } }),
        ]);
        const schedule = await prisma.$transaction(async (tx) => {
            const schedule = await tx.weeklySchedule.create({
                data: {
                    companyId, weekStart: week.date, version: (latest?.version || 0) + 1,
                    supersedesScheduleId: currentPublished?.id || null,
                    createdById: actorUserId,
                    notes: optionalText(input.notes, 'notes'),
                },
            });
            if (shifts.length) {
                await tx.scheduledShift.createMany({
                    data: shifts.map((shift) => ({ ...shift, scheduleId: schedule.id })),
                });
            }
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'WeeklySchedule', entityId: schedule.id,
                action: 'CREATE', details: { weekStart: week.key, version: schedule.version, shiftCount: shifts.length },
            }, tx);
            return schedule;
        });
        return this.getById(schedule.id, companyId, scopeBranchId);
    }

    private static async normalizeShifts(
        companyId: number,
        scheduleId: number,
        weekStart: string,
        shifts: ScheduledShiftInput[],
        scopeBranchId?: number,
    ): Promise<NormalizedScheduledShift[]> {
        if (!Array.isArray(shifts)) throw new HrScheduleError('shifts debe ser un arreglo');
        if (shifts.length > 500) throw new HrScheduleError('Una agenda no puede contener más de 500 turnos');
        for (const [index, shift] of shifts.entries()) {
            if (!shift || typeof shift !== 'object' || Array.isArray(shift)) {
                throw new HrScheduleError(`shifts[${index}] debe ser un objeto`);
            }
            if (shift.paidBreak !== undefined && typeof shift.paidBreak !== 'boolean') {
                throw new HrScheduleError(`shifts[${index}].paidBreak debe ser booleano`);
            }
        }
        const branchIds = Array.from(new Set(shifts.map((shift) => positiveInt(shift.branchId, 'branchId'))));
        const userIds = Array.from(new Set(shifts.map((shift) => positiveInt(shift.userId, 'userId'))));
        const positionIds = Array.from(new Set(shifts.map((shift) => optionalId(shift.jobPositionId, 'jobPositionId')).filter((id): id is number => !!id)));
        const templateIds = Array.from(new Set(shifts.map((shift) => optionalId(shift.shiftTemplateId, 'shiftTemplateId')).filter((id): id is number => !!id)));
        branchIds.forEach((branchId) => assertScopedBranch(branchId, scopeBranchId));
        const [branches, users, positions, templates] = await Promise.all([
            prisma.branch.findMany({ where: { companyId, id: { in: branchIds }, status: 'ACTIVE' }, select: { id: true, timezone: true } }),
            prisma.user.findMany({
                where: {
                    companyId, id: { in: userIds }, status: 'ACTIVE',
                    accountType: 'INTERNAL', employee: { is: { status: 'ACTIVE' } },
                },
                select: { id: true, branchId: true, allowedBranches: { select: { branchId: true } } },
            }),
            prisma.jobPosition.findMany({ where: { companyId, id: { in: positionIds }, active: true }, select: { id: true } }),
            prisma.shiftTemplate.findMany({ where: { companyId, id: { in: templateIds }, active: true }, select: { id: true, branchId: true } }),
        ]);
        if (branches.length !== branchIds.length) throw new HrScheduleError('Una o más sucursales no son válidas para la empresa', 404);
        if (users.length !== userIds.length) throw new HrScheduleError('Uno o más usuarios no son válidos para la empresa', 404);
        if (positions.length !== positionIds.length) throw new HrScheduleError('Uno o más puestos no son válidos para la empresa', 404);
        if (templates.length !== templateIds.length) throw new HrScheduleError('Una o más plantillas no son válidas para la empresa', 404);
        const branchMap = new Map(branches.map((branch) => [branch.id, branch]));
        const userMap = new Map(users.map((user) => [user.id, user]));
        const templateMap = new Map(templates.map((template) => [template.id, template]));
        const weekEnd = addDateKey(weekStart, 6);
        const normalized = shifts.map((shift): NormalizedScheduledShift => {
            const userId = positiveInt(shift.userId, 'userId');
            const branchId = positiveInt(shift.branchId, 'branchId');
            const branch = branchMap.get(branchId)!;
            const user = userMap.get(userId)!;
            if (user.branchId !== branchId && !user.allowedBranches.some((entry) => entry.branchId === branchId)) {
                throw new HrScheduleError(`El usuario ${userId} no está autorizado para la sucursal ${branchId}`, 409);
            }
            const jobPositionId = optionalId(shift.jobPositionId, 'jobPositionId') || null;
            const shiftTemplateId = optionalId(shift.shiftTemplateId, 'shiftTemplateId') || null;
            if (shiftTemplateId && templateMap.get(shiftTemplateId)?.branchId !== branchId) {
                throw new HrScheduleError('La plantilla seleccionada pertenece a otra sucursal');
            }
            const hasLocal = shift.date !== undefined || shift.startTime !== undefined || shift.endTime !== undefined;
            const hasInstant = shift.startAt !== undefined || shift.endAt !== undefined;
            if (hasLocal && hasInstant) throw new HrScheduleError('Use date/startTime/endTime o startAt/endAt, no ambos');
            let startAt: Date;
            let endAt: Date;
            if (hasLocal) {
                const dateKey = parseDateKey(shift.date, 'date').key;
                const startMinute = parseTimeMinute(shift.startTime, 'startTime');
                const endMinute = parseTimeMinute(shift.endTime, 'endTime');
                if (startMinute === endMinute) throw new HrScheduleError('El turno no puede durar 24 horas');
                startAt = localDateTime(dateKey, startMinute, branch.timezone);
                endAt = localDateTime(dateKey, endMinute, branch.timezone, endMinute <= startMinute ? 1 : 0);
            } else {
                startAt = parseInstant(shift.startAt, 'startAt');
                endAt = parseInstant(shift.endAt, 'endAt');
            }
            if (endAt <= startAt) throw new HrScheduleError('endAt debe ser posterior a startAt');
            const durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
            if (durationMinutes > 48 * 60) throw new HrScheduleError('Un turno no puede exceder 48 horas');
            const localStart = zonedDateKey(startAt, branch.timezone);
            if (localStart < weekStart || localStart > weekEnd) {
                throw new HrScheduleError(`El turno debe iniciar dentro de la semana ${weekStart}`);
            }
            const breakMinutes = nonNegativeInt(shift.breakMinutes, 'breakMinutes');
            if (breakMinutes >= durationMinutes) throw new HrScheduleError('El descanso debe ser menor que la duración del turno');
            const status = shift.status || 'SCHEDULED';
            if (status !== 'SCHEDULED' && status !== 'CANCELLED') throw new HrScheduleError('Estado de turno inválido');
            return {
                companyId, scheduleId, userId, branchId, jobPositionId, shiftTemplateId,
                startAt, endAt, timezoneSnapshot: branch.timezone, breakMinutes,
                paidBreak: shift.paidBreak ?? false, notes: optionalText(shift.notes, 'notes') || null, status,
            };
        });
        assertNoShiftOverlaps(normalized);
        return normalized;
    }

    static async replaceDraftShifts(
        id: number,
        companyId: number,
        input: { expectedRevision?: number; shifts?: ScheduledShiftInput[]; notes?: string | null },
        actorUserId: number,
        scopeBranchId?: number,
    ) {
        assertCompanyWideScheduleMutation(scopeBranchId);
        const schedule = await this.getById(id, companyId, scopeBranchId);
        if (schedule.status !== 'DRAFT') throw new HrScheduleError('Una agenda publicada es inmutable', 409);
        const expectedRevision = nonNegativeInt(input.expectedRevision, 'expectedRevision');
        if (expectedRevision !== schedule.revision) throw new HrScheduleError('La agenda fue modificada por otro usuario', 409);
        const weekStart = schedule.weekStart.toISOString().slice(0, 10);
        const shifts = await this.normalizeShifts(companyId, id, weekStart, input.shifts || [], scopeBranchId);
        await prisma.$transaction(async (tx) => {
            const claimed = await tx.weeklySchedule.updateMany({
                where: { id, companyId, status: 'DRAFT', revision: expectedRevision },
                data: { revision: expectedRevision + 1, ...(input.notes !== undefined ? { notes: optionalText(input.notes, 'notes') } : {}) },
            });
            if (claimed.count !== 1) throw new HrScheduleError('La agenda fue modificada por otro usuario', 409);
            await tx.scheduledShift.deleteMany({ where: { scheduleId: id } });
            if (shifts.length) await tx.scheduledShift.createMany({ data: shifts });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'WeeklySchedule', entityId: id,
                action: 'UPDATE', details: { revision: expectedRevision + 1, shiftCount: shifts.length },
            }, tx);
        });
        return this.getById(id, companyId, scopeBranchId);
    }

    static async copy(
        sourceId: number,
        companyId: number,
        targetWeekStart: string,
        actorUserId: number,
        scopeBranchId?: number,
    ) {
        assertCompanyWideScheduleMutation(scopeBranchId);
        const source = await this.getById(sourceId, companyId, scopeBranchId);
        const target = parseWeekStart(targetWeekStart);
        const sourceDate = source.weekStart;
        const dayDelta = Math.round((target.date.getTime() - sourceDate.getTime()) / 86400000);
        const copiedShifts = await this.normalizeShifts(
            companyId,
            0,
            target.key,
            source.shifts.map((shift) => {
                const mapped = shift as typeof shift & {
                    originalUserId: number; date: string; startTime: string; endTime: string;
                };
                return {
                    userId: mapped.originalUserId,
                    branchId: mapped.branchId,
                    jobPositionId: mapped.jobPositionId,
                    shiftTemplateId: mapped.shiftTemplateId,
                    date: addDateKey(mapped.date, dayDelta),
                    startTime: mapped.startTime,
                    endTime: mapped.endTime,
                    breakMinutes: mapped.breakMinutes,
                    paidBreak: mapped.paidBreak,
                    notes: mapped.notes,
                    status: mapped.status,
                };
            }),
        );
        const [latest, currentPublished] = await Promise.all([
            prisma.weeklySchedule.findFirst({ where: { companyId, weekStart: target.date }, orderBy: { version: 'desc' }, select: { version: true } }),
            prisma.weeklySchedule.findFirst({ where: { companyId, weekStart: target.date, status: 'PUBLISHED' }, select: { id: true } }),
        ]);
        const draft = await prisma.$transaction(async (tx) => {
            const draft = await tx.weeklySchedule.create({
                data: {
                    companyId, weekStart: target.date, version: (latest?.version || 0) + 1,
                    supersedesScheduleId: currentPublished?.id || null,
                    createdById: actorUserId,
                    notes: source.notes ? `Copia: ${source.notes}` : `Copia de agenda ${source.id}`,
                },
            });
            if (copiedShifts.length) {
                await tx.scheduledShift.createMany({
                    data: copiedShifts.map((shift) => ({ ...shift, scheduleId: draft.id })),
                });
            }
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'WeeklySchedule', entityId: draft.id,
                action: 'CREATE', details: { copiedFrom: sourceId, targetWeekStart: target.key },
            }, tx);
            return draft;
        });
        return this.getById(draft.id, companyId, scopeBranchId);
    }

    private static async assertNoPublishedConflicts(
        schedule: Awaited<ReturnType<typeof WeeklyScheduleService.getById>>,
        tx: Prisma.TransactionClient,
    ) {
        assertNoShiftOverlaps(schedule.shifts);
        if (!schedule.shifts.some((shift) => shift.status === 'SCHEDULED')) throw new HrScheduleError('No se puede publicar una agenda sin turnos');
        const starts = schedule.shifts.map((shift) => shift.startAt.getTime());
        const ends = schedule.shifts.map((shift) => shift.endAt.getTime());
        const existing = await tx.scheduledShift.findMany({
            where: {
                companyId: schedule.companyId,
                OR: [
                    { userId: { in: Array.from(new Set(schedule.shifts.map((shift) => shift.userId))) } },
                    { assignmentOverride: { is: { assignedUserId: { in: Array.from(new Set(schedule.shifts.map((shift) => shift.userId))) } } } },
                ],
                status: 'SCHEDULED',
                schedule: { status: 'PUBLISHED' },
                ...(schedule.supersedesScheduleId ? { scheduleId: { not: schedule.supersedesScheduleId } } : {}),
                startAt: { lt: new Date(Math.max(...ends)) },
                endAt: { gt: new Date(Math.min(...starts)) },
            },
            select: {
                id: true, userId: true, startAt: true, endAt: true,
                assignmentOverride: { select: { assignedUserId: true } },
            },
        });
        for (const proposed of schedule.shifts.filter((shift) => shift.status === 'SCHEDULED')) {
            if (existing.some((shift) => effectiveShiftUserId(shift) === proposed.userId && shift.startAt < proposed.endAt && shift.endAt > proposed.startAt)) {
                throw new HrScheduleError(`El usuario ${proposed.userId} ya tiene un turno publicado en ese intervalo`, 409);
            }
        }
    }

    private static async assertPublishableUsers(
        schedule: Awaited<ReturnType<typeof WeeklyScheduleService.getById>>,
        tx: Prisma.TransactionClient,
    ) {
        const scheduledShifts = schedule.shifts.filter((shift) => shift.status === 'SCHEDULED');
        const userIds = Array.from(new Set(scheduledShifts.map((shift) => shift.userId)));
        const users = await tx.user.findMany({
            where: {
                companyId: schedule.companyId,
                id: { in: userIds },
                status: 'ACTIVE',
                accountType: 'INTERNAL',
                employee: { is: { status: 'ACTIVE' } },
            },
            select: {
                id: true,
                branchId: true,
                allowedBranches: { select: { branchId: true } },
            },
        });
        if (users.length !== userIds.length) {
            throw new HrScheduleError(
                'La agenda contiene usuarios que ya no son internos activos con empleado activo',
                409,
            );
        }
        const usersById = new Map(users.map((user) => [user.id, user]));
        for (const shift of scheduledShifts) {
            const user = usersById.get(shift.userId)!;
            if (user.branchId !== shift.branchId && !user.allowedBranches.some((entry) => entry.branchId === shift.branchId)) {
                throw new HrScheduleError(
                    `El usuario ${shift.userId} ya no esta autorizado para la sucursal ${shift.branchId}`,
                    409,
                );
            }
        }
    }

    static async publish(id: number, companyId: number, expectedRevision: number, actorUserId: number, scopeBranchId?: number) {
        assertCompanyWideScheduleMutation(scopeBranchId);
        const schedule = await this.getById(id, companyId, scopeBranchId);
        if (schedule.status !== 'DRAFT') throw new HrScheduleError('Sólo una agenda DRAFT puede publicarse', 409);
        if (schedule.revision !== expectedRevision) throw new HrScheduleError('La agenda fue modificada por otro usuario', 409);
        const weekKey = schedule.weekStart.toISOString().slice(0, 10);
        const publicationKey = `${companyId}:${weekKey}`;
        try {
            await serializableTransaction(async (tx) => {
                await this.assertPublishableUsers(schedule, tx);
                await this.assertNoPublishedConflicts(schedule, tx);
                if (schedule.supersedesScheduleId) {
                    const superseded = await tx.weeklySchedule.updateMany({
                        where: {
                            id: schedule.supersedesScheduleId, companyId, status: 'PUBLISHED', publicationKey,
                        },
                        data: { status: 'SUPERSEDED', publicationKey: null, supersededAt: new Date(), revision: { increment: 1 } },
                    });
                    if (superseded.count !== 1) throw new HrScheduleError('La versión publicada cambió; recargue la agenda', 409);
                    await cancelOpenSwapsForSchedule(
                        tx, schedule.supersedesScheduleId, companyId, actorUserId, 'SCHEDULE_SUPERSEDED',
                    );
                    await AuditLogService.log({
                        companyId, userId: actorUserId, entityType: 'WeeklySchedule', entityId: schedule.supersedesScheduleId,
                        action: 'UPDATE', details: { transition: 'SUPERSEDE', supersededById: id },
                    }, tx);
                } else {
                    const current = await tx.weeklySchedule.findFirst({ where: { companyId, weekStart: schedule.weekStart, status: 'PUBLISHED' }, select: { id: true } });
                    if (current) throw new HrScheduleError('Ya existe una versión publicada no contemplada por este borrador', 409);
                }
                const published = await tx.weeklySchedule.updateMany({
                    where: { id, companyId, status: 'DRAFT', revision: expectedRevision },
                    data: {
                        status: 'PUBLISHED', publicationKey, publishedAt: new Date(), publishedById: actorUserId,
                        revision: expectedRevision + 1,
                    },
                });
                if (published.count !== 1) throw new HrScheduleError('La agenda fue modificada por otro usuario', 409);
                await AuditLogService.log({
                    companyId, userId: actorUserId, entityType: 'WeeklySchedule', entityId: id,
                    action: 'UPDATE', details: { transition: 'PUBLISH', weekStart: weekKey, version: schedule.version },
                }, tx);
            });
        } catch (error) {
            if (isPrismaConflict(error, 'P2002')) {
                throw new HrScheduleError('Otra versión fue publicada concurrentemente', 409);
            }
            throw error;
        }
        return this.getById(id, companyId, scopeBranchId);
    }

    static async cancel(id: number, companyId: number, expectedRevision: number, actorUserId: number, scopeBranchId?: number) {
        assertCompanyWideScheduleMutation(scopeBranchId);
        const schedule = await this.getById(id, companyId, scopeBranchId);
        if (schedule.status !== 'DRAFT' && schedule.status !== 'PUBLISHED') throw new HrScheduleError('La agenda ya no puede cancelarse', 409);
        const result = await prisma.$transaction(async (tx) => {
            const cancelled = await tx.weeklySchedule.updateMany({
                where: { id, companyId, status: schedule.status, revision: expectedRevision },
                data: { status: 'CANCELLED', publicationKey: null, cancelledAt: new Date(), revision: expectedRevision + 1 },
            });
            if (cancelled.count !== 1) throw new HrScheduleError('La agenda fue modificada por otro usuario', 409);
            await cancelOpenSwapsForSchedule(tx, id, companyId, actorUserId, 'SCHEDULE_CANCELLED');
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'WeeklySchedule', entityId: id,
                action: 'CANCEL', details: { priorStatus: schedule.status },
            }, tx);
            return cancelled;
        });
        return result;
    }

    static async acknowledge(scheduleId: number, companyId: number, userId: number) {
        await ensureSchedulableUser(companyId, userId);
        const schedule = await prisma.weeklySchedule.findFirst({
            where: {
                id: scheduleId, companyId, status: 'PUBLISHED',
                shifts: { some: {
                    status: 'SCHEDULED',
                    OR: [
                        { userId, assignmentOverride: { is: null } },
                        { assignmentOverride: { is: { assignedUserId: userId } } },
                    ],
                } },
            },
            select: { id: true },
        });
        if (!schedule) throw new HrScheduleError('No existe una agenda publicada asignada al usuario', 404);
        return prisma.scheduleAcknowledgement.upsert({
            where: { scheduleId_userId: { scheduleId, userId } },
            update: { acknowledgedAt: new Date() },
            create: { companyId, scheduleId, userId },
        });
    }

    static async getMySchedule(companyId: number, userId: number, weekStart: string) {
        await ensureSchedulableUser(companyId, userId);
        const week = parseWeekStart(weekStart);
        const schedule = await prisma.weeklySchedule.findFirst({
            where: { companyId, weekStart: week.date, status: 'PUBLISHED' },
            include: scheduleInclude,
        });
        if (!schedule) return null;
        const mapped = mapSchedule(schedule);
        const effective = mapped.shifts.filter((shift) => shift.userId === userId && shift.status === 'SCHEDULED');
        return {
            id: schedule.id, weekStart: schedule.weekStart, version: schedule.version,
            revision: schedule.revision, status: schedule.status,
            publishedAt: schedule.publishedAt,
            acknowledgedAt: schedule.acknowledgements.find((entry) => entry.userId === userId)?.acknowledgedAt || null,
            shifts: effective.sort((left, right) => left.startAt.getTime() - right.startAt.getTime()),
        };
    }
}

export class ShiftSwapService {
    static async list(companyId: number, filters: { status?: string; userId?: number } = {}, scopeBranchId?: number) {
        if (filters.status && !SWAP_STATUSES.includes(filters.status as typeof SWAP_STATUSES[number])) throw new HrScheduleError('Estado de intercambio inválido');
        return prisma.shiftSwapRequest.findMany({
            where: {
                companyId,
                ...(filters.status ? { status: filters.status as typeof SWAP_STATUSES[number] } : {}),
                ...(filters.userId ? { OR: [{ requestedById: filters.userId }, { targetUserId: filters.userId }] } : {}),
                ...(scopeBranchId ? { requesterShift: { branchId: scopeBranchId } } : {}),
            },
            include: {
                requesterShift: { include: { branch: { select: { id: true, name: true } } } },
                offeredShift: true,
                requestedBy: { select: { id: true, name: true } },
                targetUser: { select: { id: true, name: true } },
                decidedBy: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    static async create(companyId: number, input: {
        requesterShiftId?: number; targetUserId?: number; offeredShiftId?: number | null; reason?: string | null;
    }, requestedById: number) {
        await ensureSchedulableUser(companyId, requestedById);
        const requesterShiftId = positiveInt(input.requesterShiftId, 'requesterShiftId');
        const targetUserId = positiveInt(input.targetUserId, 'targetUserId');
        if (targetUserId === requestedById) throw new HrScheduleError('El usuario destino debe ser diferente');
        const shift = await prisma.scheduledShift.findFirst({
            where: {
                id: requesterShiftId, companyId, userId: requestedById, status: 'SCHEDULED',
                assignmentOverride: { is: null }, schedule: { status: 'PUBLISHED' },
            },
            include: { schedule: { select: { id: true } } },
        });
        if (!shift) throw new HrScheduleError('Turno publicado del solicitante no encontrado', 404);
        if (shift.startAt <= new Date()) throw new HrScheduleError('No se puede intercambiar un turno iniciado o pasado', 409);
        const target = await prisma.user.findFirst({
            where: {
                id: targetUserId, companyId, status: 'ACTIVE',
                accountType: 'INTERNAL', employee: { is: { status: 'ACTIVE' } },
                OR: [{ branchId: shift.branchId }, { allowedBranches: { some: { branchId: shift.branchId } } }],
            },
            select: { id: true },
        });
        if (!target) throw new HrScheduleError('Usuario destino no elegible para la sucursal', 404);
        const offeredShiftId = optionalId(input.offeredShiftId, 'offeredShiftId') || null;
        if (offeredShiftId) {
            const offered = await prisma.scheduledShift.findFirst({
                where: {
                    id: offeredShiftId, companyId, userId: targetUserId, status: 'SCHEDULED',
                    scheduleId: shift.scheduleId, assignmentOverride: { is: null },
                },
                select: { id: true, branchId: true },
            });
            if (!offered) throw new HrScheduleError('Turno ofrecido no pertenece al usuario destino o a la misma agenda', 404);
            if (offered.branchId !== shift.branchId) {
                throw new HrScheduleError('Los turnos de un intercambio deben pertenecer a la misma sucursal', 409);
            }
        }
        return prisma.$transaction(async (tx) => {
            const request = await tx.shiftSwapRequest.create({
                data: {
                    companyId, scheduleId: shift.schedule.id, requesterShiftId, offeredShiftId,
                    requestedById, targetUserId, reason: optionalText(input.reason, 'reason'),
                    openRequesterKey: `${companyId}:${requesterShiftId}`,
                    openOfferedKey: offeredShiftId ? `${companyId}:${offeredShiftId}` : null,
                },
            });
            await tx.shiftSwapReservation.createMany({
                data: [requesterShiftId, ...(offeredShiftId ? [offeredShiftId] : [])].map((scheduledShiftId) => ({
                    companyId, swapRequestId: request.id, scheduledShiftId,
                })),
            });
            await AuditLogService.log({
                companyId, userId: requestedById, entityType: 'ShiftSwapRequest', entityId: request.id,
                action: 'CREATE', details: { requesterShiftId, offeredShiftId, targetUserId },
            }, tx);
            return request;
        });
    }

    static async respond(id: number, companyId: number, targetUserId: number, decision: 'ACCEPT' | 'REJECT') {
        if (decision !== 'ACCEPT' && decision !== 'REJECT') throw new HrScheduleError('Decisión inválida');
        return prisma.$transaction(async (tx) => {
            await ensureSchedulableUser(companyId, targetUserId, tx);
            const updated = await tx.shiftSwapRequest.updateMany({
                where: { id, companyId, targetUserId, status: 'PENDING' },
                data: {
                    status: decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
                    targetRespondedAt: new Date(),
                    ...(decision === 'REJECT' ? { openRequesterKey: null, openOfferedKey: null } : {}),
                },
            });
            if (updated.count !== 1) throw new HrScheduleError('Solicitud no encontrada o ya respondida', 409);
            if (decision === 'REJECT') await tx.shiftSwapReservation.deleteMany({ where: { swapRequestId: id, companyId } });
            await AuditLogService.log({
                companyId, userId: targetUserId, entityType: 'ShiftSwapRequest', entityId: id,
                action: 'UPDATE', details: { transition: decision },
            }, tx);
            return tx.shiftSwapRequest.findUnique({ where: { id } });
        });
    }

    private static async assertApprovalConflicts(tx: Prisma.TransactionClient, request: {
        requesterShiftId: number; offeredShiftId: number | null; requestedById: number; targetUserId: number;
        requesterShift: { startAt: Date; endAt: Date }; offeredShift: { startAt: Date; endAt: Date } | null;
    }, companyId: number) {
        const excludeIds = [request.requesterShiftId, ...(request.offeredShiftId ? [request.offeredShiftId] : [])];
        const targetConflict = await tx.scheduledShift.findFirst({
            where: {
                companyId, status: 'SCHEDULED', id: { notIn: excludeIds },
                schedule: { status: 'PUBLISHED' },
                OR: [
                    { userId: request.targetUserId, assignmentOverride: { is: null } },
                    { assignmentOverride: { is: { assignedUserId: request.targetUserId } } },
                ],
                startAt: { lt: request.requesterShift.endAt }, endAt: { gt: request.requesterShift.startAt },
            }, select: { id: true },
        });
        if (targetConflict) throw new HrScheduleError('El usuario destino tiene un turno solapado', 409);
        if (request.offeredShift) {
            const requesterConflict = await tx.scheduledShift.findFirst({
                where: {
                    companyId, status: 'SCHEDULED', id: { notIn: excludeIds },
                    schedule: { status: 'PUBLISHED' },
                    OR: [
                        { userId: request.requestedById, assignmentOverride: { is: null } },
                        { assignmentOverride: { is: { assignedUserId: request.requestedById } } },
                    ],
                    startAt: { lt: request.offeredShift.endAt }, endAt: { gt: request.offeredShift.startAt },
                }, select: { id: true },
            });
            if (requesterConflict) throw new HrScheduleError('El solicitante tiene un turno solapado con el turno ofrecido', 409);
        }
    }

    static async approve(id: number, companyId: number, actorUserId: number, notes?: string, scopeBranchId?: number) {
        return serializableTransaction(async (tx) => {
            const request = await tx.shiftSwapRequest.findFirst({
                where: {
                    id, companyId, status: 'ACCEPTED',
                    schedule: { status: 'PUBLISHED' },
                    ...(scopeBranchId ? {
                        requesterShift: { branchId: scopeBranchId },
                        OR: [{ offeredShiftId: null }, { offeredShift: { branchId: scopeBranchId } }],
                    } : {}),
                },
                include: { requesterShift: true, offeredShift: true },
            });
            if (!request) throw new HrScheduleError('Solicitud aceptada y vigente no encontrada', 404);
            const now = new Date();
            if (
                request.requesterShift.scheduleId !== request.scheduleId ||
                request.requesterShift.status !== 'SCHEDULED' ||
                request.requesterShift.startAt <= now ||
                (request.offeredShift && (
                    request.offeredShift.scheduleId !== request.scheduleId ||
                    request.offeredShift.status !== 'SCHEDULED' ||
                    request.offeredShift.startAt <= now
                ))
            ) {
                throw new HrScheduleError('Los turnos del intercambio ya no están vigentes', 409);
            }
            if (request.offeredShift && request.offeredShift.branchId !== request.requesterShift.branchId) {
                throw new HrScheduleError('Los turnos de un intercambio deben pertenecer a la misma sucursal', 409);
            }
            const expectedShiftIds = [request.requesterShiftId, ...(request.offeredShiftId ? [request.offeredShiftId] : [])];
            const reservationCount = await tx.shiftSwapReservation.count({
                where: { companyId, swapRequestId: id, scheduledShiftId: { in: expectedShiftIds } },
            });
            if (reservationCount !== expectedShiftIds.length) {
                throw new HrScheduleError('Las reservas del intercambio ya no están vigentes', 409);
            }
            const eligibleUsers = await tx.user.count({
                where: {
                    companyId, id: { in: [request.requestedById, request.targetUserId] }, status: 'ACTIVE',
                    accountType: 'INTERNAL', employee: { is: { status: 'ACTIVE' } },
                    OR: [
                        { branchId: request.requesterShift.branchId },
                        { allowedBranches: { some: { branchId: request.requesterShift.branchId } } },
                    ],
                },
            });
            if (eligibleUsers !== 2) {
                throw new HrScheduleError('Uno de los usuarios ya no está activo o habilitado para la sucursal', 409);
            }
            await this.assertApprovalConflicts(tx, request, companyId);
            const approved = await tx.shiftSwapRequest.updateMany({
                where: { id, companyId, status: 'ACCEPTED' },
                data: {
                    status: 'APPROVED', decidedById: actorUserId, decidedAt: new Date(),
                    decisionNotes: optionalText(notes, 'decisionNotes'),
                    openRequesterKey: null, openOfferedKey: null,
                },
            });
            if (approved.count !== 1) throw new HrScheduleError('La solicitud cambió concurrentemente', 409);
            await tx.shiftAssignmentOverride.createMany({
                data: [
                    {
                        companyId, scheduledShiftId: request.requesterShiftId,
                        assignedUserId: request.targetUserId, swapRequestId: id, assignedById: actorUserId,
                    },
                    ...(request.offeredShiftId ? [{
                        companyId, scheduledShiftId: request.offeredShiftId,
                        assignedUserId: request.requestedById, swapRequestId: id, assignedById: actorUserId,
                    }] : []),
                ],
            });
            await tx.shiftSwapReservation.deleteMany({ where: { swapRequestId: id, companyId } });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'ShiftSwapRequest', entityId: id,
                action: 'UPDATE', details: { transition: 'APPROVE' },
            }, tx);
            return tx.shiftSwapRequest.findUnique({ where: { id } });
        });
    }

    static async cancel(id: number, companyId: number, actorUserId: number, mayManage: boolean) {
        const request = await prisma.shiftSwapRequest.findFirst({ where: { id, companyId }, select: { id: true, requestedById: true, status: true } });
        if (!request) throw new HrScheduleError('Solicitud no encontrada', 404);
        if (!mayManage && request.requestedById !== actorUserId) throw new HrScheduleError('No autorizado para cancelar esta solicitud', 403);
        if (request.status !== 'PENDING' && request.status !== 'ACCEPTED') throw new HrScheduleError('La solicitud ya no puede cancelarse', 409);
        return prisma.$transaction(async (tx) => {
            const cancelled = await tx.shiftSwapRequest.updateMany({
                where: {
                    id, companyId, status: { in: ['PENDING', 'ACCEPTED'] },
                    ...(!mayManage ? { requestedById: actorUserId } : {}),
                },
                data: {
                    status: 'CANCELLED', decidedById: mayManage ? actorUserId : null,
                    decidedAt: new Date(), openRequesterKey: null, openOfferedKey: null,
                },
            });
            if (cancelled.count !== 1) throw new HrScheduleError('La solicitud cambió concurrentemente', 409);
            await tx.shiftSwapReservation.deleteMany({ where: { swapRequestId: id, companyId } });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'ShiftSwapRequest', entityId: id,
                action: 'CANCEL', details: { managed: mayManage, priorStatus: request.status },
            }, tx);
            return tx.shiftSwapRequest.findUnique({ where: { id } });
        });
    }
}

export class HolidayService {
    static async listCalendars(companyId: number, scopeBranchId?: number) {
        return prisma.holidayCalendar.findMany({
            where: { companyId },
            include: {
                holidays: {
                    ...(scopeBranchId ? { where: { OR: [{ branchId: null }, { branchId: scopeBranchId }] } } : {}),
                    orderBy: { date: 'asc' },
                },
            },
            orderBy: { name: 'asc' },
        });
    }

    static async listHolidays(companyId: number, filters: {
        calendarId?: number; branchId?: number; dateFrom?: string; dateTo?: string; weekStart?: string;
    } = {}, scopeBranchId?: number) {
        const where: Prisma.HolidayWhereInput = { companyId };
        if (filters.calendarId) where.calendarId = filters.calendarId;
        const branchId = scopeBranchId || filters.branchId;
        if (scopeBranchId) where.OR = [{ branchId: null }, { branchId: scopeBranchId }];
        else if (branchId) where.OR = [{ branchId: null }, { branchId }];
        const week = filters.weekStart ? parseWeekStart(filters.weekStart).key : undefined;
        const dateFrom = week || filters.dateFrom;
        const dateTo = week ? addDateKey(week, 6) : filters.dateTo;
        if (dateFrom || dateTo) {
            where.date = {
                ...(dateFrom ? { gte: parseDateKey(dateFrom, 'dateFrom').date } : {}),
                ...(dateTo ? { lte: parseDateKey(dateTo, 'dateTo').date } : {}),
            };
        }
        return prisma.holiday.findMany({
            where,
            include: {
                calendar: { select: { id: true, name: true, timezone: true, active: true } },
                branch: { select: { id: true, name: true, code: true } },
            },
            orderBy: [{ date: 'asc' }, { name: 'asc' }],
        });
    }

    static async createCalendar(companyId: number, input: { name?: string; timezone?: string; active?: boolean }, actorUserId: number, scopeBranchId?: number) {
        if (scopeBranchId) throw new HrScheduleError('Se requiere alcance de empresa para administrar calendarios', 403);
        const name = requiredText(input.name, 'name', 100);
        const timezone = input.timezone?.trim() || 'America/Managua';
        if (!isValidTimeZone(timezone)) throw new HrScheduleError('Zona horaria inválida');
        return prisma.$transaction(async (tx) => {
            const calendar = await tx.holidayCalendar.create({ data: { companyId, name, timezone, active: input.active ?? true } });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'HolidayCalendar', entityId: calendar.id,
                action: 'CREATE', details: { name, timezone },
            }, tx);
            return calendar;
        });
    }

    static async updateCalendar(id: number, companyId: number, input: { name?: string; timezone?: string; active?: boolean }, actorUserId: number, scopeBranchId?: number) {
        if (scopeBranchId) throw new HrScheduleError('Se requiere alcance de empresa para administrar calendarios', 403);
        const existing = await prisma.holidayCalendar.findFirst({ where: { id, companyId } });
        if (!existing) throw new HrScheduleError('Calendario no encontrado', 404);
        const timezone = input.timezone?.trim() || existing.timezone;
        if (!isValidTimeZone(timezone)) throw new HrScheduleError('Zona horaria inválida');
        return prisma.$transaction(async (tx) => {
            const calendar = await tx.holidayCalendar.update({
                where: { id }, data: {
                    ...(input.name !== undefined ? { name: requiredText(input.name, 'name', 100) } : {}),
                    timezone, ...(input.active !== undefined ? { active: input.active } : {}),
                },
            });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'HolidayCalendar', entityId: id,
                action: 'UPDATE', details: { fields: Object.keys(input) },
            }, tx);
            return calendar;
        });
    }

    static async createHoliday(calendarId: number, companyId: number, input: {
        name?: string; date?: string; branchId?: number | null; paid?: boolean; payMultiplier?: number; notes?: string | null;
    }, actorUserId: number, scopeBranchId?: number) {
        const calendar = await prisma.holidayCalendar.findFirst({ where: { id: calendarId, companyId, active: true } });
        if (!calendar) throw new HrScheduleError('Calendario activo no encontrado', 404);
        let branchId = optionalId(input.branchId, 'branchId') || null;
        if (scopeBranchId) branchId = scopeBranchId;
        if (branchId && !await prisma.branch.findFirst({ where: { id: branchId, companyId }, select: { id: true } })) {
            throw new HrScheduleError('Sucursal no encontrada en la empresa', 404);
        }
        const date = parseDateKey(input.date, 'date');
        const multiplier = input.payMultiplier === undefined ? 1 : Number(input.payMultiplier);
        if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 99.99) throw new HrScheduleError('Multiplicador de pago inválido');
        return prisma.$transaction(async (tx) => {
            const holiday = await tx.holiday.create({
                data: {
                    companyId, calendarId, branchId, scopeKey: branchId ? `BRANCH:${branchId}` : 'ALL',
                    name: requiredText(input.name, 'name', 100), date: date.date,
                    paid: input.paid ?? true, payMultiplier: new Prisma.Decimal(multiplier),
                    notes: optionalText(input.notes, 'notes'),
                },
            });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'Holiday', entityId: holiday.id,
                action: 'CREATE', details: { date: date.key, branchId },
            }, tx);
            return holiday;
        });
    }

    static async updateHoliday(id: number, companyId: number, input: {
        name?: string; paid?: boolean; payMultiplier?: number; notes?: string | null; active?: boolean;
    }, actorUserId: number, scopeBranchId?: number) {
        const existing = await prisma.holiday.findFirst({ where: { id, companyId, ...(scopeBranchId ? { branchId: scopeBranchId } : {}) } });
        if (!existing) throw new HrScheduleError('Feriado no encontrado', 404);
        const multiplier = input.payMultiplier === undefined ? Number(existing.payMultiplier) : Number(input.payMultiplier);
        if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 99.99) throw new HrScheduleError('Multiplicador de pago inválido');
        return prisma.$transaction(async (tx) => {
            const holiday = await tx.holiday.update({
                where: { id }, data: {
                    ...(input.name !== undefined ? { name: requiredText(input.name, 'name', 100) } : {}),
                    ...(input.paid !== undefined ? { paid: input.paid } : {}),
                    payMultiplier: new Prisma.Decimal(multiplier),
                    ...(input.notes !== undefined ? { notes: optionalText(input.notes, 'notes') } : {}),
                    ...(input.active !== undefined ? { active: input.active } : {}),
                },
            });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'Holiday', entityId: id,
                action: 'UPDATE', details: { fields: Object.keys(input) },
            }, tx);
            return holiday;
        });
    }
}
