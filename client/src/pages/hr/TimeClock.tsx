import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Clock3, Fingerprint, MapPin, RefreshCw } from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
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

export default function TimeClock() {
    const navigate = useNavigate();
    const online = useWorkforceOnline();
    const { success: showSuccess } = useAppToast();
    const [policy, setPolicy] = useState<HrAttendancePolicy | null>(null);
    const [today, setToday] = useState<HrTodayAttendance | null>(null);
    const [biometrics, setBiometrics] = useState<HrBiometricProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [policyResult, todayResult, biometricResult] = await Promise.all([
                attendanceClient.getPolicy(),
                attendanceClient.getToday(),
                attendanceClient.getMyBiometrics(),
            ]);
            setPolicy(policyResult);
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
        void attendanceClient.getToday().then(setToday).catch(() => undefined);
    };

    const biometricBlocked = policy?.requireBiometric && biometrics?.status !== 'ACTIVE';
    const nextAction = today?.availableActions[0];

    return (
        <div className="page-wrapper hr-time-clock-page my-hr-page">
            <MyHrNav />
            <PageHeader className="my-hr-page-header" title="Marcaje" subtitle="Registra tu jornada con la hora y las validaciones oficiales del servidor" icon={Clock3} />
            {!online && <OnlineOnlyNotice online={false} />}
            {loading && <LoadingSpinner text="Preparando marcaje…" />}
            {!loading && error && <div className="state-placeholder" role="alert"><Clock3 size={44} aria-hidden="true" /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void load()}><RefreshCw size={16} /> Reintentar</Button></div>}

            {!loading && !error && policy && today && (
                <>
                    <section className="my-hr-summary-grid" aria-label="Estado de tu marcaje de hoy">
                        <article><CalendarClock size={19} aria-hidden="true" /><span>Turno de hoy</span><strong>{today.scheduledShift ? 'Programado' : 'Sin publicar'}</strong><small>{today.scheduledShift?.branch?.name ?? 'La política se validará al marcar'}</small></article>
                        <article><Clock3 size={19} aria-hidden="true" /><span>Siguiente acción</span><strong>{nextAction ? ATTENDANCE_ACTION_LABELS[nextAction] : 'Sin acción disponible'}</strong><small>{today.availableActions.length > 0 ? `${today.availableActions.length} opción${today.availableActions.length === 1 ? '' : 'es'} habilitada${today.availableActions.length === 1 ? '' : 's'}` : 'El servidor no habilita un nuevo marcaje'}</small></article>
                        <article className={biometricBlocked ? 'is-warning' : 'is-success'}><Fingerprint size={19} aria-hidden="true" /><span>Validación biométrica</span><strong>{policy.requireBiometric ? (biometricBlocked ? 'Requiere atención' : 'Lista') : 'No requerida'}</strong><small>{today.punches.length} marcaje{today.punches.length === 1 ? '' : 's'} registrado{today.punches.length === 1 ? '' : 's'}</small></article>
                    </section>

                    <div className="hr-time-clock-workspace">
                    <section className="hr-today-summary" aria-labelledby="hr-today-title">
                        <div className="hr-panel-heading"><span className="hr-attendance-icon"><Clock3 size={22} aria-hidden="true" /></span><div><span className="hr-section-kicker">JORNADA DE HOY</span><h2 id="hr-today-title">Tu registro de asistencia</h2><p>Hora oficial del servidor: <time dateTime={today.serverTime}>{new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short', timeZone: today.timezone }).format(new Date(today.serverTime))}</time></p></div></div>
                        <div className="hr-policy-chips">
                            <span><MapPin size={15} /> Precisión máxima ±{policy.maxLocationAccuracyM} m</span>
                            <span><Fingerprint size={15} /> {policy.requireBiometric ? 'Verificación facial requerida' : 'Biometría no requerida'}</span>
                        </div>
                        {today.scheduledShift ? <div className="hr-shift-summary"><CalendarClock size={18} aria-hidden="true" /><div><span>Turno programado</span><strong>{new Intl.DateTimeFormat('es-NI', { timeStyle: 'short', timeZone: today.timezone }).format(new Date(today.scheduledShift.startAt))}–{new Intl.DateTimeFormat('es-NI', { timeStyle: 'short', timeZone: today.timezone }).format(new Date(today.scheduledShift.endAt))}</strong><small>{today.scheduledShift.branch?.name ?? `Sucursal #${today.scheduledShift.branchId}`}</small></div></div> : <div className="hr-shift-summary muted"><CalendarClock size={18} aria-hidden="true" /><div><span>Turno programado</span><strong>Sin turno publicado</strong><small>El servidor validará la política aplicable al intentar marcar.</small></div></div>}
                        <div className="hr-punch-history-head"><div><h3>Marcajes de hoy</h3><p>Secuencia registrada y validada por el servidor.</p></div><span>{today.punches.length} evento{today.punches.length === 1 ? '' : 's'}</span></div>
                        {today.punches.length > 0 ? <ol className="hr-today-punches">{today.punches.map((punch) => <li key={punch.id}><CheckCircle2 size={16} aria-hidden="true" /><span>{ATTENDANCE_ACTION_LABELS[punch.action]}</span><time dateTime={punch.occurredAt}>{new Intl.DateTimeFormat('es-NI', { timeStyle: 'short', timeZone: today.timezone }).format(new Date(punch.occurredAt))}</time></li>)}</ol> : <p className="hr-attendance-empty">Todavía no hay marcajes registrados hoy.</p>}
                    </section>

                    <div className="hr-time-clock-action-panel" aria-live="polite">
                    {!online ? (
                        <section className="hr-biometric-required" role="alert"><Clock3 size={36} aria-hidden="true" /><h2>Marcaje no disponible sin conexión</h2><p>La hora, la secuencia y la evidencia deben validarse en línea. No se guardará ningún intento en este dispositivo.</p><Button variant="ghost" onClick={() => void load()}><RefreshCw size={16} /> Reintentar conexión</Button></section>
                    ) : biometricBlocked ? (
                        <section className="hr-biometric-required" role="alert"><Fingerprint size={36} aria-hidden="true" /><h2>Enrolamiento requerido</h2><p>La política exige un perfil biométrico activo. El reconocimiento se ejecuta únicamente en el servidor y puede requerir revisión humana.</p><Button onClick={() => navigate('/rh/biometria')}>Gestionar biometría</Button></section>
                    ) : <AttendancePunchWizard policy={policy} today={today} onCompleted={completed} />}
                    </div>
                    </div>
                </>
            )}
        </div>
    );
}
