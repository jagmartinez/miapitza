import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, ChevronLeft, ChevronRight, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, EmptyState, IconButton, LoadErrorState, PageContent, PageHeader, TableToolbar } from '@/ui';
import form from '../../components/hr/hrForm.module.css';
import HrLoading from '../../components/hr/HrLoading';
import MyHrNav from '../../components/hr/MyHrNav';
import ScheduleStatusPill from '../../components/hr/ScheduleStatusPill';
import ScheduleWeekView from '../../components/hr/ScheduleWeekView';
import { addDaysDateOnly, weekStartFor } from '../../components/hr/scheduleDates';
import { getScheduleErrorMessage, scheduleClient } from '../../components/hr/scheduleClient';
import { useAppToast } from '../../context/ToastContext';
import type { HrHoliday, HrWeeklySchedule } from '../../types/hr-schedule';
import './schedule.css';

const weekFormatter = new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function weekLabel(weekStart: string): string {
    return `${weekFormatter.format(new Date(`${weekStart}T00:00:00Z`))} – ${weekFormatter.format(new Date(`${addDaysDateOnly(weekStart, 6)}T00:00:00Z`))}`;
}

export default function MySchedule() {
    const navigate = useNavigate();
    const { success: showSuccess, error: showError } = useAppToast();
    const currentWeek = weekStartFor();
    const [weekStart, setWeekStart] = useState(currentWeek);
    const [schedules, setSchedules] = useState<HrWeeklySchedule[]>([]);
    const [holidays, setHolidays] = useState<HrHoliday[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fromCache, setFromCache] = useState(false);
    const [acknowledgingId, setAcknowledgingId] = useState<number | null>(null);
    const requestId = useRef(0);
    const acknowledgeLock = useRef(false);
    const weekRef = useRef(weekStart);
    weekRef.current = weekStart;

    const loadWeek = useCallback(async () => {
        const activeRequest = ++requestId.current;
        setLoading(true);
        setError(null);
        try {
            const result = await scheduleClient.getTeamSchedule(weekStart);
            if (activeRequest !== requestId.current) return;
            setSchedules(result.schedules);
            setHolidays(result.holidays);
            setFromCache(result.fromCache === true);
        } catch (loadError) {
            if (activeRequest !== requestId.current) return;
            setSchedules([]);
            setHolidays([]);
            setFromCache(false);
            setError(getScheduleErrorMessage(loadError, 'No fue posible cargar los horarios del equipo.'));
        } finally {
            if (activeRequest === requestId.current) setLoading(false);
        }
    }, [weekStart]);

    useEffect(() => { void loadWeek(); }, [loadWeek]);
    const published = useMemo(() => schedules.filter((schedule) => schedule.status === 'PUBLISHED'), [schedules]);
    const hasShifts = published.some((schedule) => schedule.shifts.length > 0);

    const acknowledge = async (schedule: HrWeeklySchedule) => {
        if (acknowledgeLock.current || fromCache) return;
        acknowledgeLock.current = true;
        const operationWeek = weekStart;
        setAcknowledgingId(schedule.id);
        try {
            await scheduleClient.acknowledgeSchedule(schedule.id);
            showSuccess('Horario recibido y confirmado.');
            if (weekRef.current === operationWeek) await loadWeek();
        } catch (acknowledgeError) {
            showError(getScheduleErrorMessage(acknowledgeError, 'No fue posible confirmar la recepción.'));
        } finally {
            acknowledgeLock.current = false;
            setAcknowledgingId(null);
        }
    };

    return (
        <PageContent>
            <PageHeader
                breadcrumb={['Mi RH']}
                title="Horarios del equipo"
                description="Consulta los turnos publicados de tu sucursal y confirma los que te corresponden"
                actions={<MyHrNav />}
            />

            {fromCache && (
                <div className={form.alertWarning} role="alert">
                    Estás consultando una copia guardada sin conexión. La confirmación de recepción se habilitará al recuperar conexión.
                </div>
            )}

            <TableToolbar>
                <div className={form.weekNav} role="group" aria-label="Navegación semanal">
                    <IconButton icon={ChevronLeft} label="Semana anterior" onClick={() => setWeekStart(addDaysDateOnly(weekStart, -7))} disabled={acknowledgingId !== null} />
                    <strong>{weekLabel(weekStart)}</strong>
                    <IconButton icon={ChevronRight} label="Semana siguiente" onClick={() => setWeekStart(addDaysDateOnly(weekStart, 7))} disabled={acknowledgingId !== null} />
                    <Button variant="ghost" onClick={() => setWeekStart(currentWeek)} disabled={weekStart === currentWeek || acknowledgingId !== null}>Hoy</Button>
                </div>
            </TableToolbar>

            {!loading && !error && published.length > 0 && (
                <ul className={form.ackList} aria-label="Versiones publicadas">
                    {published.map((schedule) => (
                        <li key={schedule.id} className={schedule.viewerHasShift && !schedule.acknowledgedAt ? form.ackPending : undefined}>
                            <ScheduleStatusPill status={schedule.status} />
                            <span className={form.ackText}>
                                <strong>Versión {schedule.version}</strong>
                                <span>
                                    {!schedule.viewerHasShift
                                        ? 'No tienes turnos en esta versión.'
                                        : schedule.acknowledgedAt
                                            ? 'Ya confirmaste que recibiste este horario.'
                                            : 'Revisa tus turnos y confirma que recibiste el horario. Confirmar no modifica los turnos.'}
                                </span>
                            </span>
                            {schedule.viewerHasShift && (schedule.acknowledgedAt
                                ? <Badge tone="success"><CheckCheck size={14} aria-hidden="true" /> Recibido</Badge>
                                : <Button variant="primary" size="sm" loading={acknowledgingId === schedule.id} onClick={() => void acknowledge(schedule)} disabled={acknowledgingId !== null || fromCache}>Confirmar recepción</Button>)}
                        </li>
                    ))}
                </ul>
            )}

            {loading && <HrLoading text="Cargando horarios del equipo…" />}
            {!loading && error && <LoadErrorState message={error} onRetry={() => void loadWeek()} />}
            {!loading && !error && !hasShifts && (
                <EmptyState
                    icon={CalendarCheck}
                    title="No hay turnos publicados para tu equipo esta semana."
                    action={
                        <>
                            <Button variant="primary" onClick={() => navigate('/rh/marcaje')}>Ir a marcaje</Button>
                            <Button variant="ghost" onClick={() => navigate('/rh/mi-portal/gestion')}>Ver solicitudes</Button>
                        </>
                    }
                />
            )}
            {!loading && !error && hasShifts && (
                <section aria-label={`Turnos de la semana ${weekLabel(weekStart)}`}>
                    <ScheduleWeekView weekStart={weekStart} schedules={published} holidays={holidays} readOnly />
                </section>
            )}
        </PageContent>
    );
}
