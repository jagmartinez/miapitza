import { useState } from 'react';
import type { HrApi } from '../hrApi';
import { Field, FormScreen, useRequestSubmit, validReason, REASON_MAX } from './common';

export const MAX_OVERTIME_MINUTES = 10080;

export function OvertimeForm({ hr }: { hr: HrApi }) {
    const { busy, error, submit } = useRequestSubmit();
    const [date, setDate] = useState('');
    const [minutes, setMinutes] = useState('');
    const [reason, setReason] = useState('');

    const n = Number(minutes);
    const canSubmit = !!date && minutes !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_OVERTIME_MINUTES && validReason(reason);

    return (
        <FormScreen
            title="Horas extra"
            canSubmit={canSubmit}
            busy={busy}
            error={error}
            onSubmit={() => void submit((action) => hr.createOvertime({ date, requestedMinutes: n, reason: reason.trim() }, action))}
        >
            <Field label="Fecha">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Minutos">
                <input type="number" inputMode="numeric" min={1} max={MAX_OVERTIME_MINUTES} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
            <Field label="Motivo">
                <textarea className="rq-text" rows={4} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <p className="muted">Entre 1 y 10080 minutos. Mínimo 3 caracteres en el motivo.</p>
        </FormScreen>
    );
}
