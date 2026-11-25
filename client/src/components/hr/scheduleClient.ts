import api from '../../services/api';
import type {
    HrHoliday,
    HrScheduleCollection,
    HrScheduleConflict,
    HrScheduleCopyPayload,
    HrScheduleCreatePayload,
    HrScheduleEnvelope,
    HrScheduleFilters,
    HrSchedulePublishPayload,
    HrScheduleUpdatePayload,
    HrShiftTemplate,
    HrWeeklySchedule,
} from '../../types/hr-schedule';

const HR_BASE = '/v1/hr';

function unwrap<T>(payload: HrScheduleEnvelope<T> | T): T {
    if (payload && typeof payload === 'object' && 'data' in payload) {
        return (payload as HrScheduleEnvelope<T>).data;
    }
    return payload as T;
}

function asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? value as T[] : [];
}

function contractError(resource: string): Error {
    return new Error(`La API no devolvió ${resource} con el formato esperado`);
}

function responseFromCache(response: unknown): boolean {
    return Boolean(response && typeof response === 'object' && '_fromCache' in response && (response as { _fromCache?: unknown })._fromCache);
}

function requiredArray(value: unknown, resource: string): unknown[] {
    if (!Array.isArray(value)) throw contractError(resource);
    return value;
}

function localDateTime(value: string, timeZone: string): { date: string; time: string } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
    return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

function normalizeShift(value: unknown): HrWeeklySchedule['shifts'][number] {
    if (!value || typeof value !== 'object') throw contractError('un turno');
    const raw = value as Record<string, unknown>;
    if (!Number.isInteger(raw.id) || !Number.isInteger(raw.userId) || !Number.isInteger(raw.branchId)) {
        throw contractError('un turno');
    }
    const timeZone = typeof raw.timezoneSnapshot === 'string' ? raw.timezoneSnapshot : 'America/Managua';
    const startAt = typeof raw.startAt === 'string' ? raw.startAt : undefined;
    const endAt = typeof raw.endAt === 'string' ? raw.endAt : undefined;
    const start = startAt ? localDateTime(startAt, timeZone) : { date: String(raw.date ?? ''), time: String(raw.startTime ?? '').slice(0, 5) };
    const end = endAt ? localDateTime(endAt, timeZone) : { date: start.date, time: String(raw.endTime ?? '').slice(0, 5) };
    return {
        ...(raw as unknown as HrWeeklySchedule['shifts'][number]),
        date: start.date,
        startTime: start.time,
        endTime: end.time,
        startAt,
        endAt,
        timezoneSnapshot: timeZone,
        crossesMidnight: end.date > start.date,
    };
}

function normalizeScheduleRecord(value: unknown): HrWeeklySchedule {
    if (!value || typeof value !== 'object') throw contractError('un horario');
    const raw = value as Record<string, unknown>;
    const weekStart = typeof raw.weekStart === 'string' ? raw.weekStart.slice(0, 10) : '';
    const status = raw.status;
    const revision = Number(raw.revision);
    const version = Number(raw.version ?? 1);
    if (
        !Number.isInteger(raw.id) || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) ||
        !['DRAFT', 'PUBLISHED', 'SUPERSEDED', 'CANCELLED'].includes(String(status)) ||
        !Number.isInteger(revision) || revision < 0 || !Number.isInteger(version) || version < 1
    ) {
        throw contractError('un horario');
    }
    const shifts = requiredArray(raw.shifts, 'los turnos del horario').map(normalizeShift);
    return {
        ...(raw as unknown as HrWeeklySchedule),
        weekStart,
        status: status as HrWeeklySchedule['status'],
        version,
        revision,
        shifts,
        acknowledgedAt: typeof raw.acknowledgedAt === 'string' ? raw.acknowledgedAt : null,
    };
}

function normalizeCollection(value: unknown): HrScheduleCollection {
    if (Array.isArray(value)) return { schedules: value.map(normalizeScheduleRecord), conflicts: [], holidays: [] };
    if (!value || typeof value !== 'object') throw contractError('la colección de horarios');
    const raw = value as Record<string, unknown>;
    if ('id' in raw && 'weekStart' in raw) {
        return { schedules: [normalizeScheduleRecord(raw)], conflicts: [], holidays: [] };
    }
    const scheduleValue = raw.schedules ?? raw.items;
    if (!Array.isArray(scheduleValue)) throw contractError('la colección de horarios');
    if (raw.conflicts !== undefined && !Array.isArray(raw.conflicts)) throw contractError('los conflictos del horario');
    if (raw.holidays !== undefined && !Array.isArray(raw.holidays)) throw contractError('los feriados del horario');
    return {
        schedules: scheduleValue.map(normalizeScheduleRecord),
        conflicts: asArray<HrScheduleConflict>(raw.conflicts),
        holidays: asArray<HrHoliday>(raw.holidays).map((holiday) => ({ ...holiday, date: holiday.date.slice(0, 10) })),
    };
}

function normalizeSchedule(value: unknown): HrWeeklySchedule {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const schedule = (raw.schedule ?? raw) as HrWeeklySchedule;
    if (!schedule || typeof schedule.id !== 'number') throw new Error('La API no devolvió un horario válido');
    return normalizeScheduleRecord(schedule);
}

export function scheduleParams(filters: HrScheduleFilters): Record<string, string | number> {
    return {
        weekStart: filters.weekStart,
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        ...(filters.userId ? { userId: filters.userId } : {}),
        ...(filters.jobPositionId ? { jobPositionId: filters.jobPositionId } : {}),
    };
}

export const scheduleClient = {
    async getSchedules(filters: HrScheduleFilters): Promise<HrScheduleCollection> {
        const response = await api.get(`${HR_BASE}/schedules`, { params: scheduleParams(filters) });
        return { ...normalizeCollection(unwrap(response.data)), fromCache: responseFromCache(response) };
    },

    async createSchedule(payload: HrScheduleCreatePayload): Promise<HrWeeklySchedule> {
        const response = await api.post(`${HR_BASE}/schedules`, payload);
        return normalizeSchedule(unwrap(response.data));
    },

    async updateSchedule(id: number, payload: HrScheduleUpdatePayload): Promise<HrWeeklySchedule> {
        const response = await api.put(`${HR_BASE}/schedules/${id}`, payload);
        return normalizeSchedule(unwrap(response.data));
    },

    async copySchedule(id: number, payload: HrScheduleCopyPayload): Promise<HrWeeklySchedule> {
        const response = await api.post(`${HR_BASE}/schedules/${id}/copy`, payload);
        return normalizeSchedule(unwrap(response.data));
    },

    async publishSchedule(id: number, payload: HrSchedulePublishPayload): Promise<HrWeeklySchedule> {
        const response = await api.post(`${HR_BASE}/schedules/${id}/publish`, payload);
        return normalizeSchedule(unwrap(response.data));
    },

    async cancelSchedule(id: number, payload: HrSchedulePublishPayload): Promise<void> {
        await api.post(`${HR_BASE}/schedules/${id}/cancel`, payload);
    },

    async acknowledgeSchedule(id: number): Promise<void> {
        await api.post(`${HR_BASE}/schedules/${id}/acknowledge`);
    },

    async getMySchedule(weekStart: string): Promise<HrScheduleCollection> {
        const response = await api.get(`${HR_BASE}/me/schedule`, { params: { weekStart } });
        return { ...normalizeCollection(unwrap(response.data)), fromCache: responseFromCache(response) };
    },

    async getShiftTemplates(branchId?: number): Promise<HrShiftTemplate[]> {
        const response = await api.get(`${HR_BASE}/shift-templates`, { params: branchId ? { branchId } : undefined });
        const value = unwrap<unknown>(response.data);
        if (Array.isArray(value)) return value as HrShiftTemplate[];
        if (!value || typeof value !== 'object') throw contractError('las plantillas de turno');
        const raw = value as Record<string, unknown>;
        const templates = raw.shiftTemplates ?? raw.templates ?? raw.items;
        return requiredArray(templates, 'las plantillas de turno') as HrShiftTemplate[];
    },

    async getHolidays(weekStart: string, branchId?: number): Promise<HrHoliday[]> {
        const response = await api.get(`${HR_BASE}/holidays`, {
            params: { weekStart, ...(branchId ? { branchId } : {}) },
        });
        const value = unwrap<unknown>(response.data);
        if (Array.isArray(value)) return value as HrHoliday[];
        if (!value || typeof value !== 'object') throw contractError('los feriados');
        const raw = value as Record<string, unknown>;
        const holidays = requiredArray(raw.holidays ?? raw.items, 'los feriados') as HrHoliday[];
        return holidays.map((holiday) => ({ ...holiday, date: holiday.date.slice(0, 10) }));
    },
};

export function getScheduleErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && !('response' in error)) return error.message || fallback;
    if (!error || typeof error !== 'object' || !('response' in error)) return fallback;
    const data = (error as { response?: { data?: { message?: string; error?: string } } }).response?.data;
    return data?.message || data?.error || fallback;
}

export function getScheduleConflicts(error: unknown): HrScheduleConflict[] {
    if (!error || typeof error !== 'object' || !('response' in error)) return [];
    const data = (error as { response?: { data?: { conflicts?: unknown } } }).response?.data;
    return asArray<HrScheduleConflict>(data?.conflicts);
}
