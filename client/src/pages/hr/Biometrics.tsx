import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    Camera,
    Check,
    CheckCircle2,
    Clock3,
    Fingerprint,
    Info,
    LockKeyhole,
    RefreshCw,
    RotateCcw,
    ShieldAlert,
    ShieldCheck,
    Trash2,
} from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import MyHrNav from '../../components/hr/MyHrNav';
import OnlineOnlyNotice from '../../components/hr/OnlineOnlyNotice';
import useWorkforceOnline from '../../components/hr/useWorkforceOnline';
import CameraCapture from '../../components/hr/CameraCapture';
import { attendanceClient, getAttendanceErrorMessage } from '../../components/hr/attendanceClient';
import { isChallengeExpired } from '../../components/hr/attendanceRules';
import { useConfirmDialog } from '../../context/ConfirmContext';
import { useAppToast } from '../../context/ToastContext';
import type { HrAttendanceChallenge, HrAttendancePolicy, HrBiometricProfile, HrFaceCaptureEvidence } from '../../types/hr-attendance';
import './attendance.css';
import './Biometrics.css';
import './self-service.css';

type BiometricStep = 'privacy' | 'capture' | 'confirm';

const formatDate = (value?: string | null): string => value
    ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(new Date(value))
    : 'No disponible';

export default function Biometrics() {
    const online = useWorkforceOnline();
    const { confirm } = useConfirmDialog();
    const { success: showSuccess, error: showError } = useAppToast();
    const [profile, setProfile] = useState<HrBiometricProfile | null>(null);
    const [policy, setPolicy] = useState<HrAttendancePolicy | null>(null);
    const [challenge, setChallenge] = useState<HrAttendanceChallenge | null>(null);
    const [faceEvidence, setFaceEvidence] = useState<HrFaceCaptureEvidence | null>(null);
    const [consent, setConsent] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [profileResult, policyResult] = await Promise.all([
                attendanceClient.getMyBiometrics(),
                attendanceClient.getPolicy(),
            ]);
            setProfile(profileResult);
            setPolicy(policyResult);
        } catch (loadError) {
            setError(getAttendanceErrorMessage(loadError, 'No fue posible cargar el estado biométrico.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const beginEnrollment = async () => {
        if (!online) {
            showError('Conéctate para iniciar el enrolamiento biométrico.');
            return;
        }
        setSaving(true);
        setError(null);
        setConsent(false);
        setFaceEvidence(null);
        try {
            setChallenge(await attendanceClient.createChallenge('BIOMETRIC_ENROLLMENT'));
        } catch (challengeError) {
            setError(getAttendanceErrorMessage(challengeError, 'No fue posible iniciar el enrolamiento.'));
        } finally {
            setSaving(false);
        }
    };

    const cancelEnrollment = () => {
        setChallenge(null);
        setFaceEvidence(null);
        setConsent(false);
        setError(null);
    };

    const enroll = async () => {
        if (!online) {
            showError('Conéctate para enviar el enrolamiento biométrico.');
            return;
        }
        if (!challenge || !policy || !faceEvidence || !consent) return;
        if (isChallengeExpired(challenge.expiresAt)) {
            setError('El reto de enrolamiento expiró. Inicia uno nuevo.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const updated = await attendanceClient.enrollBiometrics({
                challengeId: challenge.id,
                challengeToken: challenge.token,
                consentAccepted: true,
                consentVersion: policy.biometricConsentVersion,
                faceEvidence,
            });
            setProfile(updated);
            setChallenge(null);
            setFaceEvidence(null);
            setConsent(false);
            showSuccess('Perfil biométrico enrolado.');
        } catch (enrollError) {
            const message = getAttendanceErrorMessage(enrollError, 'No fue posible completar el enrolamiento.');
            // The server consumes a challenge before evaluating biometric evidence.
            // Every failed submission therefore needs a fresh challenge; keeping the
            // old button active would only produce a CHALLENGE_REPLAY on the next click.
            setChallenge(null);
            setFaceEvidence(null);
            setConsent(false);
            setError(message);
            showError(message);
        } finally {
            setSaving(false);
        }
    };

    const revoke = async () => {
        if (!online) {
            showError('Conéctate para revocar el consentimiento biométrico.');
            return;
        }
        const accepted = await confirm(
            'Se revocará la plantilla biométrica activa. Los próximos marcajes requerirán enrolamiento nuevo o fallback supervisado.',
            { title: 'Revocar biometría', confirmText: 'Revocar', variant: 'warning' },
        );
        if (!accepted) return;
        setSaving(true);
        setError(null);
        try {
            await attendanceClient.revokeMyBiometrics();
            setChallenge(null);
            setFaceEvidence(null);
            setConsent(false);
            showSuccess('Perfil biométrico revocado.');
            await load();
        } catch (revokeError) {
            const message = getAttendanceErrorMessage(revokeError, 'No fue posible revocar la biometría.');
            setError(message);
            showError(message);
        } finally {
            setSaving(false);
        }
    };

    const statusCopy = useMemo(() => {
        if (!profile) return null;
        switch (profile.status) {
            case 'ACTIVE':
                return {
                    label: 'Activo',
                    title: 'Tu biometría está lista para el marcaje',
                    description: 'La verificación facial 1:1 está disponible cuando la política de asistencia la solicite.',
                    icon: CheckCircle2,
                };
            case 'REVOKED':
                return {
                    label: 'Revocado',
                    title: 'El consentimiento fue revocado',
                    description: 'Esta plantilla ya no puede utilizarse. Puedes iniciar un enrolamiento nuevo si la política lo permite.',
                    icon: RotateCcw,
                };
            case 'PENDING':
                return {
                    label: 'En revisión',
                    title: 'Tu enrolamiento está pendiente de revisión',
                    description: 'No necesitas volver a capturar una imagen mientras el servidor procesa o revisa el estado.',
                    icon: Clock3,
                };
            default:
                return {
                    label: 'Pendiente',
                    title: 'Aún no tienes biometría enrolada',
                    description: 'Completa el flujo guiado para habilitar marcajes que requieran verificación facial.',
                    icon: Fingerprint,
                };
        }
    }, [profile]);

    const currentStep: BiometricStep = !challenge ? 'privacy' : !faceEvidence ? 'capture' : 'confirm';
    const steps: Array<{ id: BiometricStep; label: string; hint: string; icon: typeof ShieldCheck }> = [
        { id: 'privacy', label: 'Privacidad', hint: 'Conoce el uso y la retención', icon: ShieldCheck },
        { id: 'capture', label: 'Captura segura', hint: 'Sigue la prueba de vida', icon: Camera },
        { id: 'confirm', label: 'Consentimiento', hint: 'Autoriza y envía al servidor', icon: Check },
    ];
    const currentStepIndex = steps.findIndex((step) => step.id === currentStep);
    const enrollmentSubmitted = profile?.status === 'ACTIVE' || profile?.status === 'PENDING';

    return (
        <div className="page-wrapper hr-biometrics-page my-hr-page">
            <PageHeader className="my-hr-page-header" title="Mi biometría" subtitle="Controla tu consentimiento y completa el enrolamiento de forma segura" icon={Fingerprint} actions={<MyHrNav />} />
            {!online && <OnlineOnlyNotice online={false} />}

            {loading && <LoadingSpinner text="Cargando estado biométrico…" />}
            {!loading && error && !profile && (
                <div className="state-placeholder hr-biometric-load-error" role="alert">
                    <ShieldAlert size={44} aria-hidden="true" />
                    <h2>No pudimos abrir tu biometría</h2>
                    <p className="state-error">{error}</p>
                    <Button variant="ghost" onClick={() => void load()}><RefreshCw size={16} /> Reintentar</Button>
                </div>
            )}

            {!loading && profile && policy && statusCopy && (
                <div className="hr-biometric-workspace">
                    <section className={`hr-biometric-hero status-${profile.status.toLowerCase()}`} aria-labelledby="hr-biometric-status-title">
                        <div className="hr-biometric-hero__identity">
                            <span className="hr-biometric-hero__icon" aria-hidden="true"><statusCopy.icon size={30} /></span>
                            <div>
                                <span className="hr-biometric-eyebrow">Estado de mi perfil</span>
                                <div className="hr-biometric-title-row">
                                    <h2 id="hr-biometric-status-title">{statusCopy.title}</h2>
                                    <span className="hr-biometric-status-pill">{statusCopy.label}</span>
                                </div>
                                <p>{statusCopy.description}</p>
                            </div>
                        </div>
                        <div className="hr-biometric-hero__actions">
                            <Button variant="ghost" onClick={() => void load()} disabled={saving} aria-label="Actualizar estado biométrico">
                                <RefreshCw size={16} /> Actualizar
                            </Button>
                            {profile.status === 'ACTIVE' && (
                                <Button variant="danger" onClick={() => void revoke()} disabled={saving || !online}>
                                    <Trash2 size={17} /> Revocar biometría
                                </Button>
                            )}
                        </div>
                    </section>

                    <section className="hr-biometric-facts" aria-label="Resumen de privacidad biométrica">
                        <div><ShieldCheck size={19} aria-hidden="true" /><span>Consentimiento vigente</span><strong>Versión {profile.consentVersion ?? policy.biometricConsentVersion}</strong></div>
                        <div><CheckCircle2 size={19} aria-hidden="true" /><span>Enrolamiento</span><strong>{profile.enrolledAt ? formatDate(profile.enrolledAt) : 'No completado'}</strong></div>
                        <div><Clock3 size={19} aria-hidden="true" /><span>Retención</span><strong>{profile.retentionExpiresAt ? `Hasta ${formatDate(profile.retentionExpiresAt)}` : `${policy.biometricRetentionDays} días según política`}</strong></div>
                    </section>

                    {(profile.revokedAt || profile.purgeRequestedAt) && (
                        <div className="hr-biometric-revocation-note" role="status">
                            <Info size={19} aria-hidden="true" />
                            <div>
                                <strong>Registro de revocación</strong>
                                <span>{profile.revokedAt ? `Revocado el ${formatDate(profile.revokedAt)}.` : 'Revocación registrada.'} {profile.purgeRequestedAt ? `Eliminación solicitada el ${formatDate(profile.purgeRequestedAt)}.` : 'La retención se procesa según la política vigente.'}</span>
                            </div>
                        </div>
                    )}

                    <div className="hr-biometric-main-grid">
                        <section className="hr-biometric-flow" aria-labelledby="hr-biometric-flow-title">
                            <div className="hr-biometric-section-heading">
                                <div>
                                    <span className="hr-biometric-eyebrow">Flujo de enrolamiento</span>
                                    <h2 id="hr-biometric-flow-title">Tres pasos, una decisión informada</h2>
                                    <p>La imagen capturada vive sólo durante este intento y se envía directamente al servidor.</p>
                                </div>
                                {challenge && <span className="hr-biometric-challenge-badge"><LockKeyhole size={14} /> Reto temporal activo</span>}
                            </div>

                            <ol className="hr-biometric-steps" aria-label="Progreso del enrolamiento">
                                {steps.map((step, index) => {
                                    const isComplete = enrollmentSubmitted || (challenge ? index < currentStepIndex : false);
                                    const isCurrent = !enrollmentSubmitted && index === currentStepIndex;
                                    return (
                                        <li key={step.id} className={`${isCurrent ? 'current' : ''} ${isComplete ? 'complete' : ''}`} aria-current={isCurrent ? 'step' : undefined}>
                                            <span className="hr-biometric-step-number">{isComplete ? <Check size={15} /> : index + 1}</span>
                                            <step.icon size={18} aria-hidden="true" />
                                            <div><strong>{step.label}</strong><small>{step.hint}</small></div>
                                        </li>
                                    );
                                })}
                            </ol>

                            {!challenge && (
                                <div className="hr-biometric-start-panel">
                                    <div>
                                        <h3>{profile.status === 'ACTIVE' ? 'Tu enrolamiento está completo' : 'Cuando estés listo, crea un reto seguro'}</h3>
                                        <p>{profile.status === 'ACTIVE' ? 'No necesitas repetirlo. Puedes revocar el consentimiento desde el estado superior.' : 'El reto dura pocos minutos y no almacena evidencia en este dispositivo.'}</p>
                                    </div>
                                    {profile.status !== 'ACTIVE' && profile.status !== 'PENDING' && (
                                        <Button onClick={() => void beginEnrollment()} disabled={!online || saving || profile.canEnroll === false}>
                                            <Fingerprint size={17} /> {saving ? 'Creando reto…' : 'Iniciar enrolamiento'}
                                        </Button>
                                    )}
                                    {profile.canEnroll === false && profile.status !== 'ACTIVE' && (
                                        <p className="hr-biometric-unavailable" role="status"><AlertTriangle size={16} /> El servidor no permite un nuevo enrolamiento en este momento. Solicita apoyo a Recursos Humanos.</p>
                                    )}
                                </div>
                            )}

                            {challenge && (
                                <div className="hr-biometric-capture-panel">
                                    {(challenge.livenessInstruction ?? challenge.instruction) && (
                                        <div className="hr-biometric-liveness" role="note">
                                            <Camera size={19} aria-hidden="true" />
                                            <div><strong>Prueba de vida indicada por el servidor</strong><p>{challenge.livenessInstruction ?? challenge.instruction}</p></div>
                                        </div>
                                    )}
                                    <CameraCapture
                                        onCapture={setFaceEvidence}
                                        resetKey={challenge.id}
                                        disabled={saving}
                                        instruction={challenge.livenessInstruction ?? challenge.instruction}
                                        frameCount={challenge.captureFrameCount}
                                        intervalMs={challenge.captureIntervalMs}
                                    />
                                    <label className={`hr-biometric-consent ${consent ? 'checked' : ''}`} htmlFor="hr-biometric-consent">
                                        <input id="hr-biometric-consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                                        <span aria-hidden="true"><Check size={15} /></span>
                                        <span>Otorgo consentimiento explícito para enrolar mi plantilla biométrica bajo la versión <strong>{policy.biometricConsentVersion}</strong>. He leído el propósito, la alternativa supervisada y la política de retención.</span>
                                    </label>
                                    {error && <div className="hr-biometric-inline-error" role="alert"><ShieldAlert size={18} aria-hidden="true" /><span>{error}</span></div>}
                                    <div className="hr-biometric-actions">
                                        <Button variant="ghost" onClick={cancelEnrollment} disabled={saving}>Cancelar</Button>
                                        {error?.includes('expiró') ? (
                                            <Button onClick={() => void beginEnrollment()} disabled={!online || saving}><RefreshCw size={16} /> Crear reto nuevo</Button>
                                        ) : (
                                            <Button onClick={() => void enroll()} disabled={!online || saving || !faceEvidence || !consent}>
                                                <ShieldCheck size={17} /> {saving ? 'Enrolando en servidor…' : 'Confirmar enrolamiento'}
                                            </Button>
                                        )}
                                    </div>
                                    <p className="hr-biometric-expiry"><Clock3 size={15} /> Reto válido hasta {new Intl.DateTimeFormat('es-NI', { timeStyle: 'short' }).format(new Date(challenge.expiresAt))}.</p>
                                </div>
                            )}
                        </section>

                        <aside className="hr-biometric-privacy" aria-labelledby="hr-biometric-privacy-title">
                            <span className="hr-biometric-privacy__icon" aria-hidden="true"><LockKeyhole size={23} /></span>
                            <span className="hr-biometric-eyebrow">Control y privacidad</span>
                            <h2 id="hr-biometric-privacy-title">Tus datos no son una contraseña más</h2>
                            <ul>
                                <li><CheckCircle2 size={17} /><span>La comparación facial es 1:1 y ocurre en el servidor; el navegador no identifica personas.</span></li>
                                <li><CheckCircle2 size={17} /><span>Un resultado incierto debe enviarse a revisión o a un fallback supervisado.</span></li>
                                <li><CheckCircle2 size={17} /><span>La captura no se guarda en el almacenamiento local de este dispositivo.</span></li>
                            </ul>
                            {policy.biometricRetentionNotice && <div className="hr-biometric-policy-note"><strong>Política de retención</strong><p>{policy.biometricRetentionNotice}</p></div>}
                            <div className="hr-biometric-alternative"><Info size={17} /><span>Si decides no enrolarte o revocas tu consentimiento, Recursos Humanos puede orientarte sobre la alternativa supervisada disponible.</span></div>
                        </aside>
                    </div>

                    {error && !challenge && (
                        <div className="hr-biometric-inline-error" role="alert" aria-live="assertive">
                            <ShieldAlert size={18} aria-hidden="true" /><span>{error}</span>
                            {profile.status !== 'ACTIVE' && profile.canEnroll !== false && <Button size="sm" variant="ghost" onClick={() => void beginEnrollment()} disabled={!online}>Reintentar</Button>}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
