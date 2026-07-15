import type { HrNamedEntity, HrUserSummary } from './hr';

export type HrScheduleStatus = 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'CANCELLED';
export type HrScheduleConflictSeverity = 'ERROR' | 'WARNING';

export interface HrScheduleConflict {
    code: string;
    message: string;
    severity?: HrScheduleConflictSeverity;
    shiftId?: number | null;
    field?: string | null;
}

export interface HrScheduleShiftInput {
    userId: number;
    branchId: number;
    jobPositionId?: number | null;
    shiftTemplateId?: number | null;
    date: string;
    startTime: string;
    endTime: string;
    breakMinutes?: number;
    paidBreak?: boolean;
    notes?: string | null;
}

export interface HrScheduleShift extends HrScheduleShiftInput {
    id: number;
    scheduleId?: number;
    startAt?: string;
    endAt?: string;
    timezoneSnapshot?: string;
    crossesMidnight?: boolean;
    user?: HrUserSummary | null;
    branch?: HrNamedEntity | null;
    jobPosition?: HrNamedEntity | null;
}

export interface HrScheduleAcknowledgement {
    id?: number;
    scheduleId?: number;
    userId: number;
    acknowledgedAt: string;
}

export interface HrWeeklySchedule {
    id: number;
    companyId?: number;
    weekStart: string;
    status: HrScheduleStatus;
    version: number;
    revision: number;
    shifts: HrScheduleShift[];
    conflicts?: HrScheduleConflict[];
    publishedAt?: string | null;
    publishedById?: number | null;
    acknowledgedAt?: string | null;
    acknowledgements?: HrScheduleAcknowledgement[];
    createdAt?: string;
    updatedAt?: string;
}

export interface HrScheduleFilters {
    weekStart: string;
    branchId?: number;
    userId?: number;
    jobPositionId?: number;
}

export interface HrScheduleCollection {
    schedules: HrWeeklySchedule[];
    conflicts: HrScheduleConflict[];
    holidays: HrHoliday[];
    /** True when the shared HTTP client recovered this read from its offline cache. */
    fromCache?: boolean;
}

export interface HrScheduleCreatePayload {
    weekStart: string;
    notes?: string | null;
    shifts: HrScheduleShiftInput[];
}

export interface HrScheduleUpdatePayload {
    expectedRevision: number;
    notes?: string | null;
    shifts: HrScheduledShiftApiInput[];
}

export interface HrScheduledShiftApiInput {
    userId: number;
    branchId: number;
    jobPositionId?: number | null;
    shiftTemplateId?: number | null;
    date: string;
    startTime: string;
    endTime: string;
    breakMinutes?: number;
    paidBreak?: boolean;
    notes?: string | null;
}

export interface HrScheduleCopyPayload {
    targetWeekStart: string;
}

export interface HrSchedulePublishPayload {
    expectedRevision: number;
}

export interface HrShiftTemplate {
    id: number;
    name: string;
    code?: string | null;
    branchId?: number | null;
    jobPositionId?: number | null;
    startTime: string;
    endTime: string;
    breakMinutes?: number;
    active?: boolean;
}

export interface HrHoliday {
    id: number;
    date: string;
    name: string;
    branchId?: number | null;
    active?: boolean;
}

export interface HrScheduleEnvelope<T> {
    success: boolean;
    data: T;
    message?: string;
}
