import { useCallback, useEffect, useRef, useState } from 'react';
import { addDaysDateOnly, weekStartFor } from '@web/components/hr/scheduleDates';
import { selectVacationBalance } from '@web/components/hr/vacationBalance';
import { formatLocalDateInput } from '@web/utils/dateInput';
import { formatHrMoney } from '@web/utils/hrFormat';
import type { HrBiometricProfile, HrTodayAttendance } from '@web/types/hr-attendance';
import type { HrVacationBalance } from '@web/types/hr-workforce';
import { appEvents } from '../../core/events';
import type { HrApi, HrLoanPolicy, HrSwap } from './hrApi';
import { dateOnly, shiftText } from './format';
import { useSessionRestored } from './useSessionRestored';

export type RequestKind = 'leave' | 'overtime' | 'correction' | 'swap' | 'loan';

export interface PendingItem {
    id: string;
    kind: 'schedule' | 'receipt' | 'swap';
    title: string;
    detail: string;
    /** Extra lines for the full card (swap shift, offered shift, reason). */
    lines?: string[];
    refId: number;
}

export interface RequestCardModel {
    id: string;
    kind: RequestKind;
    refId: number;
    title: string;
    detail: string;
    status: string;
    statusLabel: string;
    /** Amber while it waits, soft red when rejected; anything else is neutral. */
    tone: 'pending' | 'rejected' | 'neutral';
    cancellable: boolean;
    createdAt: string;
}

export type SummaryPart = 'today' | 'schedule' | 'receipts' | 'swaps' | 'workforce' | 'loans' | 'loanPolicy';

export const PART_LABELS: Record<SummaryPart, string> = {
    today: 'tu marcaje',
    schedule: 'tu horario',
    receipts: 'tus recibos',
    swaps: 'tus cambios de turno',
    workforce: 'tus permisos y horas extra',
    loans: 'tus préstamos',
    loanPolicy: 'el límite de préstamo',
};

export type SummaryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AccountSummary {
    today: HrTodayAttendance | null;
    /** Own face-enrollment status; null when unknown (a failed read never blocks the home). */
    biometric: HrBiometricProfile | null;
    pendingForYou: PendingItem[];
    myRequests: RequestCardModel[];
    vacation: HrVacationBalance | null;
    loanPolicy: HrLoanPolicy | null;
    status: SummaryStatus;
    /** Parts that failed to load (Spanish noun phrases): the rest of the home still shows. */
    failed: SummaryPart[];
    reload: () => void;
}

const SEEN_KEY = 'acct.seenReceipts';
const MAX_REQUESTS = 8;

function readSeen(): Record<string, number[]> {
    try {
        const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/** Receipts the employee already opened, per user (the server has no read flag). */
export function markReceiptsSeen(userId: number, ids: number[]): void {
    try {
        const all = readSeen();
        const merged = new Set([...(all[String(userId)] ?? []), ...ids]);
        all[String(userId)] = [...merged].slice(-200);
        localStorage.setItem(SEEN_KEY, JSON.stringify(all));
    } catch {
        // storage unavailable: receipts simply stay "new"
    }
}

export function seenReceipts(userId: number): Set<number> | null {
    const ids = readSeen()[String(userId)];
    return ids ? new Set(ids) : null;
}

const STATUS_LABELS: Record<string, string> = {
    DRAFT: 'Borrador',
    PENDING: 'Pendiente',
    ACCEPTED: 'Aceptado, por aprobar',
    APPROVED: 'Aprobada',
    REJECTED: 'Rechazada',
    CANCELLED: 'Cancelada',
    APPLIED: 'Aplicada',
    REQUESTED: 'Pendiente',
    DISBURSED: 'Desembolsado',
    ACTIVE: 'Activo',
    PAID: 'Pagado',
    CLOSED: 'Cerrado',
    REVERSED: 'Revertido',
};

const REQUEST_LOAN_STATUSES = new Set(['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED']);
const PENDING = new Set(['PENDING', 'ACCEPTED', 'REQUESTED']);
const toneOf = (s: string): RequestCardModel['tone'] => (PENDING.has(s) ? 'pending' : s === 'REJECTED' ? 'rejected' : 'neutral');

const CORRECTION_LABELS: Record<string, string> = {
    ADD_PUNCH: 'Agregar marcaje',
    VOID_PUNCH: 'Anular marcaje',
    CHANGE_TIME: 'Cambiar hora',
    ASSIGN_BRANCH: 'Asignar sucursal',
    OTHER: 'Otra corrección',
};

interface AnyRow {
    id: number;
    status: string;
    createdAt?: string;
    requestedAt?: string;
    [k: string]: unknown;
}

function card(kind: RequestKind, row: AnyRow, title: string, detail: string, cancellable: boolean): RequestCardModel {
    return {
        id: `${kind}-${row.id}`,
        kind,
        refId: row.id,
        title,
        detail,
        status: row.status,
        statusLabel: STATUS_LABELS[row.status] ?? row.status,
        tone: toneOf(row.status),
        cancellable,
        createdAt: String(row.createdAt ?? row.requestedAt ?? ''),
    };
}

const money = (currency: unknown, v: unknown) => formatHrMoney(String(currency ?? ''), v as string | number | null | undefined);
const day = (v: unknown) => dateOnly(String(v ?? '')) || String(v ?? '');
const range = (a: unknown, b: unknown) => (day(a) === day(b) || !b ? day(a) : `${day(a)} al ${day(b)}`);
/** 100 min -> "1 h 40 min"; 120 -> "2 h"; 45 -> "45 min". */
export function minutesText(total: number): string {
    if (!Number.isFinite(total) || total <= 0) return '0 min';
    const h = Math.floor(total / 60);
    const m = Math.round(total % 60);
    return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

export function buildSummary(input: {
    userId: number;
    schedules: Array<{ id: number; weekStart: string; acknowledgedAt?: string | null; shifts?: unknown[] } | null>;
    receipts: Array<{ id: number; periodLabel?: string }> | null;
    swaps: HrSwap[];
    workforce: {
        leaveRequests?: AnyRow[];
        overtimeRequests?: AnyRow[];
        corrections?: AnyRow[];
    } | null;
    loans: AnyRow[];
    /** Cap of the request cards (the home shows a few; Mis solicitudes asks for more). */
    limit?: number;
}): { pending: PendingItem[]; requests: RequestCardModel[] } {
    const pending: PendingItem[] = [];
    for (const s of input.schedules) {
        // The server returns the company's published week even with no shifts for this user, and then refuses the acknowledgement (404).
        if (s && !s.acknowledgedAt && (s.shifts?.length ?? 0) > 0) {
            pending.push({ id: `schedule-${s.id}`, kind: 'schedule', title: 'Confirma tu horario', detail: `Semana del ${dateOnly(s.weekStart) || s.weekStart}`, refId: s.id });
        }
    }
    const seen = seenReceipts(input.userId);
    // First load for this user: whatever exists now is not "new"; only later receipts are.
    if (!seen && input.receipts !== null) markReceiptsSeen(input.userId, input.receipts.map((r) => r.id));
    for (const r of input.receipts ?? []) {
        if (seen && !seen.has(r.id)) pending.push({ id: `receipt-${r.id}`, kind: 'receipt', title: 'Recibo nuevo', detail: r.periodLabel ?? '', refId: r.id });
    }
    for (const w of input.swaps) {
        if (w.status === 'PENDING' && w.targetUserId === input.userId) {
            const name = w.requestedBy?.name;
            const theirs = shiftText(w.requesterShift);
            const offered = shiftText(w.offeredShift);
            pending.push({
                id: `swap-${w.id}`,
                kind: 'swap',
                title: 'Responde cambio de turno',
                detail: [name ? `De ${name}` : '', theirs].filter(Boolean).join(' · '),
                lines: [theirs && `Turno que te piden: ${theirs}`, offered && `A cambio de: ${offered}`, w.reason ? `Motivo: ${w.reason}` : ''].filter(Boolean) as string[],
                refId: w.id,
            });
        }
    }

    const requests: RequestCardModel[] = [];
    for (const r of input.workforce?.leaveRequests ?? []) {
        const name = (r.leaveType as { name?: string } | undefined)?.name ?? 'Permiso';
        // A DRAFT left behind by an interrupted submit can be discarded: the server cancels it too.
        requests.push(card('leave', r, name, range(r.startDate, r.endDate), r.status === 'PENDING' || r.status === 'DRAFT'));
    }
    for (const r of input.workforce?.overtimeRequests ?? []) {
        requests.push(card('overtime', r, 'Horas extra', `${day(r.date)} · ${minutesText(Number(r.requestedMinutes))}`, r.status === 'PENDING'));
    }
    for (const r of input.workforce?.corrections ?? []) {
        requests.push(card('correction', r, 'Corrección de marcaje', CORRECTION_LABELS[String(r.type)] ?? '', r.status === 'PENDING'));
    }
    for (const w of input.swaps) {
        if (w.requestedById !== input.userId) continue;
        requests.push(card('swap', w as unknown as AnyRow, 'Cambio de turno', [w.targetUser?.name ? `Con ${w.targetUser.name}` : '', shiftText(w.requesterShift)].filter(Boolean).join(' · '), w.status === 'PENDING' || w.status === 'ACCEPTED'));
    }
    // Only loan requests; active/paid loans belong to the Préstamos screen.
    for (const l of input.loans.filter((x) => REQUEST_LOAN_STATUSES.has(x.status))) {
        requests.push(card('loan', l, 'Préstamo', money(l.currency, l.requestedAmount), l.status === 'REQUESTED'));
    }
    requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { pending, requests: requests.slice(0, input.limit ?? MAX_REQUESTS) };
}

const ok = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

/** One round of reads that feeds the account home. Partial failures degrade; only a total failure is an error. */
export function useAccountSummary(hr: HrApi, opts: { userId: number; enabled?: boolean; maxRequests?: number }): AccountSummary {
    const { userId, enabled = true, maxRequests } = opts;
    const [state, setState] = useState<Omit<AccountSummary, 'reload'>>({
        today: null,
        biometric: null,
        pendingForYou: [],
        myRequests: [],
        vacation: null,
        loanPolicy: null,
        failed: [] as SummaryPart[],
        status: (enabled ? 'loading' : 'idle') as SummaryStatus,
    });
    const [tick, setTick] = useState(0);
    const reload = useCallback(() => setTick((t) => t + 1), []);
    const alive = useRef(0);
    useSessionRestored(reload);

    // A different user must never see the previous user's data, not even for a frame.
    useEffect(
        () =>
            appEvents.on('account-user-changed', () => {
                alive.current++;
                setState({ today: null, biometric: null, pendingForYou: [], myRequests: [], vacation: null, loanPolicy: null, failed: [], status: enabled ? 'loading' : 'idle' });
                setTick((t) => t + 1);
            }),
        [enabled],
    );

    useEffect(() => {
        if (!enabled) return;
        const run = ++alive.current;
        setState((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading' }));
        const thisWeek = weekStartFor();
        const nextWeek = addDaysDateOnly(thisWeek, 7);
        const today = new Date();
        const from = formatLocalDateInput(new Date(today.getTime() - 30 * 86_400_000));
        const to = formatLocalDateInput(new Date(today.getTime() + 120 * 86_400_000));
        void Promise.allSettled([
            hr.attendanceToday(),
            hr.mySchedule(thisWeek),
            hr.mySchedule(nextWeek),
            hr.myReceipts({ limit: 5 }),
            hr.mySwaps(),
            hr.myWorkforce({ dateFrom: from, dateTo: to, summaries: false }),
            hr.myLoans(),
            hr.loanPolicy(),
            Promise.resolve().then(() => hr.biometricStatus()),
        ]).then((r) => {
            if (run !== alive.current) return;
            const parts: SummaryPart[] = ['today', 'schedule', 'schedule', 'receipts', 'swaps', 'workforce', 'loans', 'loanPolicy'];
            const failed = [...new Set(parts.filter((_, i) => r[i].status === 'rejected'))];
            if (r.slice(0, 8).every((x) => x.status === 'rejected')) {
                setState((s) => ({ ...s, failed, status: 'error' }));
                return;
            }
            const workforce = ok(r[5]);
            const { pending, requests } = buildSummary({
                userId,
                schedules: [ok(r[1]), ok(r[2])],
                receipts: ok(r[3]),
                swaps: ok(r[4]) ?? [],
                workforce: workforce as unknown as Parameters<typeof buildSummary>[0]["workforce"],
                loans: (ok(r[6]) ?? []) as unknown as AnyRow[],
                limit: maxRequests,
            });
            setState({
                today: ok(r[0]),
                biometric: ok(r[8]),
                pendingForYou: pending,
                myRequests: requests,
                vacation: selectVacationBalance(workforce?.vacationBalances),
                loanPolicy: ok(r[7]),
                failed,
                status: 'ready',
            });
        });
        return () => {
            alive.current++;
        };
    }, [hr, userId, enabled, maxRequests, tick]);

    return { ...state, reload };
}
