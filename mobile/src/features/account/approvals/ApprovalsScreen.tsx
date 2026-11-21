import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Card } from '../../../ui/Card';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useToast } from '../../../ui/Toast';
import { useAccountNav } from '../AccountNav';
import { instantText, shiftText } from '../format';
import { useSessionRestored } from '../useSessionRestored';
import { toHrError, type HrApi, type HrSwap } from '../hrApi';
import { REASON_MAX, validReason } from '../requests/common';
import type { HrAttendanceCorrection, HrLeaveRequest, HrOvertimeRequest } from '@web/types/hr-workforce';
import '../profile/profile.css';
import '../requests/requests.css';
import './approvals.css';

type Kind = 'leave' | 'overtime' | 'correction' | 'swap';

const TABS: { kind: Kind; label: string }[] = [
    { kind: 'leave', label: 'Permisos' },
    { kind: 'overtime', label: 'Horas extra' },
    { kind: 'correction', label: 'Correcciones' },
    { kind: 'swap', label: 'Cambios de turno' },
];

const SELF_APPROVAL = 'No puedes aprobar tu propia solicitud';
const APPROVED_REASON = 'Aprobado';

interface Item {
    kind: Kind;
    id: number;
    who: string;
    lines: string[];
    reason?: string | null;
    requestedMinutes?: number;
}

type Loaded = Item[] | 'error' | null;

const who = (name: string | null | undefined, id: number | null | undefined) => (name?.trim() ? name : `Empleado #${id ?? '?'}`);
const day = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const range = (a?: string | null, b?: string | null) => (b && b !== a ? `${day(a)} al ${day(b)}` : day(a));

const FRACTION: Record<string, string> = { FULL_DAY: 'Día completo', HALF_DAY: 'Medio día', HOURS: 'Por horas' };
const CORRECTION_TYPE: Record<string, string> = {
    ADD_PUNCH: 'Agregar marcaje',
    VOID_PUNCH: 'Anular marcaje',
    CHANGE_TIME: 'Cambiar hora',
    ASSIGN_BRANCH: 'Asignar sucursal',
    OTHER: 'Otra corrección',
};
const ACTION: Record<string, string> = { CHECK_IN: 'entrada', BREAK_START: 'inicio de descanso', BREAK_END: 'fin de descanso', CHECK_OUT: 'salida' };

const fromLeave = (r: HrLeaveRequest): Item => ({
    kind: 'leave',
    id: r.id,
    who: who(r.user?.name, r.userId),
    lines: [r.leaveType?.name ?? 'Permiso', `${range(r.startDate, r.endDate)} · ${FRACTION[r.fraction] ?? r.fraction}${r.startTime && r.endTime ? ` ${r.startTime}-${r.endTime}` : ''}`],
    reason: r.reason,
});
const fromOvertime = (r: HrOvertimeRequest): Item => ({
    kind: 'overtime',
    id: r.id,
    who: who(r.user?.name, r.userId),
    lines: [`${day(r.date)} · ${r.requestedMinutes} min solicitados`],
    reason: r.reason,
    requestedMinutes: r.requestedMinutes,
});
const fromCorrection = (r: HrAttendanceCorrection): Item => ({
    kind: 'correction',
    id: r.id,
    who: who(r.user?.name, r.userId),
    lines: [
        CORRECTION_TYPE[r.type] ?? r.type,
        [r.requestedAction ? ACTION[r.requestedAction] : '', instantText(r.requestedOccurredAt, (r as { requestedTimezone?: string | null }).requestedTimezone)]
            .filter(Boolean)
            .join(' · '),
    ].filter(Boolean),
    reason: r.reason,
});
const fromSwap = (r: HrSwap): Item => ({
    kind: 'swap',
    id: r.id,
    who: who(r.requestedBy?.name, r.requestedById),
    lines: [
        `con ${who(r.targetUser?.name, r.targetUserId)}`,
        shiftText(r.requesterShift),
    ].filter(Boolean),
    reason: r.reason,
});

function RejectSheet({ item, onConfirm, onClose }: { item: Item; onConfirm: (reason: string) => Promise<string | null>; onClose: () => void }) {
    const needsReason = item.kind !== 'swap';
    const [reason, setReason] = useState('');
    const ok = !needsReason || validReason(reason);
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    return (
        <div className="pf-sheet-backdrop">
            <form
                className="pf-sheet"
                role="dialog"
                aria-label="Rechazar solicitud"
                onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    if (!ok || sending) return;
                    setSending(true);
                    setError(null);
                    void onConfirm(reason.trim()).then((msg) => {
                        setError(msg);
                        setSending(false);
                    });
                }}
            >
                <h2>Rechazar solicitud</h2>
                <p className="muted">{item.who}</p>
                {needsReason && (
                    <label className="field">
                        Motivo
                        <textarea className="rq-text" rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </label>
                )}
                {error && (
                    <p className="pf-error" role="alert">
                        {error}
                    </p>
                )}
                <button type="submit" className="btn btn-primary" disabled={!ok || sending}>
                    Confirmar rechazo
                </button>
                <button type="button" className="btn" onClick={onClose} disabled={sending}>
                    Volver
                </button>
            </form>
        </div>
    );
}

function ApprovalCard({ item, busy, error, onApprove, onReject }: { item: Item; busy: boolean; error?: string; onApprove: (minutes?: number) => void; onReject: () => void }) {
    const [minutes, setMinutes] = useState(String(item.requestedMinutes ?? ''));
    const n = Number(minutes);
    const minutesOk = item.kind !== 'overtime' || (Number.isInteger(n) && n >= 1 && n <= (item.requestedMinutes ?? 0));
    return (
        <Card title={item.who}>
            {item.lines.map((l) => (
                <span key={l} className="ap-line">
                    {l}
                </span>
            ))}
            {item.reason && <span className="ap-reason">{item.reason}</span>}
            {item.kind === 'overtime' && (
                <label className="field">
                    Minutos aprobados
                    <input type="number" inputMode="numeric" min={1} max={item.requestedMinutes} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                </label>
            )}
            {item.kind === 'overtime' && !minutesOk && <p className="pf-error">Entre 1 y {item.requestedMinutes} min</p>}
            {error && (
                <p className="pf-error" role="alert">
                    {error}
                </p>
            )}
            <div className="rq-actions">
                <button type="button" className="btn" disabled={busy} onClick={onReject}>
                    Rechazar
                </button>
                <button type="button" className="btn btn-primary" disabled={busy || !minutesOk} onClick={() => onApprove(item.kind === 'overtime' ? n : undefined)}>
                    Aprobar
                </button>
            </div>
        </Card>
    );
}

/** Pending HR requests for ADMIN/SUPERADMIN: permisos, horas extra, correcciones, cambios de turno. */
export function ApprovalsScreen({ hr }: { hr: HrApi }) {
    const { back } = useAccountNav();
    const toast = useToast();
    const [tab, setTab] = useState<Kind>('leave');
    const [data, setData] = useState<Record<Kind, Loaded>>({ leave: null, overtime: null, correction: null, swap: null });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<Set<string>>(new Set());
    const inFlight = useRef(new Set<string>());
    const [rejecting, setRejecting] = useState<Item | null>(null);

    const load = useCallback(
        (kind: Kind) => {
            const get: Record<Kind, () => Promise<Item[]>> = {
                leave: async () => (await hr.pendingLeave()).map(fromLeave),
                overtime: async () => (await hr.pendingOvertime()).map(fromOvertime),
                correction: async () => (await hr.pendingCorrections()).map(fromCorrection),
                swap: async () => (await hr.pendingSwaps()).map(fromSwap),
            };
            setData((d) => ({ ...d, [kind]: null }));
            get[kind]().then(
                (items) => setData((d) => ({ ...d, [kind]: items })),
                () => setData((d) => ({ ...d, [kind]: 'error' })),
            );
        },
        [hr],
    );
    useEffect(() => {
        TABS.forEach((t) => load(t.kind));
    }, [load]);

    useSessionRestored(() => {
        TABS.forEach((t) => data[t.kind] === 'error' && load(t.kind));
    });

    const decide = useCallback(
        async (item: Item, decision: 'APPROVED' | 'REJECTED', reason: string, minutes?: number): Promise<string | null> => {
            const key = `${item.kind}-${item.id}`;
            if (inFlight.current.has(key)) return null;
            inFlight.current.add(key);
            setBusy(new Set(inFlight.current));
            setErrors((e) => ({ ...e, [key]: '' }));
            const opts = { actionId: `decide-${key}` };
            try {
                if (item.kind === 'leave') await hr.decideLeave(item.id, decision, reason, opts);
                else if (item.kind === 'overtime') await hr.decideOvertime(item.id, decision, decision === 'APPROVED' ? minutes : undefined, reason, opts);
                else if (item.kind === 'correction') await hr.decideCorrection(item.id, decision, reason, opts);
                else if (decision === 'APPROVED') await hr.approveSwap(item.id, '');
                else await hr.rejectSwap(item.id);
                setData((d) => {
                    const cur = d[item.kind];
                    return Array.isArray(cur) ? { ...d, [item.kind]: cur.filter((i) => i.id !== item.id) } : d;
                });
                setRejecting(null);
                toast.show(decision === 'APPROVED' ? 'Solicitud aprobada' : 'Solicitud rechazada');
                return null;
            } catch (e) {
                const err = toHrError(e);
                const msg = err.code === 'HR_SELF_APPROVAL_FORBIDDEN' ? SELF_APPROVAL : err.message;
                // Already decided by someone else (409) or gone (404), except self-approval: refresh the tab.
                if ((err.status === 409 || err.status === 404) && err.code !== 'HR_SELF_APPROVAL_FORBIDDEN') {
                    setRejecting(null);
                    load(item.kind);
                    toast.show(msg, 'error');
                    return null;
                }
                setErrors((x) => ({ ...x, [key]: msg }));
                return msg;
            } finally {
                inFlight.current.delete(key);
                setBusy(new Set(inFlight.current));
            }
        },
        [hr, toast, load],
    );

    const current = data[tab];
    return (
        <main className="rq">
            <ScreenHeader title="Por aprobar" onBack={back} />
            <div className="ap-tabs" role="tablist">
                {TABS.map((t) => {
                    const list = data[t.kind];
                    return (
                        <button key={t.kind} type="button" role="tab" aria-selected={tab === t.kind} className={`ap-tab ${tab === t.kind ? 'ap-tab-on' : ''}`} onClick={() => setTab(t.kind)}>
                            {t.label}
                            {Array.isArray(list) && list.length > 0 && <span className="ap-count">{list.length}</span>}
                        </button>
                    );
                })}
            </div>
            <div className="rq-form" role="tabpanel">
                {current === null && <p className="muted">Cargando…</p>}
                {current === 'error' && (
                    <p className="error" role="alert">
                        No se pudo cargar la lista.{' '}
                        <button type="button" className="ah-link" onClick={() => load(tab)}>
                            Reintentar
                        </button>
                    </p>
                )}
                {Array.isArray(current) && !current.length && <p className="muted">Sin solicitudes pendientes</p>}
                {Array.isArray(current) &&
                    current.map((item) => (
                        <ApprovalCard
                            key={`${item.kind}-${item.id}`}
                            item={item}
                            busy={busy.has(`${item.kind}-${item.id}`)}
                            error={errors[`${item.kind}-${item.id}`] || undefined}
                            onApprove={(m) => void decide(item, 'APPROVED', APPROVED_REASON, m)}
                            onReject={() => setRejecting(item)}
                        />
                    ))}
            </div>
            {rejecting && <RejectSheet item={rejecting} onClose={() => setRejecting(null)} onConfirm={async (reason) => {
                        const msg = await decide(rejecting, 'REJECTED', reason);
                        if (msg === null) setRejecting(null);
                        return msg;
                    }} />}
        </main>
    );
}
