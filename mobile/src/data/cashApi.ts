import type { AxiosInstance } from 'axios';
import { getIdempotentAttempt, isAmbiguousMutationFailure, type IdempotentAttempt } from '@web/utils/idempotency';
import { appEvents } from '../core/events';
import type { SessionStore } from '../core/session';
import {
    CASH_ERROR_CODES,
    CashError,
    type ActiveShiftStatus,
    type CashRegisterRow,
    type CashSettings,
    type CashShiftInfo,
    type CloseResult,
    type ClosePayload,
    type ClosePreview,
    type CountBody,
    type CountResult,
    type CashErrorCode,
    type HistoryQuery,
    type MovementInput,
    type ShiftReport,
    type ShiftSummary,
    type SuggestedFloat,
} from './cashTypes';
import { ownerKeyOf, SessionChangedError } from './types';

export { CashError, SessionChangedError };

export interface CashApiDeps {
    http: AxiosInstance;
    sessions: SessionStore;
    isOnline: () => boolean;
}

const OFFLINE_MESSAGE = 'Requiere conexión';
const MAX_ATTEMPTS_KEPT = 50;

/** A server error with a cash `code` becomes a CashError; anything else is returned untouched. */
export function toCashError(error: unknown): unknown {
    const res = (error as { response?: { status?: number; data?: Record<string, unknown> } } | null)?.response;
    const code = res?.data?.code;
    if (typeof code !== 'string' || !CASH_ERROR_CODES.has(code)) return error;
    const data = res!.data!;
    const occupiedBy = data.occupiedBy as { id: number; name: string } | undefined;
    return new CashError(code as CashErrorCode, typeof data.message === 'string' ? data.message : code, {
        status: res!.status,
        ...(occupiedBy ? { occupiedBy } : {}),
        ...(typeof data.closedByMe === 'boolean' ? { closedByMe: data.closedByMe } : {}),
    });
}

/**
 * Caja calls. Online only: never queued, and offline they reject with a "Requiere conexión" CashError. Every call is
 * fenced to the session it started under: if the lock or a PIN switch changed the user meanwhile, the answer is refused
 * with SessionChangedError instead of reaching the next user.
 */
export function createCashApi(deps: CashApiDeps) {
    const { http, sessions, isOnline } = deps;

    // Keys of ambiguous failures by action fingerprint: a retry of the same action reuses its key (the Phase 2 rule).
    const attempts = new Map<string, IdempotentAttempt>();

    function requireOnline() {
        if (!isOnline()) throw new CashError('CASH_OFFLINE', OFFLINE_MESSAGE);
    }

    async function expireIfCurrent(token: string): Promise<void> {
        const cur = await sessions.load();
        if (!cur || cur.token !== token) return;
        try {
            await sessions.clear();
        } finally {
            appEvents.emit('session-expired');
        }
    }

    /** The user who started the call must still be the active one when it settles. */
    async function assertOwner(owner: string | null): Promise<void> {
        if (ownerKeyOf(await sessions.load()) !== owner) throw new SessionChangedError();
    }

    async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
        requireOnline();
        const owner = ownerKeyOf(await sessions.load());
        let res;
        try {
            res = await http.get(url, { params });
        } catch (error) {
            throw toCashError(error);
        }
        await assertOwner(owner);
        return (res.data?.data ?? res.data) as T;
    }

    async function mutate<T>(method: 'POST', url: string, data: unknown): Promise<T> {
        requireOnline();
        const session = await sessions.load();
        const owner = ownerKeyOf(session);
        const fingerprint = `${owner ?? '-'} ${method} ${url} ${JSON.stringify(data ?? null)}`;
        const attempt = getIdempotentAttempt(attempts.get(fingerprint) ?? null, fingerprint);
        attempts.set(fingerprint, attempt);
        if (attempts.size > MAX_ATTEMPTS_KEPT) attempts.delete(attempts.keys().next().value as string);
        try {
            const res = await http.request({
                method,
                url,
                data,
                // The token the call started with: a switch while it is in flight cannot re-bind it.
                headers: { ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}), 'X-Idempotency-Key': attempt.key },
            });
            attempts.delete(fingerprint);
            await assertOwner(owner);
            return (res.data?.data ?? res.data) as T;
        } catch (error) {
            if (error instanceof SessionChangedError) throw error;
            if (session?.token && (error as { response?: { status?: number } } | null)?.response?.status === 401) await expireIfCurrent(session.token);
            const typed = toCashError(error);
            // A typed business error is a definitive answer; only network/5xx/timeout may have been applied.
            if (typed instanceof CashError || !isAmbiguousMutationFailure(error)) attempts.delete(fingerprint);
            throw typed;
        }
    }

    return {
        // ---- reads (never cached: the drawer must be live) ----
        registers: () => get<CashRegisterRow[]>('/cash-registers'),
        activeStatus: () => get<ActiveShiftStatus>('/cash-shifts/active-status'),
        suggestedFloat: (registerId: number) => get<SuggestedFloat>('/cash-shifts/suggested-float', { cashRegisterId: registerId }),
        summary: (shiftId: number) => get<ShiftSummary>(`/cash-shifts/${shiftId}/summary`),
        report: (shiftId: number) => get<ShiftReport>(`/cash-arqueo/${shiftId}/report`),
        history: (q: HistoryQuery = {}) =>
            get<CashShiftInfo[]>('/cash-shifts', {
                ...(q.registerId != null ? { cashRegisterId: q.registerId } : {}),
                ...(q.from ? { startDate: q.from } : {}),
                ...(q.to ? { endDate: q.to.length === 10 ? `${q.to}T23:59:59.999Z` : q.to } : {}),
            }),
        /** Exchange rate and tolerance (never GET /settings: unseeded keys are missing there). */
        settings: () => get<CashSettings>('/cash-shifts/cash-settings'),

        // ---- mutations (online only, each with an idempotency key) ----
        openShift: (body: { cashRegisterId: number; startAmount: number }) => mutate<CashShiftInfo>('POST', '/cash-shifts/open', body),
        addMovement(shiftId: number, input: MovementInput) {
            const { reason, description, ...rest } = input;
            // The validator rejects unknown keys: the reason travels inside the description.
            const why = reason?.trim();
            return mutate<Record<string, unknown>>('POST', `/cash-shifts/${shiftId}/movements`, { ...rest, description: why ? `${why}: ${description.trim()}` : description.trim() });
        },
        count: (shiftId: number, breakdown: CountBody) => mutate<CountResult>('POST', `/cash-arqueo/${shiftId}/count`, breakdown),
        previewClose: (shiftId: number, payload: ClosePayload) => mutate<ClosePreview>('POST', `/cash-arqueo/${shiftId}/preview-close`, payload),
        /** A retry whose first answer was lost finds the shift already closed by this user: that is a success (`alreadyClosed`). */
        async close(shiftId: number, payload: ClosePayload): Promise<CloseResult> {
            try {
                const shift = await mutate<CashShiftInfo>('POST', `/cash-arqueo/${shiftId}/close`, payload);
                return { alreadyClosed: false, shift };
            } catch (error) {
                if (error instanceof CashError && error.code === 'CASH_SHIFT_ALREADY_CLOSED' && error.closedByMe === true) return { alreadyClosed: true };
                throw error;
            }
        },
    };
}

export type CashApi = ReturnType<typeof createCashApi>;
