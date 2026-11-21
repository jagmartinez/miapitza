import { useCallback, useEffect, useRef, useState } from 'react';
import { addDaysDateOnly, shiftCrossesMidnight, sortScheduleShifts, weekDates, weekStartFor } from '@web/components/hr/scheduleDates';
import type { HrWeeklySchedule } from '@web/types/hr-schedule';
import { Card } from '../../../ui/Card';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useToast } from '../../../ui/Toast';
import { useAccountNav } from '../AccountNav';
import { toHrError, type HrApi } from '../hrApi';
import '../profile/profile.css';

type Week = { k: 'loading' } | { k: 'error' } | { k: 'ok'; schedule: HrWeeklySchedule | null };

const dayLabel = (date: string) => {
    const d = new Date(`${date}T00:00:00`);
    return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('es-NI', { weekday: 'short', day: 'numeric', month: 'short' });
};
const dateLabel = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-NI');
};
const hhmm = (t: string) => t.slice(0, 5);

function WeekCard({ title, weekStart, week, busy, onConfirm, onRetry }: { title: string; weekStart: string; week: Week; busy: boolean; onConfirm: (id: number) => void; onRetry: () => void }) {
    if (week.k === 'loading') return <Card title={title}><p className="muted">Cargando…</p></Card>;
    if (week.k === 'error') {
        return (
            <Card title={title}>
                <p role="alert" className="pf-error">No se pudo cargar el horario.</p>
                <button type="button" className="btn" onClick={onRetry}>Reintentar</button>
            </Card>
        );
    }
    const s = week.schedule;
    if (!s || s.status !== 'PUBLISHED') {
        return <Card title={title}><p className="muted">Aún no hay horario publicado para esta semana</p></Card>;
    }
    const shifts = sortScheduleShifts(s.shifts ?? []);
    return (
        <Card title={title}>
            <div className="pf-list">
                {weekDates(weekStart).map((date) => {
                    const day = shifts.filter((x) => x.date === date);
                    if (!day.length) return null;
                    return (
                        <div key={date} className="pf-row">
                            <strong>{dayLabel(date)}</strong>
                            <span>
                                {day.map((x) => (
                                    <span key={x.id} className="pf-shift">
                                        <span>{`${hhmm(x.startTime)} – ${hhmm(x.endTime)}`}</span>
                                        {shiftCrossesMidnight(x) && <span className="pf-plus" title="Termina al día siguiente">+1</span>}
                                        {x.branch?.name && <span className="muted"> {x.branch.name}</span>}
                                    </span>
                                ))}
                            </span>
                        </div>
                    );
                })}
                {!shifts.length && <p className="muted">Sin turnos esta semana.</p>}
            </div>
            {s.acknowledgedAt ? (
                <p className="pf-ok">Confirmado {dateLabel(s.acknowledgedAt)}</p>
            ) : (
                <button type="button" className="btn btn-primary ah-wide" disabled={busy} onClick={() => onConfirm(s.id)}>
                    Confirmar horario
                </button>
            )}
        </Card>
    );
}

export function ScheduleScreen({ hr }: { hr: HrApi }) {
    const { back } = useAccountNav();
    const toast = useToast();
    const thisWeek = weekStartFor();
    const nextWeek = addDaysDateOnly(thisWeek, 7);
    const [weeks, setWeeks] = useState<Record<string, Week>>({ [thisWeek]: { k: 'loading' }, [nextWeek]: { k: 'loading' } });
    const [busyId, setBusyId] = useState<number | null>(null);
    const inFlight = useRef(false);

    const load = useCallback(
        async (w: string) => {
            setWeeks((cur) => ({ ...cur, [w]: { k: 'loading' } }));
            try {
                const schedule = await hr.mySchedule(w);
                setWeeks((cur) => ({ ...cur, [w]: { k: 'ok', schedule } }));
            } catch {
                setWeeks((cur) => ({ ...cur, [w]: { k: 'error' } }));
            }
        },
        [hr],
    );

    useEffect(() => {
        void load(thisWeek);
        void load(nextWeek);
    }, [load, thisWeek, nextWeek]);

    async function confirm(weekStart: string, id: number) {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusyId(id);
        try {
            await hr.acknowledgeSchedule(id);
            const at = new Date().toISOString();
            setWeeks((cur) => {
                const w = cur[weekStart];
                return w?.k === 'ok' && w.schedule ? { ...cur, [weekStart]: { k: 'ok', schedule: { ...w.schedule, acknowledgedAt: at } } } : cur;
            });
        } catch (e) {
            toast.show(toHrError(e).message, 'error');
        } finally {
            inFlight.current = false;
            setBusyId(null);
        }
    }

    return (
        <main className="ah">
            <ScreenHeader title="Mi horario" onBack={back} />
            <div className="ah-body">
                {[
                    { w: thisWeek, title: 'Esta semana' },
                    { w: nextWeek, title: 'Próxima semana' },
                ].map(({ w, title }) => (
                    <WeekCard key={w} title={title} weekStart={w} week={weeks[w]} busy={busyId !== null} onConfirm={(id) => void confirm(w, id)} onRetry={() => void load(w)} />
                ))}
            </div>
        </main>
    );
}
