import { useState } from 'react';
import type { HrAttendanceAction } from '@web/types/hr-attendance';
import type { HrAttendanceCorrectionPayload, HrCorrectionType } from '@web/types/hr-workforce';
import { useAccountNav } from '../AccountNav';
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
    const canSubmit = validReason(reason) && (!needsTime || !!occurredAt) && (!needsTarget || Number(targetEventId) > 0);

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
                <Field label="Número del marcaje afectado">
                    <input type="number" inputMode="numeric" min={1} value={targetEventId} onChange={(e) => setTargetEventId(e.target.value)} />
                </Field>
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
