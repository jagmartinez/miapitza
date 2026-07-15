import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, Fingerprint, MapPin, RefreshCw } from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import AttendancePunchWizard from '../../components/hr/AttendancePunchWizard';
import { ATTENDANCE_ACTION_LABELS } from '../../components/hr/attendanceRules';
import { attendanceClient, getAttendanceErrorMessage } from '../../components/hr/attendanceClient';
import { useAppToast } from '../../context/ToastContext';
import type { HrAttendancePolicy, HrAttendancePunchResult, HrBiometricProfile, HrTodayAttendance } from '../../types/hr-attendance';
import './attendance.css';

export default function TimeClock() {
    const navigate = useNavigate();
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

    return (
        <div className="page-wrapper hr-time-clock-page">
            <PageHeader title="Marcaje" subtitle="Asistencia con validación de horario, ubicación y evidencia" icon={Clock3} />
            {loading && <LoadingSpinner text="Preparando marcaje…" />}
            {!loading && error && <div className="state-placeholder" role="alert"><Clock3 size={44} aria-hidden="true" /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void load()}><RefreshCw size={16} /> Reintentar</Button></div>}

            {!loading && !error && policy && today && (
                <>
                    <section className="hr-today-summary" aria-labelledby="hr-today-title">
                        <div className="hr-panel-heading"><Clock3 size={22} aria-hidden="true" /><div><h2 id="hr-today-title">Hoy</h2><p>Hora del servidor: <time dateTime={today.serverTime}>{new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short', timeZone: today.timezone }).format(new Date(today.serverTime))}</time></p></div></div>
                        <div className="hr-policy-chips">
                            <span><MapPin size={15} /> Precisión máxima ±{policy.maxLocationAccuracyM} m</span>
                            <span><Fingerprint size={15} /> {policy.requireBiometric ? 'Verificación facial requerida' : 'Biometría no requerida'}</span>
                        </div>
                        {today.scheduledShift && <p>Turno esperado: <strong>{new Intl.DateTimeFormat('es-NI', { timeStyle: 'short', timeZone: today.timezone }).format(new Date(today.scheduledShift.startAt))}–{new Intl.DateTimeFormat('es-NI', { timeStyle: 'short', timeZone: today.timezone }).format(new Date(today.scheduledShift.endAt))}</strong> · {today.scheduledShift.branch?.name ?? `Sucursal #${today.scheduledShift.branchId}`}</p>}
                        {today.punches.length > 0 && <ol className="hr-today-punches">{today.punches.map((punch) => <li key={punch.id}><span>{ATTENDANCE_ACTION_LABELS[punch.action]}</span><time dateTime={punch.occurredAt}>{new Intl.DateTimeFormat('es-NI', { timeStyle: 'short', timeZone: today.timezone }).format(new Date(punch.occurredAt))}</time></li>)}</ol>}
                    </section>

                    {biometricBlocked ? (
                        <section className="hr-biometric-required" role="alert"><Fingerprint size={36} aria-hidden="true" /><h2>Enrolamiento requerido</h2><p>La política exige un perfil biométrico activo. El reconocimiento se ejecuta únicamente en el servidor y puede requerir revisión humana.</p><Button onClick={() => navigate('/rh/mi-portal/biometria')}>Gestionar biometría</Button></section>
                    ) : <AttendancePunchWizard policy={policy} today={today} onCompleted={completed} />}
                </>
            )}
        </div>
    );
}
