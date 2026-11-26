import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Clock3, Fingerprint, MapPin, RefreshCw } from 'lucide-react';
import { Button, LoadErrorState, PageHeader, StatCard } from '@/ui';
import HrLoading from '../../components/hr/HrLoading';
import MyHrNav from '../../components/hr/MyHrNav';
import OnlineOnlyNotice from '../../components/hr/OnlineOnlyNotice';
import useWorkforceOnline from '../../components/hr/useWorkforceOnline';
import AttendancePunchWizard from '../../components/hr/AttendancePunchWizard';
import { ATTENDANCE_ACTION_LABELS } from '../../components/hr/attendanceRules';
import { attendanceClient, getAttendanceErrorMessage } from '../../components/hr/attendanceClient';
import { useAppToast } from '../../context/ToastContext';
import type { HrAttendancePolicy, HrAttendancePunchResult, HrBiometricProfile, HrTodayAttendance } from '../../types/hr-attendance';
import './attendance.css';
import './self-service.css';
import styles from './SelfService.module.css';

export default function TimeClock() {
    const navigate = useNavigate();
    const online = useWorkforceOnline();
    const { success: showSuccess, error: showError } = useAppToast();
    const [policy, setPolicy] = useState<HrAttendancePolicy | null>(null);
    const [today, setToday] = useState<HrTodayAttendance | null>(null);
    const [biometrics, setBiometrics] = useState<HrBiometricProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [todayResult, biometricResult] = await Promise.all([
                attendanceClient.getToday(),
                attendanceClient.getMyBiometrics(),
            ]);
            setPolicy(todayResult.policy);
            setToday(todayResult);
            setBiometrics(biometricResult);
        } catch (loadError) {
            setPolicy(null);
            setToday(null);
            setBiometrics(null);
            setError(getAttendanceErrorMessage(loadError, 'No fue posible preparar el marcaje.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const completed = (result: HrAttendancePunchResult) => {
        if (result.decision === 'ACCEPTED') showSuccess('Marcaje registrado.');
        void attendanceClient.getToday().then((next) => {
            setToday(next);
            setPolicy(next.policy);
        }).catch(() => {
            showError('Marcaje registrado; no se pudo actualizar el estado. Actualiza antes de un nuevo intento.');
        });
    };

    const biometricBlocked = policy?.requireBiometric && biometrics?.status !== 'ACTIVE';
    const nextAction = today?.availableActions[0];
    const effectiveMaxAccuracyM = today?.locationRequirements?.maxAccuracyM ?? policy?.maxLocationAccuracyM;

    return (
        <div className="page-wrapper hr-time-clock-page my-hr-page">
            <PageHeader
        title="Marcaje"
        description="Registra tu jornada con la hora y las validaciones oficiales del servidor"
        actions={<MyHrNav />}
      />
            {!online && <OnlineOnlyNotice online={false} />}
            {loading && <HrLoading text="Preparando marcaje…" />}
            {!loading && error && <LoadErrorState message={error} onRetry={() => void load()} />}

            {!loading && !error && policy && today && (
                <>
                    <section className={styles.stats} aria-label="Estado de tu marcaje de hoy">
                        <StatCard
                            label="Sucursal a validar"
                            value={today.targetBranch?.name ?? 'Sin asignación vigente'}
                            context={today.scheduledShift ? 'Asignada al turno publicado' : 'Resuelta desde tu adscripción RH vigente'}
                        />
                        <StatCard
                            label="Marcaje disponible"
                            value={nextAction ? ATTENDANCE_ACTION_LABELS[nextAction] : 'Sin acción disponible'}
                            context={nextAction ? `El servidor habilita ${today.availableActions.length === 1 ? 'esta acción' : `${today.availableActions.length} acciones`} para tu estado actual` : (today.blockingIssue?.message ?? 'El servidor no habilita un nuevo marcaje')}
                            tone={nextAction ? 'success' : (today.blockingIssue ? 'danger' : 'warning')}
                        />
                        <StatCard
                            label="Validación biométrica"
                            value={policy.requireBiometric ? (biometricBlocked ? 'Requiere atención' : 'Lista') : 'No requerida'}
                            context={`${today.punches.length} marcaje${today.punches.length === 1 ? '' : 's'} registrado${today.punches.length === 1 ? '' : 's'}`}
                            tone={biometricBlocked ? 'warning' : 'success'}
                            action={biometricBlocked ? { label: 'Gestionar biometría', onClick: () => navigate('/rh/biometria') } : undefined}
                        />
                    </section>

                    <div className="hr-time-clock-workspace">
                    <section className="hr-today-summary" aria-labelledby="hr-today-title">
                        <div className="hr-panel-heading"><span className="hr-attendance-icon"><Clock3 size={22} aria-hidden="true" /></span><div><span className="hr-section-kicker">JORNADA DE HOY</span><h2 id="hr-today-title">Tu registro de asistencia</h2><p>Hora oficial del servidor: <time dateTime={today.serverTime}>{new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short', timeZone: today.timezone }).format(new Date(today.serverTime))}</time></p></div></div>
                        <p className="hr-attendance-server-time">Hora oficial del servidor: <time dateTime={today.serverTime}>{new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short', timeZone: today.timezone }).format(new Date(today.serverTime))}</time></p>
                        <div className="hr-policy-chips">
                            <span><MapPin size={15} /> Precisión máxima ±{effectiveMaxAccuracyM} m</span>
                            <span><Fingerprint size={15} /> {policy.requireBiometric ? 'Verificación facial requerida' : 'Biometría no requerida'}</span>
                        </div>
                        {today.scheduledShift ? <div className="hr-shift-summary"><CalendarClock size={18} aria-hidden="true" /><div><span>Turno programado</span><strong>{new Intl.DateTimeFormat('es-NI', { timeStyle: 'short', timeZone: today.timezone }).format(new Date(today.scheduledShift.startAt))}–{new Intl.DateTimeFormat('es-NI', { timeStyle: 'short', timeZone: today.timezone }).format(new Date(today.scheduledShift.endAt))}</strong><small>{today.scheduledShift.branch?.name ?? `Sucursal #${today.scheduledShift.branchId}`}</small></div></div> : <div className="hr-shift-summary muted"><CalendarClock size={18} aria-hidden="true" /><div><span>Turno programado</span><strong>Sin turno publicado</strong><small>El servidor validará la política aplicable al intentar marcar.</small></div></div>}
                        <div className="hr-punch-history-head"><div><h3>Marcajes de hoy</h3><p>Secuencia registrada y validada por el servidor.</p></div><span>{today.punches.length} evento{today.punches.length === 1 ? '' : 's'}</span></div>
                        {today.punches.length > 0 ? <ol className="hr-today-punches">{today.punches.map((punch) => <li key={punch.id}><CheckCircle2 size={16} aria-hidden="true" /><span>{ATTENDANCE_ACTION_LABELS[punch.action]}</span><time dateTime={punch.occurredAt}>{new Intl.DateTimeFormat('es-NI', { timeStyle: 'short', timeZone: today.timezone }).format(new Date(punch.occurredAt))}</time></li>)}</ol> : <p className="hr-attendance-empty">Todavía no hay marcajes registrados hoy.</p>}
                    </section>

                    <div className="hr-time-clock-action-panel" aria-live="polite" aria-label="Acción de marcaje">
                    {!online ? (
                        <section className="hr-biometric-required" role="alert"><Clock3 size={36} aria-hidden="true" /><h2>Marcaje no disponible sin conexión</h2><p>La hora, la secuencia y la evidencia deben validarse en línea. No se guardará ningún intento en este dispositivo.</p><Button variant="ghost" onClick={() => void load()}><RefreshCw size={16} /> Reintentar conexión</Button></section>
                    ) : biometricBlocked ? (
                        <section className="hr-biometric-required" role="alert"><Fingerprint size={36} aria-hidden="true" /><h2>Enrolamiento requerido</h2><p>La política exige un perfil biométrico activo. El reconocimiento se ejecuta únicamente en el servidor y puede requerir revisión humana.</p><Button variant="primary" onClick={() => navigate('/rh/biometria')}>Gestionar biometría</Button></section>
                    ) : <AttendancePunchWizard policy={policy} today={today} onCompleted={completed} onRequestCorrection={() => navigate('/rh/mi-portal/gestion')} onViewSchedule={() => navigate('/rh/mi-portal/horario')} />}
                    </div>
                    </div>
                </>
            )}
        </div>
    );
}
