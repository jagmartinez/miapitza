import { useEffect, useMemo, useState } from 'react';
import { addDaysDateOnly, sortScheduleShifts, weekStartFor } from '@web/components/hr/scheduleDates';
import { formatLocalDateInput } from '@web/utils/dateInput';
import type { HrScheduleShift, HrWeeklySchedule } from '@web/types/hr-schedule';
import { toHrError, type HrApi, type HrSwapBody } from '../hrApi';
import { AMBIGUOUS_SWAP, Field, FormScreen, useRequestSubmit } from './common';

const hhmm = (t: string) => t.slice(0, 5);
const dayLabel = (date: string) => {
    const d = new Date(`${date}T00:00:00`);
    return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('es-NI', { weekday: 'short', day: 'numeric', month: 'short' });
};
const shiftLabel = (s: HrScheduleShift) => `${dayLabel(s.date)} ${hhmm(s.startTime)} – ${hhmm(s.endTime)}`;

/** The team schedule may come as a list, a `{schedules|items}` collection or a single schedule. */
function publishedShifts(raw: unknown): HrScheduleShift[] {
    if (!raw || typeof raw !== 'object') return [];
    const r = raw as { schedules?: unknown; items?: unknown; shifts?: unknown };
    const schedules = Array.isArray(raw) ? raw : Array.isArray(r.schedules) ? r.schedules : Array.isArray(r.items) ? r.items : Array.isArray(r.shifts) ? [raw] : [];
    return (schedules as HrWeeklySchedule[]).filter((s) => s && s.status === 'PUBLISHED').flatMap((s) => s.shifts ?? []);
}

export function SwapForm({ hr, userId }: { hr: HrApi; userId: number }) {
    // The server takes no Idempotency-Key for swaps: an ambiguous failure is reported, never retried.
    const { busy, error, submit } = useRequestSubmit({ onAmbiguous: AMBIGUOUS_SWAP });
    const [mine, setMine] = useState<HrScheduleShift[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [shiftId, setShiftId] = useState('');
    const [team, setTeam] = useState<HrScheduleShift[]>([]);
    const [mateId, setMateId] = useState('');
    const [offeredId, setOfferedId] = useState('');
    const [reason, setReason] = useState('');
    const [tick, setTick] = useState(0);
    const today = formatLocalDateInput();

    useEffect(() => {
        let alive = true;
        setLoadError(null);
        const thisWeek = weekStartFor();
        Promise.allSettled([hr.mySchedule(thisWeek), hr.mySchedule(addDaysDateOnly(thisWeek, 7))]).then((r) => {
            if (!alive) return;
            if (r.every((x) => x.status === 'rejected')) {
                setLoadError(toHrError((r[0] as PromiseRejectedResult).reason).message);
                return;
            }
            const all = r.flatMap((x) => (x.status === 'fulfilled' && x.value && x.value.status === 'PUBLISHED' ? x.value.shifts ?? [] : []));
            const unique = [...new Map(all.map((s) => [s.id, s])).values()].filter((s) => s.date >= today);
            setMine(sortScheduleShifts(unique));
        });
        return () => {
            alive = false;
        };
    }, [hr, today, tick]);

    const myShift = mine?.find((s) => String(s.id) === shiftId);
    const myShiftDate = myShift?.date;

    useEffect(() => {
        setTeam([]);
        setMateId('');
        setOfferedId('');
        if (!myShiftDate) return;
        let alive = true;
        Promise.resolve(hr.teamSchedule(weekStartFor(myShiftDate))).then(
            (raw) => alive && setTeam(publishedShifts(raw)),
            (e) => alive && setLoadError(toHrError(e).message),
        );
        return () => {
            alive = false;
        };
    }, [hr, myShiftDate]);

    const mates = useMemo(() => {
        const seen = new Map<number, string>();
        for (const s of team) {
            if (s.userId === userId || seen.has(s.userId)) continue;
            if (myShift && s.branchId != null && myShift.branchId != null && s.branchId !== myShift.branchId) continue;
            seen.set(s.userId, s.user?.name ?? `Empleado ${s.userId}`);
        }
        return [...seen].map(([id, name]) => ({ id, name }));
    }, [team, userId, myShift]);
    const mateShifts = useMemo(
        () => sortScheduleShifts(team.filter((s) => String(s.userId) === mateId && s.date >= today && (!myShift || s.branchId === myShift.branchId))),
        [team, mateId, today, myShift],
    );

    const canSubmit = !!myShift && !!mateId && reason.length <= 1000;
    const send = () =>
        submit(() => {
            const body: HrSwapBody = {
                requesterShiftId: myShift!.id,
                targetUserId: Number(mateId),
                ...(offeredId ? { offeredShiftId: Number(offeredId) } : {}),
                ...(reason.trim() ? { reason: reason.trim() } : {}),
            };
            return hr.createSwap(body);
        });

    return (
        <FormScreen title="Cambio de turno" canSubmit={canSubmit} busy={busy} error={error} onSubmit={() => void send()}>
            {loadError && (
                <p className="pf-error" role="alert">
                    {loadError} <button type="button" className="ah-link" onClick={() => setTick((t) => t + 1)}>Reintentar</button>
                </p>
            )}
            <Field label="Mi turno">
                <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
                    <option value="">{mine && !mine.length ? 'No tienes turnos publicados próximos' : 'Seleccionar…'}</option>
                    {(mine ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                            {shiftLabel(s)}
                        </option>
                    ))}
                </select>
            </Field>
            {myShift && (
                <Field label="Compañero">
                    <select
                        value={mateId}
                        onChange={(e) => {
                            setMateId(e.target.value);
                            setOfferedId('');
                        }}
                    >
                        <option value="">Seleccionar…</option>
                        {mates.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </Field>
            )}
            {mateId && (
                <Field label="Turno a recibir (opcional)">
                    <select value={offeredId} onChange={(e) => setOfferedId(e.target.value)}>
                        <option value="">Ninguno</option>
                        {mateShifts.map((s) => (
                            <option key={s.id} value={s.id}>
                                {shiftLabel(s)}
                            </option>
                        ))}
                    </select>
                </Field>
            )}
            <Field label="Motivo">
                <textarea className="rq-text" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <p className="muted">Tu compañero debe aceptar y luego RH aprueba el cambio.</p>
        </FormScreen>
    );
}
