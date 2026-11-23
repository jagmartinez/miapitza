import { useEffect, useState } from 'react';
import { selectVacationBalance } from '@web/components/hr/vacationBalance';
import { formatHrNumber } from '@web/utils/hrFormat';
import type { HrLeaveFraction, HrLeaveRequestPayload, HrLeaveType, HrVacationBalance } from '@web/types/hr-workforce';
import { toHrError, type HrApi } from '../hrApi';
import { Field, FormScreen, useRequestSubmit, validReason, REASON_MAX } from './common';

const UNIT_LABEL = { DAYS: 'días', HOURS: 'horas', MINUTES: 'minutos' } as const;

const minuteOfDay = (v: string) => {
    const [h, m] = v.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

function balanceFor(type: HrLeaveType | undefined, vacation: HrVacationBalance | null): HrVacationBalance | null {
    if (!type || !vacation) return null;
    const id = vacation.leaveTypeId ?? vacation.leaveType?.id;
    if (id != null) return id === type.id ? vacation : null;
    return vacation.leaveType?.code && vacation.leaveType.code === type.code ? vacation : null;
}

export function LeaveForm({ hr }: { hr: HrApi }) {
    const { busy, error, submit } = useRequestSubmit();
    const [types, setTypes] = useState<HrLeaveType[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [vacation, setVacation] = useState<HrVacationBalance | null>(null);
    const [typeId, setTypeId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [fraction, setFraction] = useState<HrLeaveFraction>('FULL_DAY');
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [reason, setReason] = useState('');
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let alive = true;
        setLoadError(null);
        hr.leaveTypes().then(
            (t) => alive && setTypes(t.filter((x) => x.active && !x.requiresAttachment)),
            (e) => alive && setLoadError(toHrError(e).message),
        );
        // The balance is a nicety: without it the form still works.
        Promise.resolve(hr.myWorkforce({ summaries: false })).then(
            (w) => alive && setVacation(selectVacationBalance(w?.vacationBalances)),
            () => undefined,
        );
        return () => {
            alive = false;
        };
    }, [hr, tick]);

    const type = types?.find((t) => String(t.id) === typeId);
    const balance = balanceFor(type, vacation);
    const withTimes = fraction === 'HOURS' || fraction === 'HALF_DAY';
    const datesInvalid = !!startDate && !!endDate && endDate < startDate;
    // HOURS is a time range within one day. HALF_DAY length is configured on the server, which validates it.
    const hoursMultiDay = fraction === 'HOURS' && !!startDate && !!endDate && endDate !== startDate;
    const hoursOrder = fraction === 'HOURS' && !!startTime && !!endTime && (minuteOfDay(endTime) ?? 0) <= (minuteOfDay(startTime) ?? 0);
    const canSubmit = !!type && !!startDate && !!endDate && !datesInvalid && validReason(reason) && (!withTimes || (!!startTime && !!endTime)) && !hoursMultiDay && !hoursOrder;

    const send = () =>
        submit((action) => {
            const body: HrLeaveRequestPayload = {
                leaveTypeId: type!.id,
                startDate,
                endDate,
                fraction,
                ...(withTimes ? { startTime, endTime } : {}),
                reason: reason.trim(),
            };
            return hr.createLeave(body, action);
        });

    return (
        <FormScreen title="Permiso / vacaciones" canSubmit={canSubmit} busy={busy} error={error} onSubmit={() => void send()}>
            {loadError && (
                <p className="pf-error" role="alert">
                    {loadError} <button type="button" className="ah-link" onClick={() => setTick((t) => t + 1)}>Reintentar</button>
                </p>
            )}
            <Field label="Tipo de permiso">
                <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                    <option value="">Seleccionar…</option>
                    {(types ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                            {t.name}
                        </option>
                    ))}
                </select>
            </Field>
            {balance && <p className="rq-info">{`Disponibles: ${formatHrNumber(balance.available)} ${UNIT_LABEL[balance.unit] ?? ''}`.trim()}</p>}
            <Field label="Desde">
                <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                        setStartDate(e.target.value);
                        if (!endDate) setEndDate(e.target.value);
                    }}
                />
            </Field>
            <Field label="Hasta">
                <input type="date" min={startDate || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field label="Fracción">
                <select value={fraction} onChange={(e) => setFraction(e.target.value as HrLeaveFraction)}>
                    <option value="FULL_DAY">Día completo</option>
                    <option value="HALF_DAY">Medio día</option>
                    <option value="HOURS">Rango de horas</option>
                </select>
            </Field>
            {withTimes && (
                <>
                    <Field label="Hora inicial">
                        <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    </Field>
                    <Field label="Hora final">
                        <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                    </Field>
                </>
            )}
            {datesInvalid && <p className="pf-error">La fecha final no puede ser anterior a la inicial.</p>}
            {hoursMultiDay && <p className="pf-error">Un rango de horas debe ser de un solo día.</p>}
            {hoursOrder && <p className="pf-error">La hora final debe ser posterior a la inicial.</p>}
            <Field label="Motivo">
                <textarea className="rq-text" rows={4} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <p className="muted">Mínimo 3 caracteres. El servidor valida el saldo y las fechas.</p>
        </FormScreen>
    );
}
