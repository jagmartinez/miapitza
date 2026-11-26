import { useEffect, useState } from 'react';
import { ATTENDANCE_ACTION_LABELS } from '@web/components/hr/attendanceRules';
import type { HrAttendanceAction, HrAttendancePunch } from '@web/types/hr-attendance';
import type { HrAttendanceCorrectionPayload, HrCorrectionType } from '@web/types/hr-workforce';
import { useAccountNav } from '../AccountNav';
import { instantText } from '../format';
import type { HrApi } from '../hrApi';
import { Field, FormScreen, useRequestSubmit, validReason, REASON_MAX } from './common';

const TYPES: Array<{ value: HrCorrectionType; label: string }> = [
    { value: 'ADD_PUNCH', label: 'Agregar marcaje' },
    { value: 'VOID_PUNCH', label: 'Invalidar marcaje' },
    { value: 'CHANGE_TIME', label: 'Corregir fecha/hora' },
    { value: 'OTHER', label: 'Otra corrección' },
];

export function CorrectionForm({ hr }: { hr: HrApi }) {
    const { params } = useAccountNav();
    const stale = params.stale === true;
    const { busy, error, submit } = useRequestSubmit();
    // Entry from a forgotten check-out: the usual fix is a missing CHECK_OUT.
    const [type, setType] = useState<HrCorrectionType>('ADD_PUNCH');
    const [action, setAction] = useState<HrAttendanceAction>(stale ? 'CHECK_OUT' : 'CHECK_IN');
    const [targetEventId, setTargetEventId] = useState('');
    const [occurredAt, setOccurredAt] = useState('');
    const [reason, setReason] = useState('');

    const needsTime = type === 'ADD_PUNCH' || type === 'CHANGE_TIME';
    const needsTarget = type === 'VOID_PUNCH' || type === 'CHANGE_TIME';
    // The only self route that lists punch ids is today's attendance (today plus any open session).
    const [recent, setRecent] = useState<{ punches: HrAttendancePunch[]; tz: string } | 'error' | null>(null);
    useEffect(() => {
        if (!needsTarget || recent) return;
        let alive = true;
        hr.attendanceToday().then(
            (t) => alive && setRecent({ punches: t?.punches ?? [], tz: t?.timezone ?? 'UTC' }),
            () => alive && setRecent('error'),
        );
        return () => {
            alive = false;
        };
    }, [hr, needsTarget, recent]);
    const canSubmit = validReason(reason) && (!needsTime || !!occurredAt) && (!needsTarget || (recent !== null && recent !== 'error' && recent.punches.some((p) => String(p.id) === targetEventId)));

    const send = () =>
        submit((opts) => {
            const body: HrAttendanceCorrectionPayload = {
                type,
                ...(type === 'ADD_PUNCH' ? { requestedAction: action } : {}),
                ...(needsTarget && targetEventId ? { targetEventId: Number(targetEventId) } : {}),
                ...(needsTime && occurredAt ? { requestedOccurredAt: occurredAt } : {}),
                reason: reason.trim(),
            };
            return hr.createCorrection(body, opts);
        });

    return (
        <FormScreen title="Corregir marcaje" canSubmit={canSubmit} busy={busy} error={error} onSubmit={() => void send()}>
            {stale && <p className="muted">Tienes una jornada abierta sin cerrar. Indica la hora real de tu salida.</p>}
            <Field label="Tipo de corrección">
                <select value={type} onChange={(e) => setType(e.target.value as HrCorrectionType)}>
                    {TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                            {t.label}
                        </option>
                    ))}
                </select>
            </Field>
            {type === 'ADD_PUNCH' && (
                <Field label="Acción del marcaje">
                    <select value={action} onChange={(e) => setAction(e.target.value as HrAttendanceAction)}>
                        <option value="CHECK_IN">Entrada</option>
                        <option value="BREAK_START">Inicio de descanso</option>
                        <option value="BREAK_END">Fin de descanso</option>
                        <option value="CHECK_OUT">Salida</option>
                    </select>
                </Field>
            )}
            {needsTarget && (
                recent === 'error' ? (
                    <p className="pf-error" role="alert">
                        No se pudieron cargar tus marcajes. <button type="button" className="ah-link" onClick={() => setRecent(null)}>Reintentar</button>
                    </p>
                ) : recent && recent.punches.length === 0 ? (
                    <p className="muted">No hay marcajes recientes (de hoy) para corregir. Si falta uno, usa «Agregar marcaje».</p>
                ) : (
                    <Field label="Marcaje afectado">
                        <select value={targetEventId} onChange={(e) => setTargetEventId(e.target.value)} disabled={!recent}>
                            <option value="">{recent ? 'Elige un marcaje' : 'Cargando…'}</option>
                            {recent?.punches.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {`${ATTENDANCE_ACTION_LABELS[p.action]} ${instantText(p.occurredAt, recent.tz)}`}
                                </option>
                            ))}
                        </select>
                    </Field>
                )
            )}
            {needsTime && (
                <Field label="Fecha y hora">
                    <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
                </Field>
            )}
            {needsTime && (
                <p className="muted">Hora de la sucursal</p>
            )}
            <Field label="Motivo">
                <textarea className="rq-text" rows={4} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <p className="muted">La corrección no reescribe el historial: RH la revisa y queda registrada.</p>
        </FormScreen>
    );
}
