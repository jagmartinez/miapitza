import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Coffee, Fingerprint, LogIn, LogOut, MapPin, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import Button from '../Button';
import type {
    HrAttendanceAction,
    HrAttendanceChallenge,
    HrAttendancePolicy,
    HrAttendancePunchResult,
    HrCapturedLocation,
    HrFaceCaptureEvidence,
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
    onRequestCorrection?: () => void;
}

const ACTION_ICONS: Record<HrAttendanceAction, typeof LogIn> = {
    CHECK_IN: LogIn,
    BREAK_START: Coffee,
    BREAK_END: Clock3,
    CHECK_OUT: LogOut,
};

const ACTION_HELP: Record<HrAttendanceAction, string> = {
    CHECK_IN: 'Abre tu jornada laboral.',
    BREAK_START: 'Inicia el descanso de tu jornada abierta.',
    BREAK_END: 'Finaliza el descanso que está en curso.',
    CHECK_OUT: 'Cierra la jornada que ya está abierta.',
};

const CHECK_LABELS: Record<string, string> = {
    schedule: 'Horario',
    geofence: 'Geocerca de la sucursal',
    locationAccuracy: 'Precisión de ubicación',
    locationFreshness: 'Vigencia de ubicación',
    biometric: 'Reconocimiento facial',
    sequence: 'Secuencia del marcaje',
    device: 'Dispositivo',
    branchAuthorization: 'Sucursal asignada',
    branchStatus: 'Estado de la sucursal',
};

export default function AttendancePunchWizard({ policy, today, onCompleted, onRequestCorrection }: AttendancePunchWizardProps) {
    const [action, setAction] = useState<HrAttendanceAction | null>(null);
    const [challenge, setChallenge] = useState<HrAttendanceChallenge | null>(null);
    const [faceEvidence, setFaceEvidence] = useState<HrFaceCaptureEvidence | null>(null);
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
        setFaceEvidence(null);
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
        setFaceEvidence(null);
        setLocation(null);
        setResult(null);
        setError(null);
        idempotencyKey.current = null;
    };

    const handleFaceCapture = useCallback((evidence: HrFaceCaptureEvidence | null) => setFaceEvidence(evidence), []);
    const handleLocationCapture = useCallback((captured: HrCapturedLocation | null) => setLocation(captured), []);

    const submit = async () => {
        if (!action || !challenge || !idempotencyKey.current) return;
        if (isChallengeExpired(challenge.expiresAt)) {
            setError('El reto expiró antes del envío. Reinicia el intento para proteger la validez de la evidencia.');
            return;
        }
        if (policy.requireBiometric && !faceEvidence) {
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
                faceEvidence,
                location,
            }, idempotencyKey.current);
            setResult(punchResult);
            setFaceEvidence(null);
            onCompleted(punchResult);
        } catch (punchError) {
            setError(getAttendanceErrorMessage(punchError, 'El servidor no pudo procesar el marcaje. El mismo intento puede reintentarse sin duplicarlo.'));
        } finally {
            setSubmitting(false);
        }
    };

    if (result) {
        const checks = Object.entries(result.checks).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1]));
        const ResultIcon = result.decision === 'ACCEPTED'
            ? CheckCircle2
            : result.decision === 'REVIEW_REQUIRED'
                ? AlertTriangle
                : XCircle;
        return (
            <section className={`hr-punch-result ${result.decision.toLowerCase()}`} aria-live="polite">
                <ResultIcon size={42} aria-hidden="true" />
                <h2>{ATTENDANCE_DECISION_LABELS[result.decision]}</h2>
                <p>{result.message}</p>
                {result.reasonCode && <small>Referencia: <code>{result.reasonCode}</code></small>}
                {checks.length > 0 && (
                    <dl className="hr-attendance-checks">
                        {checks.map(([name, check]) => (
                            <div key={name} className={checkClass(check)}><dt>{CHECK_LABELS[name] ?? name}</dt><dd>{check.message}</dd></div>
                        ))}
                    </dl>
                )}
                <Button type="button" variant="secondary" onClick={restart}><RefreshCw size={17} /> {result.decision === 'ACCEPTED' ? 'Volver al marcaje' : 'Corregir e intentar de nuevo'}</Button>
            </section>
        );
    }

    if (!action || !challenge) {
        return (
            <section className="hr-punch-actions" aria-labelledby="hr-punch-action-title">
                <div className="hr-panel-heading"><ShieldCheck size={22} aria-hidden="true" /><div><span className="hr-section-kicker">PASO 1 DE 3</span><h2 id="hr-punch-action-title">Confirma qué vas a marcar</h2><p>El servidor habilita únicamente las acciones válidas para tu jornada.</p></div></div>
                {error && <div className="hr-attendance-alert danger" role="alert">{error}</div>}
                {today.availableActions.length > 0 && (
                    <div className="hr-punch-action-grid">
                        {today.availableActions.map((availableAction) => {
                        const Icon = ACTION_ICONS[availableAction];
                        return (
                            <Button
                                key={availableAction}
                                type="button"
                                variant={today.availableActions.length === 1 ? 'primary' : 'secondary'}
                                className={`hr-punch-action hr-punch-action--${availableAction.toLowerCase()}`}
                                onClick={() => void selectAction(availableAction)}
                                disabled={preparing}
                                aria-label={`Marcar ${ATTENDANCE_ACTION_LABELS[availableAction].toLowerCase()}. ${ACTION_HELP[availableAction]}`}
                            >
                                <Icon size={24} aria-hidden="true" />
                                <span><strong>Marcar {ATTENDANCE_ACTION_LABELS[availableAction].toLowerCase()}</strong><small>{ACTION_HELP[availableAction]}</small></span>
                            </Button>
                        );
                        })}
                    </div>
                )}
                {today.availableActions.length === 0 && (
                    <div className={`hr-attendance-blocking ${today.blockingIssue ? 'danger' : ''}`} role={today.blockingIssue ? 'alert' : 'status'}>
                        <Clock3 size={22} aria-hidden="true" />
                        <div>
                            <strong>{today.blockingIssue ? 'Debes resolver un marcaje anterior' : 'No hay un marcaje disponible'}</strong>
                            <p>{today.blockingIssue?.message ?? 'El servidor no habilita una entrada o salida para el estado actual de tu jornada.'}</p>
                            {today.blockingIssue?.occurredAt && (
                                <small>
                                    Entrada pendiente: <time dateTime={today.blockingIssue.occurredAt}>{new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short', timeZone: today.timezone }).format(new Date(today.blockingIssue.occurredAt))}</time>
                                    {today.blockingIssue.branch?.name ? ` · ${today.blockingIssue.branch.name}` : ''}
                                </small>
                            )}
                            {today.blockingIssue && <small>No se creó una salida automática ni se abrió una jornada nueva.</small>}
                            {today.blockingIssue && onRequestCorrection && <Button type="button" variant="secondary" size="sm" onClick={onRequestCorrection}>Solicitar corrección</Button>}
                        </div>
                    </div>
                )}
                {preparing && <p role="status">Creando reto seguro…</p>}
            </section>
        );
    }

    const livenessInstruction = challenge.livenessInstruction ?? challenge.instruction;
    const branchName = today.targetBranch?.name ?? 'Sin adscripción RH vigente';
    const biometricReady = !policy.requireBiometric || Boolean(faceEvidence);
    const locationReady = !policy.requireGeolocation || Boolean(location);
    const biometricStatus = policy.requireBiometric ? (faceEvidence ? 'Capturado' : 'Pendiente') : 'No requerido';
    const locationStatus = policy.requireGeolocation ? (location ? 'Capturada; geocerca pendiente' : 'Pendiente') : 'No requerida';
    const ActionIcon = ACTION_ICONS[action];

    return (
        <section className="hr-punch-evidence" aria-labelledby="hr-punch-evidence-title">
            <div className={`hr-punch-action-banner hr-punch-action-banner--${action.toLowerCase()}`}>
                <ActionIcon size={25} aria-hidden="true" />
                <div><span>ESTÁS MARCANDO</span><strong>{ATTENDANCE_ACTION_LABELS[action]}</strong><small>{ACTION_HELP[action]}</small></div>
            </div>
            <div className="hr-panel-heading"><ShieldCheck size={22} aria-hidden="true" /><div><span className="hr-section-kicker">PASO 2 DE 3</span><h2 id="hr-punch-evidence-title">Valida rostro y ubicación</h2><p>Ambas evidencias se comprueban en el servidor al confirmar.</p></div></div>
            <div className="hr-punch-context" role="note">
                <div><MapPin size={18} aria-hidden="true" /><span>Sucursal a validar</span><strong>{branchName}</strong></div>
                <div><Fingerprint size={18} aria-hidden="true" /><span>Rostro</span><strong>{biometricStatus}</strong></div>
                <div><MapPin size={18} aria-hidden="true" /><span>Ubicación</span><strong>{locationStatus}</strong></div>
            </div>
            <p className="hr-challenge-expiry">Reto válido hasta <time dateTime={challenge.expiresAt}>{new Intl.DateTimeFormat('es-NI', { timeStyle: 'medium' }).format(new Date(challenge.expiresAt))}</time>.</p>
            {policy.requireBiometric && livenessInstruction && (
                <div className="hr-liveness-instruction" role="note">
                    <strong>Prueba de vida indicada por el servidor</strong>
                    <p>{livenessInstruction}</p>
                </div>
            )}
            {policy.requireBiometric && (
                <CameraCapture
                    onCapture={handleFaceCapture}
                    resetKey={challenge.id}
                    disabled={submitting}
                    instruction={livenessInstruction}
                    livenessAction={challenge.livenessAction}
                    frameCount={challenge.captureFrameCount}
                    intervalMs={challenge.captureIntervalMs}
                />
            )}
            {policy.requireGeolocation && <GeolocationCapture maxAccuracyM={policy.maxLocationAccuracyM} onCapture={handleLocationCapture} disabled={submitting} />}
            {error && <div className="hr-attendance-alert danger" role="alert">{error}</div>}
            <div className="hr-confirmation-summary" role="status" aria-live="polite">
                <span className={biometricReady ? 'complete' : ''}><Fingerprint size={17} aria-hidden="true" /> Rostro {policy.requireBiometric ? (biometricReady ? 'listo' : 'pendiente') : 'no requerido'}</span>
                <span className={locationReady ? 'complete' : ''}><MapPin size={17} aria-hidden="true" /> Ubicación {policy.requireGeolocation ? (locationReady ? 'lista' : 'pendiente') : 'no requerida'}</span>
            </div>
            <div className="hr-wizard-actions">
                <Button type="button" variant="ghost" onClick={restart} disabled={submitting}>Cancelar intento</Button>
                <Button type="button" onClick={() => void submit()} disabled={submitting || !biometricReady || !locationReady}>{submitting ? 'Validando rostro y ubicación…' : `Confirmar ${ATTENDANCE_ACTION_LABELS[action].toLowerCase()}`}</Button>
            </div>
        </section>
    );
}
