import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, ChevronLeft, ChevronRight, CheckCheck, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import MyHrNav from '../../components/hr/MyHrNav';
import ScheduleStatusPill from '../../components/hr/ScheduleStatusPill';
import ScheduleWeekView from '../../components/hr/ScheduleWeekView';
import { addDaysDateOnly, weekStartFor } from '../../components/hr/scheduleDates';
import { getScheduleErrorMessage, scheduleClient } from '../../components/hr/scheduleClient';
import { useAppToast } from '../../context/ToastContext';
import type { HrHoliday, HrWeeklySchedule } from '../../types/hr-schedule';
import './schedule.css';
import './self-service.css';

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
    const pendingAcknowledgements = published.filter((schedule) => schedule.viewerHasShift && !schedule.acknowledgedAt);
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
        <div className="page-wrapper hr-my-schedule-page my-hr-page">
            <PageHeader className="my-hr-page-header" title="Horarios del equipo" subtitle="Consulta los turnos publicados de tu sucursal y confirma los que te corresponden" icon={CalendarCheck} actions={<MyHrNav />} />

            <section className="hr-week-navigation my-hr-toolbar" aria-label="Navegación semanal">
                <Button variant="ghost" onClick={() => setWeekStart(addDaysDateOnly(weekStart, -7))} disabled={acknowledgingId !== null} aria-label="Semana anterior"><ChevronLeft size={18} aria-hidden="true" /> Anterior</Button>
                <div><span>Semana</span><strong>{weekLabel(weekStart)}</strong></div>
                <Button variant="ghost" onClick={() => setWeekStart(currentWeek)} disabled={weekStart === currentWeek || acknowledgingId !== null}>Hoy</Button>
                <Button variant="ghost" onClick={() => setWeekStart(addDaysDateOnly(weekStart, 7))} disabled={acknowledgingId !== null} aria-label="Semana siguiente">Siguiente <ChevronRight size={18} aria-hidden="true" /></Button>
            </section>

            {fromCache && (
                <div className="hr-schedule-alert info" role="status">
                    Estás consultando una copia guardada sin conexión. La confirmación de recepción se habilitará al recuperar conexión.
                </div>
            )}

            {!loading && !error && (
                <section className="my-hr-summary-grid" aria-label="Resumen de la semana consultada">
                    <article><CalendarCheck size={19} aria-hidden="true" /><span>Turnos del equipo</span><strong>{published.reduce((total, schedule) => total + schedule.shifts.length, 0)}</strong><small>{weekLabel(weekStart)}</small></article>
                    <article className={pendingAcknowledgements.length > 0 ? 'is-warning' : 'is-success'}><CheckCheck size={19} aria-hidden="true" /><span>Por confirmar</span><strong>{pendingAcknowledgements.length}</strong><small>Acuses de recepción pendientes</small></article>
                    <article><RefreshCw size={19} aria-hidden="true" /><span>Estado de la semana</span><strong>{hasShifts ? 'Con turnos' : 'Sin turnos'}</strong><small>{fromCache ? 'Copia offline' : 'Datos actualizados'}</small></article>
                </section>
            )}

            {!loading && !error && published.length > 0 && (
                <div className="hr-my-schedule-statuses" aria-label="Versiones publicadas">
                    {published.map((schedule) => (
                        <div key={schedule.id}>
                            <div><ScheduleStatusPill status={schedule.status} /><span>Versión {schedule.version}</span></div>
                            {!schedule.viewerHasShift
                                ? <span className="hr-schedule-personal-state">Sin turno personal esta semana</span>
                                : schedule.acknowledgedAt
                                ? <span className="hr-acknowledged"><CheckCheck size={17} aria-hidden="true" /> Recibido</span>
                                : <Button size="sm" onClick={() => void acknowledge(schedule)} disabled={acknowledgingId !== null || fromCache}>{acknowledgingId === schedule.id ? 'Confirmando…' : 'Confirmar recepción'}</Button>}
                        </div>
                    ))}
                </div>
            )}

            {pendingAcknowledgements.length > 0 && <p className="hr-schedule-help">Confirma cada versión publicada después de revisar tus turnos. El acuse registra recepción, no modifica el horario.</p>}

            {loading && <LoadingSpinner text="Cargando horarios del equipo…" />}
            {!loading && error && (
                <div className="state-placeholder" role="alert"><CalendarCheck size={44} aria-hidden="true" /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void loadWeek()}><RefreshCw size={16} /> Reintentar</Button></div>
            )}
            {!loading && !error && !hasShifts && (
                <div className="state-placeholder">
                    <CalendarCheck size={48} aria-hidden="true" />
                    <p>No hay turnos publicados para tu equipo esta semana.</p>
                    <div className="hr-schedule-empty-actions">
                        <Button onClick={() => navigate('/rh/marcaje')}>Ir a marcaje</Button>
                        <Button variant="ghost" onClick={() => navigate('/rh/mi-portal/gestion')}>Ver solicitudes</Button>
                    </div>
                </div>
            )}
            {!loading && !error && hasShifts && <ScheduleWeekView weekStart={weekStart} schedules={published} holidays={holidays} readOnly />}
        </div>
    );
}
