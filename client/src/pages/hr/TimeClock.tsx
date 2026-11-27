import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock3, Fingerprint, MapPin, RefreshCw } from 'lucide-react';
import { Button, EmptyState, FormSection, LoadErrorState, PageContent, PageHeader } from '@/ui';
import form from '../../components/hr/hrForm.module.css';
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

    const timeFormat = (value: string, options: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat('es-NI', { ...options, timeZone: today?.timezone }).format(new Date(value));

    return (
        <PageContent>
            <PageHeader
                breadcrumb={['Mi RH']}
                title="Marcaje"
                description="Registra tu jornada con la hora y las validaciones oficiales del servidor"
                actions={<MyHrNav />}
            />
            {!online && <OnlineOnlyNotice online={false} />}
            {loading && <HrLoading text="Preparando marcaje…" />}
            {!loading && error && <LoadErrorState message={error} onRetry={() => void load()} />}

            {!loading && !error && policy && today && (
                <>
                    {!nextAction && (
                        <div className={today.blockingIssue ? form.alertDanger : form.alertWarning} role="status">
                            {today.blockingIssue?.message ?? 'El servidor no habilita un nuevo marcaje'}
                        </div>
                    )}
                    <div className={form.split}>
                        <div className={`hr-time-clock-action-panel ${form.panel}`} aria-live="polite" aria-label="Acción de marcaje">
                            {!online ? (
                                <EmptyState icon={Clock3} title="Marcaje no disponible sin conexión" description="La hora, la secuencia y la evidencia deben validarse en línea. No se guardará ningún intento en este dispositivo." action={<Button variant="ghost" icon={RefreshCw} onClick={() => void load()}>Reintentar conexión</Button>} />
                            ) : biometricBlocked ? (
                                <EmptyState icon={Fingerprint} title="Enrolamiento requerido" description="La política exige un perfil biométrico activo. El reconocimiento se ejecuta únicamente en el servidor y puede requerir revisión humana." action={<Button variant="primary" onClick={() => navigate('/rh/biometria')}>Gestionar biometría</Button>} />
                            ) : <AttendancePunchWizard policy={policy} today={today} onCompleted={completed} onRequestCorrection={() => navigate('/rh/mi-portal/gestion')} onViewSchedule={() => navigate('/rh/mi-portal/horario')} />}
                        </div>

                        <section className={form.panel} aria-labelledby="hr-today-title">
                            <FormSection title="Tu registro de asistencia" description={`Hora oficial del servidor: ${timeFormat(today.serverTime, { dateStyle: 'medium', timeStyle: 'short' })}`}>
                                <span id="hr-today-title" className="sr-only">Jornada de hoy</span>
                                <dl className={form.facts}>
                                    <div><dt>Sucursal a validar</dt><dd>{today.targetBranch?.name ?? 'Sin asignación vigente'}<small>{today.scheduledShift ? ' · Asignada al turno publicado' : ' · Resuelta desde tu adscripción RH vigente'}</small></dd></div>
                                    <div><dt>Marcaje disponible</dt><dd>{nextAction ? ATTENDANCE_ACTION_LABELS[nextAction] : 'Sin acción disponible'}</dd></div>
                                    <div><dt>Validación biométrica</dt><dd>{policy.requireBiometric ? (biometricBlocked ? 'Requiere atención' : 'Lista') : 'No requerida'}</dd></div>
                                    <div><dt>Turno programado</dt><dd>{today.scheduledShift ? `${timeFormat(today.scheduledShift.startAt, { timeStyle: 'short' })}–${timeFormat(today.scheduledShift.endAt, { timeStyle: 'short' })}` : 'Sin turno publicado'}</dd></div>
                                    <div><dt>Sucursal del turno</dt><dd>{today.scheduledShift ? (today.scheduledShift.branch?.name ?? `Sucursal #${today.scheduledShift.branchId}`) : 'El servidor validará la política aplicable al intentar marcar.'}</dd></div>
                                    <div><dt>Precisión máxima</dt><dd><MapPin size={14} aria-hidden="true" /> ±{effectiveMaxAccuracyM} m</dd></div>
                                    <div><dt>Verificación facial</dt><dd>{policy.requireBiometric ? 'Requerida' : 'No requerida'}</dd></div>
                                </dl>
                            </FormSection>
                            <FormSection title="Marcajes de hoy" description={`Secuencia registrada y validada por el servidor · ${today.punches.length} evento${today.punches.length === 1 ? '' : 's'}`}>
                                {today.punches.length > 0 ? (
                                    <ol className={form.list}>
                                        {today.punches.map((punch) => (
                                            <li key={punch.id}>
                                                <span className={form.actions}><CheckCircle2 size={16} aria-hidden="true" />{ATTENDANCE_ACTION_LABELS[punch.action]}</span>
                                                <time dateTime={punch.occurredAt}>{timeFormat(punch.occurredAt, { timeStyle: 'short' })}</time>
                                            </li>
                                        ))}
                                    </ol>
                                ) : <p className={form.help}>Todavía no hay marcajes registrados hoy.</p>}
                            </FormSection>
                        </section>
                    </div>
                </>
            )}
        </PageContent>
    );
}
