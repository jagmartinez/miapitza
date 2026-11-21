import { useCallback, useEffect, useRef, useState } from 'react';
import { addDaysDateOnly, weekStartFor } from '@web/components/hr/scheduleDates';
import { selectVacationBalance } from '@web/components/hr/vacationBalance';
import { formatLocalDateInput } from '@web/utils/dateInput';
import type { HrTodayAttendance } from '@web/types/hr-attendance';
import type { HrVacationBalance } from '@web/types/hr-workforce';
import type { HrApi, HrLoanPolicy, HrSwap } from './hrApi';

export type RequestKind = 'leave' | 'overtime' | 'correction' | 'swap' | 'loan';

export interface PendingItem {
    id: string;
    kind: 'schedule' | 'receipt' | 'swap';
    title: string;
    detail: string;
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

export type SummaryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AccountSummary {
    today: HrTodayAttendance | null;
    pendingForYou: PendingItem[];
    myRequests: RequestCardModel[];
    vacation: HrVacationBalance | null;
    loanPolicy: HrLoanPolicy | null;
    status: SummaryStatus;
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

export function seenReceipts(userId: number): Set<number> {
    return new Set(readSeen()[String(userId)] ?? []);
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

const money = (currency: unknown, v: unknown) => `${String(currency ?? '')} ${String(v ?? '')}`.trim();
const range = (a: unknown, b: unknown) => (a === b || !b ? String(a ?? '') : `${String(a)} al ${String(b)}`);

export function buildSummary(input: {
    userId: number;
    schedules: Array<{ id: number; weekStart: string; acknowledgedAt?: string | null } | null>;
    receipts: Array<{ id: number; periodLabel?: string }>;
    swaps: HrSwap[];
    workforce: {
        leaveRequests?: AnyRow[];
        overtimeRequests?: AnyRow[];
        corrections?: AnyRow[];
    } | null;
    loans: AnyRow[];
}): { pending: PendingItem[]; requests: RequestCardModel[] } {
    const pending: PendingItem[] = [];
    for (const s of input.schedules) {
        if (s && !s.acknowledgedAt) {
            pending.push({ id: `schedule-${s.id}`, kind: 'schedule', title: 'Confirma tu horario', detail: `Semana del ${s.weekStart}`, refId: s.id });
        }
    }
    const seen = seenReceipts(input.userId);
    for (const r of input.receipts) {
        if (!seen.has(r.id)) pending.push({ id: `receipt-${r.id}`, kind: 'receipt', title: 'Recibo nuevo', detail: r.periodLabel ?? '', refId: r.id });
    }
    for (const w of input.swaps) {
        if (w.status === 'PENDING' && w.targetUserId === input.userId) {
            pending.push({ id: `swap-${w.id}`, kind: 'swap', title: 'Responde cambio de turno', detail: w.requestedBy?.name ? `De ${w.requestedBy.name}` : '', refId: w.id });
        }
    }

    const requests: RequestCardModel[] = [];
    for (const r of input.workforce?.leaveRequests ?? []) {
        const name = (r.leaveType as { name?: string } | undefined)?.name ?? 'Permiso';
        requests.push(card('leave', r, name, range(r.startDate, r.endDate), r.status === 'PENDING'));
    }
    for (const r of input.workforce?.overtimeRequests ?? []) {
        requests.push(card('overtime', r, 'Horas extra', `${String(r.date)} · ${Number(r.requestedMinutes) / 60} h`, r.status === 'PENDING'));
    }
    for (const r of input.workforce?.corrections ?? []) {
        requests.push(card('correction', r, 'Corrección de marcaje', CORRECTION_LABELS[String(r.type)] ?? '', r.status === 'PENDING'));
    }
    for (const w of input.swaps) {
        if (w.requestedById !== input.userId) continue;
        requests.push(card('swap', w as unknown as AnyRow, 'Cambio de turno', w.targetUser?.name ? `Con ${w.targetUser.name}` : '', w.status === 'PENDING' || w.status === 'ACCEPTED'));
    }
    for (const l of input.loans) {
        requests.push(card('loan', l, 'Préstamo', money(l.currency, l.requestedAmount), l.status === 'REQUESTED'));
    }
    requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { pending, requests: requests.slice(0, MAX_REQUESTS) };
}

const ok = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

/** One round of reads that feeds the account home. Partial failures degrade; only a total failure is an error. */
export function useAccountSummary(hr: HrApi, opts: { userId: number; enabled?: boolean }): AccountSummary {
    const { userId, enabled = true } = opts;
    const [state, setState] = useState<Omit<AccountSummary, 'reload'>>({
        today: null,
        pendingForYou: [],
        myRequests: [],
        vacation: null,
        loanPolicy: null,
        status: enabled ? 'loading' : 'idle',
    });
    const [tick, setTick] = useState(0);
    const reload = useCallback(() => setTick((t) => t + 1), []);
    const alive = useRef(0);

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
            hr.myWorkforce({ dateFrom: from, dateTo: to }),
            hr.myLoans(),
            hr.loanPolicy(),
        ]).then((r) => {
            if (run !== alive.current) return;
            if (r.every((x) => x.status === 'rejected')) {
                setState((s) => ({ ...s, status: 'error' }));
                return;
            }
            const workforce = ok(r[5]);
            const { pending, requests } = buildSummary({
                userId,
                schedules: [ok(r[1]), ok(r[2])],
                receipts: ok(r[3]) ?? [],
                swaps: ok(r[4]) ?? [],
                workforce: workforce as unknown as Parameters<typeof buildSummary>[0]["workforce"],
                loans: (ok(r[6]) ?? []) as unknown as AnyRow[],
            });
            setState({
                today: ok(r[0]),
                pendingForYou: pending,
                myRequests: requests,
                vacation: selectVacationBalance(workforce?.vacationBalances),
                loanPolicy: ok(r[7]),
                status: 'ready',
            });
        });
        return () => {
            alive.current++;
        };
    }, [hr, userId, enabled, tick]);

    return { ...state, reload };
}
