import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Clock3, Fingerprint, MapPin, RefreshCw } from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import MyHrNav from '../../components/hr/MyHrNav';
import OnlineOnlyNotice from '../../components/hr/OnlineOnlyNotice';
import useWorkforceOnline from '../../components/hr/useWorkforceOnline';
import AttendancePunchWizard from '../../components/hr/AttendancePunchWizard';
import { ATTENDANCE_ACTION_LABELS } from '../../components/hr/attendanceRules';
import { attendanceClient, getAttendanceErrorMessage } from '../../components/hr/attendanceClient';
import { HrHero, HrPage, HrSection, type HrFact } from '../../components/hr/layout/HrWorkspace';
import { useAppToast } from '../../context/ToastContext';
import type { HrAttendancePolicy, HrAttendancePunchResult, HrBiometricProfile, HrTodayAttendance } from '../../types/hr-attendance';
import './attendance.css';
import './self-service.css';
import './layouts/autoservicio.css';

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
    const shortTime = (value: string, timeZone: string) => new Intl.DateTimeFormat('es-NI', { timeStyle: 'short', timeZone }).format(new Date(value));

    const facts: HrFact[] = policy && today ? [
        {
            label: 'Marcaje disponible',
            value: nextAction ? ATTENDANCE_ACTION_LABELS[nextAction] : 'Sin acción disponible',
            hint: nextAction ? `El servidor habilita ${today.availableActions.length === 1 ? 'esta acción' : `${today.availableActions.length} acciones`} para tu estado actual` : (today.blockingIssue?.message ?? 'El servidor no habilita un nuevo marcaje'),
            tone: nextAction ? 'success' : (today.blockingIssue ? 'danger' : 'warning'),
        },
        {
            label: 'Próximo turno',
            value: today.scheduledShift ? `${shortTime(today.scheduledShift.startAt, today.timezone)}–${shortTime(today.scheduledShift.endAt, today.timezone)}` : 'Sin turno publicado',
            hint: today.scheduledShift ? (today.scheduledShift.branch?.name ?? `Sucursal #${today.scheduledShift.branchId}`) : 'El servidor validará la política aplicable',
        },
        {
            label: 'Sucursal a validar',
            value: today.targetBranch?.name ?? 'Sin asignación vigente',
            hint: today.scheduledShift ? 'Asignada al turno publicado' : 'Resuelta desde tu adscripción RH vigente',
        },
        {
            label: 'Validación biométrica',
            value: policy.requireBiometric ? (biometricBlocked ? 'Requiere atención' : 'Lista') : 'No requerida',
            hint: `${today.punches.length} marcaje${today.punches.length === 1 ? '' : 's'} registrado${today.punches.length === 1 ? '' : 's'}`,
            tone: biometricBlocked ? 'warning' : 'default',
        },
    ] : [];

    return (
        <HrPage className="hr-time-clock-page my-hr-page ss-page ss-clock">
            <MyHrNav />
            <HrHero
                eyebrow="Mi RH"
                icon={Clock3}
                title="Marcaje"
                subtitle="Registra tu jornada con la hora y las validaciones oficiales del servidor"
                facts={facts}
            />
            {!online && <OnlineOnlyNotice online={false} />}
            {loading && <LoadingSpinner text="Preparando marcaje…" />}
            {!loading && error && <div className="state-placeholder" role="alert"><Clock3 size={44} aria-hidden="true" /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void load()}><RefreshCw size={16} /> Reintentar</Button></div>}

            {!loading && !error && policy && today && (
                <div className="hr-time-clock-workspace">
                    <div className="hr-time-clock-action-panel" aria-live="polite" aria-label="Acción de marcaje">
                    {!online ? (
                        <section className="hr-biometric-required" role="alert"><Clock3 size={36} aria-hidden="true" /><h2>Marcaje no disponible sin conexión</h2><p>La hora, la secuencia y la evidencia deben validarse en línea. No se guardará ningún intento en este dispositivo.</p><Button variant="ghost" onClick={() => void load()}><RefreshCw size={16} /> Reintentar conexión</Button></section>
                    ) : biometricBlocked ? (
                        <section className="hr-biometric-required" role="alert"><Fingerprint size={36} aria-hidden="true" /><h2>Enrolamiento requerido</h2><p>La política exige un perfil biométrico activo. El reconocimiento se ejecuta únicamente en el servidor y puede requerir revisión humana.</p><Button onClick={() => navigate('/rh/biometria')}>Gestionar biometría</Button></section>
                    ) : <AttendancePunchWizard policy={policy} today={today} onCompleted={completed} onRequestCorrection={() => navigate('/rh/mi-portal/gestion')} onViewSchedule={() => navigate('/rh/mi-portal/horario')} />}
                    </div>

                    <HrSection
                        eyebrow="Jornada de hoy"
                        title={<span id="hr-today-title">Tu registro de asistencia</span>}
                        count={today.punches.length}
                        aria-labelledby="hr-today-title"
                    >
                        <p className="ss-clock-time">Hora oficial del servidor: <time dateTime={today.serverTime}>{new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short', timeZone: today.timezone }).format(new Date(today.serverTime))}</time></p>
                        <div className="hr-policy-chips">
                            <span><MapPin size={15} /> Precisión máxima ±{effectiveMaxAccuracyM} m</span>
                            <span><Fingerprint size={15} /> {policy.requireBiometric ? 'Verificación facial requerida' : 'Biometría no requerida'}</span>
                        </div>
                        {today.scheduledShift ? <div className="hr-shift-summary"><CalendarClock size={18} aria-hidden="true" /><div><span>Turno programado</span><strong>{shortTime(today.scheduledShift.startAt, today.timezone)}–{shortTime(today.scheduledShift.endAt, today.timezone)}</strong><small>{today.scheduledShift.branch?.name ?? `Sucursal #${today.scheduledShift.branchId}`}</small></div></div> : <div className="hr-shift-summary muted"><CalendarClock size={18} aria-hidden="true" /><div><span>Turno programado</span><strong>Sin turno publicado</strong><small>El servidor validará la política aplicable al intentar marcar.</small></div></div>}
                        <h3 className="ss-meta">Marcajes de hoy · secuencia registrada y validada por el servidor</h3>
                        {today.punches.length > 0 ? <ol className="ss-punch-timeline">{today.punches.map((punch) => <li key={punch.id}><CheckCircle2 size={16} aria-hidden="true" /><span>{ATTENDANCE_ACTION_LABELS[punch.action]}</span><time dateTime={punch.occurredAt}>{shortTime(punch.occurredAt, today.timezone)}</time></li>)}</ol> : <p className="hr-attendance-empty">Todavía no hay marcajes registrados hoy.</p>}
                    </HrSection>
                </div>
            )}
        </HrPage>
    );
}
