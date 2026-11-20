import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, ChevronLeft, ChevronRight, CheckCheck, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import MyHrNav from '../../components/hr/MyHrNav';
import ScheduleStatusPill from '../../components/hr/ScheduleStatusPill';
import ScheduleWeekView from '../../components/hr/ScheduleWeekView';
import { addDaysDateOnly, weekStartFor } from '../../components/hr/scheduleDates';
import { getScheduleErrorMessage, scheduleClient } from '../../components/hr/scheduleClient';
import { HrHero, HrPage, HrSection, HrToolbar, type HrFact } from '../../components/hr/layout/HrWorkspace';
import { useAppToast } from '../../context/ToastContext';
import type { HrHoliday, HrWeeklySchedule } from '../../types/hr-schedule';
import './schedule.css';
import './self-service.css';
import './layouts/autoservicio.css';

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
    const ready = !loading && !error;

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

    const facts: HrFact[] = [
        { label: 'Semana', value: weekStart === currentWeek ? 'Actual' : weekLabel(weekStart), hint: weekStart === currentWeek ? weekLabel(weekStart) : 'Semana consultada' },
        { label: 'Turnos del equipo', value: ready ? published.reduce((total, schedule) => total + schedule.shifts.length, 0) : '—', hint: 'Versiones publicadas' },
        { label: 'Por confirmar', value: ready ? pendingAcknowledgements.length : '—', hint: 'Acuses de recepción pendientes', tone: ready && pendingAcknowledgements.length > 0 ? 'warning' : ready ? 'success' : 'default' },
        { label: 'Estado de la semana', value: ready ? (hasShifts ? 'Con turnos' : 'Sin turnos') : '—', hint: fromCache ? 'Copia offline' : 'Datos actualizados' },
    ];

    return (
        <HrPage className="hr-my-schedule-page my-hr-page ss-page ss-schedule">
            <MyHrNav />
            <HrHero
                eyebrow="Mi RH"
                icon={CalendarCheck}
                title="Horarios del equipo"
                subtitle="Consulta los turnos publicados de tu sucursal y confirma los que te corresponden"
                facts={facts}
            />

            <HrToolbar ariaLabel="Navegación semanal" className="ss-week-nav">
                <Button variant="ghost" onClick={() => setWeekStart(addDaysDateOnly(weekStart, -7))} disabled={acknowledgingId !== null} aria-label="Semana anterior"><ChevronLeft size={18} aria-hidden="true" /> Anterior</Button>
                <div className="ss-week-label"><span>Semana</span><strong>{weekLabel(weekStart)}</strong></div>
                <Button variant="ghost" onClick={() => setWeekStart(currentWeek)} disabled={weekStart === currentWeek || acknowledgingId !== null}>Hoy</Button>
                <Button variant="ghost" onClick={() => setWeekStart(addDaysDateOnly(weekStart, 7))} disabled={acknowledgingId !== null} aria-label="Semana siguiente">Siguiente <ChevronRight size={18} aria-hidden="true" /></Button>
            </HrToolbar>

            {fromCache && (
                <div className="hr-schedule-alert warning" role="alert">
                    Estás consultando una copia guardada sin conexión. La confirmación de recepción se habilitará al recuperar conexión.
                </div>
            )}

            {ready && published.length > 0 && (
                <HrSection
                    eyebrow="Acuse de recepción"
                    title="Versiones publicadas"
                    count={published.length}
                    description="Confirma cada versión después de revisar tus turnos."
                >
                    <div className="ss-versions" aria-label="Versiones publicadas">
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
                    {pendingAcknowledgements.length > 0 && <p className="hr-schedule-help">Confirma cada versión publicada después de revisar tus turnos. El acuse registra recepción, no modifica el horario.</p>}
                </HrSection>
            )}

            <HrSection eyebrow="Calendario" title="Turnos de la semana" description={weekLabel(weekStart)} flush={ready && hasShifts}>
                {loading && <LoadingSpinner text="Cargando horarios del equipo…" />}
                {!loading && error && (
                    <div className="state-placeholder" role="alert"><CalendarCheck size={44} aria-hidden="true" /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void loadWeek()}><RefreshCw size={16} /> Reintentar</Button></div>
                )}
                {ready && !hasShifts && (
                    <div className="ss-empty">
                        <CalendarCheck size={44} aria-hidden="true" />
                        <p>No hay turnos publicados para tu equipo esta semana.</p>
                        <div className="hr-schedule-empty-actions">
                            <Button onClick={() => navigate('/rh/marcaje')}>Ir a marcaje</Button>
                            <Button variant="ghost" onClick={() => navigate('/rh/mi-portal/gestion')}>Ver solicitudes</Button>
                        </div>
                    </div>
                )}
                {ready && hasShifts && <ScheduleWeekView weekStart={weekStart} schedules={published} holidays={holidays} readOnly />}
            </HrSection>
        </HrPage>
    );
}
