import type { AxiosInstance, ResponseType } from 'axios';
import { describeApiError } from '@web/utils/apiError';
import { isAmbiguousMutationFailure, newIdempotencyKey, type IdempotentAttempt } from '@web/utils/idempotency';
import type {
    HrAttendanceAction,
    HrAttendanceChallenge,
    HrAttendancePolicy,
    HrAttendancePunchResult,
    HrBiometricProfile,
    HrTodayAttendance,
} from '@web/types/hr-attendance';
import type { HrWeeklySchedule } from '@web/types/hr-schedule';
import type { HrLoan, HrLoanRequestPayload } from '@web/types/hr-benefits';
import type { HrPayrollReceiptDetail, HrPayrollReceiptSummary } from '@web/types/hr-payroll';
import type {
    HrAttendanceCorrection,
    HrAttendanceCorrectionPayload,
    HrLeaveRequest,
    HrLeaveRequestPayload,
    HrLeaveType,
    HrMyWorkforce,
    HrOvertimeRequest,
    HrOvertimeRequestPayload,
} from '@web/types/hr-workforce';
import { appEvents } from '../../core/events';

/** Punch and enrollment upload up to 6 JPEGs: the 15 s default is too short on mobile data. */
export const UPLOAD_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS_KEPT = 50;

/** `actionId` identifies one user action (one form submit): only a retry of that same action reuses its key. */
export interface ActionOpts {
    actionId?: string;
}

export class HrError extends Error {
    code?: string;
    status?: number;
    /** The request may have been applied (network, timeout, 5xx, 409, 429): retry with the same action. */
    isAmbiguous: boolean;
    constructor(message: string, init: { code?: string; status?: number; isAmbiguous: boolean }) {
        super(message);
        this.name = 'HrError';
        this.code = init.code;
        this.status = init.status;
        this.isAmbiguous = init.isAmbiguous;
    }
}

export function toHrError(error: unknown): HrError {
    if (error instanceof HrError) return error;
    const d = describeApiError(error);
    return new HrError(d.message, { code: d.code, status: d.status, isAmbiguous: isAmbiguousMutationFailure(error) });
}

export interface HrLoanPolicy {
    currency: string;
    maxAmount: string | number | null;
    maxInstallments: number | null;
    maxPaymentPercent: string | number | null;
    minTenureMonths: number | null;
    eligible: boolean;
    ineligibleReason: string | null;
    tenureMonths: number | null;
}

export interface HrSwap {
    id: number;
    status: 'PENDING' | 'ACCEPTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    requestedById: number;
    targetUserId: number;
    requesterShiftId: number;
    offeredShiftId?: number | null;
    reason?: string | null;
    createdAt: string;
    requestedBy?: { id: number; name: string } | null;
    targetUser?: { id: number; name: string } | null;
    requesterShift?: { id: number; date?: string; startTime?: string; endTime?: string } | null;
}

export interface HrEmployeeSummary {
    code: string;
    fullName: string;
    position: string | null;
    branchName: string | null;
    hireDate: string | null;
    workEmail: string | null;
    workPhone: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
}

export interface HrReceiptParams {
    year?: number;
    periodId?: number;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
}

export interface HrSwapBody {
    requesterShiftId: number;
    targetUserId: number;
    offeredShiftId?: number;
    reason?: string;
}

const H = '/v1/hr';
const B = '/v1/hr/benefits';

interface CallOpts {
    method?: 'GET' | 'POST' | 'PUT';
    params?: unknown;
    data?: unknown;
    /** Mutations the server dedupes by Idempotency-Key. */
    idempotent?: boolean;
    action?: ActionOpts;
    timeout?: number;
    responseType?: ResponseType;
}

export function createHrApi(http: AxiosInstance) {
    // Remembered keys of ambiguous failures, by action fingerprint. Per user: dropped on user change.
    const attempts = new Map<string, IdempotentAttempt>();
    const off = appEvents.on('account-user-changed', () => attempts.clear());

    async function call<T>(url: string, o: CallOpts = {}): Promise<T> {
        const method = o.method ?? 'GET';
        const useKey = !!o.idempotent;
        const fingerprint = useKey && o.action?.actionId ? `${method} ${url} ${o.action.actionId} ${bodyFingerprint(o.data)}` : null;
        const attempt: IdempotentAttempt = (fingerprint && attempts.get(fingerprint)) || { fingerprint: fingerprint ?? '', key: newIdempotencyKey() };
        if (fingerprint) {
            attempts.set(fingerprint, attempt);
            if (attempts.size > MAX_ATTEMPTS_KEPT) attempts.delete(attempts.keys().next().value as string);
        }
        try {
            const res = await http.request({
                method,
                url,
                params: o.params,
                data: o.data,
                ...(useKey ? { headers: { 'Idempotency-Key': attempt.key } } : {}),
                ...(o.timeout ? { timeout: o.timeout } : {}),
                ...(o.responseType ? { responseType: o.responseType } : {}),
            });
            if (fingerprint) attempts.delete(fingerprint);
            if (o.responseType === 'blob') return res.data as T;
            return (res.data?.data ?? res.data) as T;
        } catch (error) {
            if (fingerprint && !isAmbiguousMutationFailure(error)) attempts.delete(fingerprint);
            throw toHrError(error);
        }
    }

    const post = <T>(url: string, data: unknown, action?: ActionOpts, extra: Partial<CallOpts> = {}) =>
        call<T>(url, { method: 'POST', data, idempotent: true, action, ...extra });
    const list = async <T>(url: string, params?: unknown): Promise<T[]> => {
        const out = await call<unknown>(url, { params });
        return Array.isArray(out) ? (out as T[]) : [];
    };

    return {
        dispose: off,

        // ---- attendance ----
        attendanceToday: () => call<HrTodayAttendance>(`${H}/me/attendance/today`),
        attendancePolicy: () => call<HrAttendancePolicy>(`${H}/attendance/policy`),
        biometricStatus: () => call<HrBiometricProfile>(`${H}/biometrics/me`),
        createChallenge: (purpose: 'ATTENDANCE_PUNCH' | 'BIOMETRIC_ENROLLMENT', action?: HrAttendanceAction) =>
            call<HrAttendanceChallenge>(`${H}/biometrics/challenges`, { method: 'POST', data: { purpose, ...(action ? { action } : {}) } }),
        punch: (form: FormData, opts: ActionOpts = {}) =>
            post<HrAttendancePunchResult>(`${H}/attendance/punches`, form, opts, { timeout: UPLOAD_TIMEOUT_MS }),
        enroll: (form: FormData, opts: ActionOpts = {}) =>
            post<HrBiometricProfile>(`${H}/biometrics/enroll`, form, opts, { timeout: UPLOAD_TIMEOUT_MS }),

        // ---- schedule ----
        mySchedule: (weekStart: string) => call<HrWeeklySchedule | null>(`${H}/me/schedule`, { params: { weekStart } }),
        acknowledgeSchedule: (id: number) => call<unknown>(`${H}/schedules/${id}/acknowledge`, { method: 'POST' }),
        teamSchedule: (weekStart: string) => call<unknown>(`${H}/team/schedule`, { params: { weekStart } }),

        // ---- payroll ----
        myReceipts: (params: HrReceiptParams = {}) => list<HrPayrollReceiptSummary>(`${H}/payroll/me/receipts`, params),
        myReceipt: (id: number) => call<HrPayrollReceiptDetail>(`${H}/payroll/me/receipts/${id}`),
        receiptPdf: (id: number) => call<Blob>(`${H}/payroll/me/receipts/${id}/pdf`, { responseType: 'blob' }),

        // ---- workforce ----
        myWorkforce: (range: { dateFrom?: string; dateTo?: string; limit?: number } = {}) => call<HrMyWorkforce>(`${H}/me/workforce`, { params: range }),
        leaveTypes: () => list<HrLeaveType>(`${H}/leave/types`),
        /** Creates a DRAFT then submits it; both steps are idempotent under the same actionId. */
        async createLeave(body: HrLeaveRequestPayload, opts: ActionOpts = {}): Promise<HrLeaveRequest> {
            const draft = await post<HrLeaveRequest>(`${H}/leave/requests`, body, opts);
            return post<HrLeaveRequest>(`${H}/leave/requests/${draft.id}/submit`, {}, opts);
        },
        cancelLeave: (id: number, reason: string, opts: ActionOpts = {}) => post<HrLeaveRequest>(`${H}/leave/requests/${id}/cancel`, { reason }, opts),
        createOvertime: (body: HrOvertimeRequestPayload, opts: ActionOpts = {}) => post<HrOvertimeRequest>(`${H}/overtime/requests`, body, opts),
        cancelOvertime: (id: number, reason: string, opts: ActionOpts = {}) => post<HrOvertimeRequest>(`${H}/overtime/requests/${id}/cancel`, { reason }, opts),
        createCorrection: (body: HrAttendanceCorrectionPayload, opts: ActionOpts = {}) => post<HrAttendanceCorrection>(`${H}/attendance/corrections`, body, opts),
        cancelCorrection: (id: number, reason: string, opts: ActionOpts = {}) => post<HrAttendanceCorrection>(`${H}/attendance/corrections/${id}/cancel`, { reason }, opts),

        // ---- swaps (the server takes no Idempotency-Key: never auto-retried) ----
        mySwaps: (status?: HrSwap['status']) => list<HrSwap>(`${H}/me/swaps`, status ? { status } : undefined),
        createSwap: (body: HrSwapBody) => call<HrSwap>(`${H}/swaps`, { method: 'POST', data: body }),
        respondSwap: (id: number, decision: 'ACCEPT' | 'REJECT') => call<HrSwap>(`${H}/swaps/${id}/respond`, { method: 'POST', data: { decision } }),
        cancelSwap: (id: number) => call<HrSwap>(`${H}/swaps/${id}/cancel`, { method: 'POST', data: {} }),

        // ---- loans ----
        loanPolicy: () => call<HrLoanPolicy>(`${B}/me/loan-policy`),
        myLoans: (params?: { status?: string; page?: number }) => list<HrLoan>(`${B}/me/loans`, params),
        myLoan: (id: number) => call<HrLoan>(`${B}/me/loans/${id}`),
        requestLoan: (body: HrLoanRequestPayload, opts: ActionOpts = {}) => post<HrLoan>(`${B}/me/loan-requests`, body, opts),
        cancelLoanRequest: (id: number, reason?: string, opts: ActionOpts = {}) =>
            post<HrLoan>(`${B}/me/loan-requests/${id}/cancel`, reason ? { reason } : {}, opts),

        // ---- me ----
        myEmployee: () => call<HrEmployeeSummary>(`${H}/me/employee`),
        profile: () => call<Record<string, unknown>>('/users/profile'),
        updateProfile: (body: Record<string, unknown>) => call<Record<string, unknown>>('/users/profile', { method: 'PUT', data: body }),
        setPin: (pin: string, currentPassword: string) => call<unknown>('/auth/me/pin', { method: 'PUT', data: { pin, currentPassword } }),
    };
}

export type HrApi = ReturnType<typeof createHrApi>;

function bodyFingerprint(data: unknown): string {
    if (typeof FormData !== 'undefined' && data instanceof FormData) return 'form';
    try {
        return JSON.stringify(data ?? null);
    } catch {
        return '?';
    }
}
