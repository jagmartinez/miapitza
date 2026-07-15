import { useCallback, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock3, Coffee, LogIn, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import Button from '../Button';
import type {
    HrAttendanceAction,
    HrAttendanceChallenge,
    HrAttendancePolicy,
    HrAttendancePunchResult,
    HrCapturedLocation,
    HrTodayAttendance,
} from '../../types/hr-attendance';
import { attendanceClient, createAttendanceIdempotencyKey, getAttendanceErrorMessage } from './attendanceClient';
import { ATTENDANCE_ACTION_LABELS, ATTENDANCE_DECISION_LABELS, checkClass, isChallengeExpired } from './attendanceRules';
import CameraCapture from './CameraCapture';
import GeolocationCapture from './GeolocationCapture';

interface AttendancePunchWizardProps {
    policy: HrAttendancePolicy;
    today: HrTodayAttendance;
    onCompleted: (result: HrAttendancePunchResult) => void;
}

const ACTION_ICONS: Record<HrAttendanceAction, typeof LogIn> = {
    CHECK_IN: LogIn,
    BREAK_START: Coffee,
    BREAK_END: Clock3,
    CHECK_OUT: LogOut,
};

export default function AttendancePunchWizard({ policy, today, onCompleted }: AttendancePunchWizardProps) {
    const [action, setAction] = useState<HrAttendanceAction | null>(null);
    const [challenge, setChallenge] = useState<HrAttendanceChallenge | null>(null);
    const [faceImage, setFaceImage] = useState<Blob | null>(null);
    const [location, setLocation] = useState<HrCapturedLocation | null>(null);
    const [preparing, setPreparing] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<HrAttendancePunchResult | null>(null);
    const idempotencyKey = useRef<string | null>(null);

    const selectAction = async (selected: HrAttendanceAction) => {
        setPreparing(true);
        setError(null);
        setResult(null);
        setFaceImage(null);
        setLocation(null);
        try {
            const nextChallenge = await attendanceClient.createChallenge('ATTENDANCE_PUNCH', selected);
            idempotencyKey.current = createAttendanceIdempotencyKey();
            setAction(selected);
            setChallenge(nextChallenge);
        } catch (challengeError) {
            setError(getAttendanceErrorMessage(challengeError, 'No fue posible iniciar un reto de marcaje.'));
        } finally {
            setPreparing(false);
        }
    };

    const restart = () => {
        setAction(null);
        setChallenge(null);
        setFaceImage(null);
        setLocation(null);
        setResult(null);
        setError(null);
        idempotencyKey.current = null;
    };

    const handleFaceCapture = useCallback((image: Blob | null) => setFaceImage(image), []);
    const handleLocationCapture = useCallback((captured: HrCapturedLocation | null) => setLocation(captured), []);

    const submit = async () => {
        if (!action || !challenge || !idempotencyKey.current) return;
        if (isChallengeExpired(challenge.expiresAt)) {
            setError('El reto expiró antes del envío. Reinicia el intento para proteger la validez de la evidencia.');
            return;
        }
        if (policy.requireBiometric && !faceImage) {
            setError('Captura la evidencia facial antes de continuar.');
            return;
        }
        if (policy.requireGeolocation && !location) {
            setError('Captura la ubicación antes de continuar.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const punchResult = await attendanceClient.createPunch({
                action,
                challengeId: challenge.id,
                challengeToken: challenge.token,
                faceImage,
                location,
            }, idempotencyKey.current);
            setResult(punchResult);
            setFaceImage(null);
            onCompleted(punchResult);
        } catch (punchError) {
            setError(getAttendanceErrorMessage(punchError, 'El servidor no pudo procesar el marcaje. El mismo intento puede reintentarse sin duplicarlo.'));
        } finally {
            setSubmitting(false);
        }
    };

    if (result) {
        const checks = Object.entries(result.checks).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1]));
        return (
            <section className={`hr-punch-result ${result.decision.toLowerCase()}`} aria-live="polite">
                <CheckCircle2 size={42} aria-hidden="true" />
                <h2>{ATTENDANCE_DECISION_LABELS[result.decision]}</h2>
                <p>{result.message}</p>
                {result.reasonCode && <code>{result.reasonCode}</code>}
                {checks.length > 0 && (
                    <dl className="hr-attendance-checks">
                        {checks.map(([name, check]) => (
                            <div key={name} className={checkClass(check)}><dt>{name}</dt><dd>{check.message}</dd></div>
                        ))}
                    </dl>
                )}
                <Button type="button" variant="secondary" onClick={restart}><RefreshCw size={17} /> Nuevo intento</Button>
            </section>
        );
    }

    if (!action || !challenge) {
        return (
            <section className="hr-punch-actions" aria-labelledby="hr-punch-action-title">
                <div className="hr-panel-heading"><ShieldCheck size={22} aria-hidden="true" /><div><h2 id="hr-punch-action-title">¿Qué deseas marcar?</h2><p>La hora autoritativa y las validaciones se calculan en el servidor.</p></div></div>
                {error && <div className="hr-attendance-alert danger" role="alert">{error}</div>}
                <div className="hr-punch-action-grid">
                    {today.availableActions.map((availableAction) => {
                        const Icon = ACTION_ICONS[availableAction];
                        return <Button key={availableAction} type="button" variant="secondary" onClick={() => void selectAction(availableAction)} disabled={preparing}><Icon size={22} aria-hidden="true" /><span>{ATTENDANCE_ACTION_LABELS[availableAction]}</span></Button>;
                    })}
                </div>
                {today.availableActions.length === 0 && <p className="hr-attendance-empty">No hay una acción de marcaje disponible en este momento.</p>}
                {preparing && <p role="status">Creando reto seguro…</p>}
            </section>
        );
    }

    const livenessInstruction = challenge.livenessInstruction ?? challenge.instruction;

    return (
        <section className="hr-punch-evidence" aria-labelledby="hr-punch-evidence-title">
            <div className="hr-panel-heading"><ShieldCheck size={22} aria-hidden="true" /><div><h2 id="hr-punch-evidence-title">Evidencia para {ATTENDANCE_ACTION_LABELS[action]}</h2><p>El servidor comparará horario, sucursal, posición y verificación facial según la política.</p></div></div>
            <p className="hr-challenge-expiry">Reto válido hasta <time dateTime={challenge.expiresAt}>{new Intl.DateTimeFormat('es-NI', { timeStyle: 'medium' }).format(new Date(challenge.expiresAt))}</time>.</p>
            {policy.requireBiometric && livenessInstruction && (
                <div className="hr-liveness-instruction" role="note">
                    <strong>Prueba de vida indicada por el servidor</strong>
                    <p>{livenessInstruction}</p>
                </div>
            )}
            {policy.requireBiometric && <CameraCapture onCapture={handleFaceCapture} resetKey={challenge.id} disabled={submitting} />}
            {policy.requireGeolocation && <GeolocationCapture maxAccuracyM={policy.maxLocationAccuracyM} onCapture={handleLocationCapture} disabled={submitting} />}
            {error && <div className="hr-attendance-alert danger" role="alert">{error}</div>}
            <div className="hr-wizard-actions">
                <Button type="button" variant="ghost" onClick={restart} disabled={submitting}><ArrowLeft size={17} /> Cambiar acción</Button>
                <Button type="button" onClick={() => void submit()} disabled={submitting || (policy.requireBiometric && !faceImage) || (policy.requireGeolocation && !location)}>{submitting ? 'Validando en servidor…' : `Confirmar ${ATTENDANCE_ACTION_LABELS[action].toLowerCase()}`}</Button>
            </div>
        </section>
    );
}
