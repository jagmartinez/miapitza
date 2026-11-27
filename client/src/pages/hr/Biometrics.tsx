import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Camera,
    Check,
    CheckCircle2,
    Clock3,
    Fingerprint,
    LockKeyhole,
    MapPin,
    RefreshCw,
    RotateCcw,
    ShieldAlert,
    ShieldCheck,
    Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Checkbox, FormSection, LoadErrorState, PageContent, PageHeader, type Tone } from '@/ui';
import form from '../../components/hr/hrForm.module.css';
import HrLoading from '../../components/hr/HrLoading';
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

type BiometricStep = 'privacy' | 'capture' | 'confirm';

const formatDate = (value?: string | null): string => value
    ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(new Date(value))
    : 'No disponible';

export default function Biometrics() {
    const navigate = useNavigate();
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
            showSuccess(updated.status === 'PENDING'
                ? 'Registro facial enviado. Registro facial pendiente de aprobación de RRHH.'
                : 'Perfil biométrico enrolado.');
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
                if (profile.rejectionReason) {
                    return {
                        label: 'Rechazado',
                        title: 'RRHH rechazó tu registro facial',
                        description: `Motivo: ${profile.rejectionReason}. Repite el enrolamiento con buena luz y el rostro de frente; RRHH deberá aprobarlo de nuevo.`,
                        icon: ShieldAlert,
                    };
                }
                return {
                    label: 'Revocado',
                    title: 'El consentimiento fue revocado',
                    description: 'Esta plantilla ya no puede utilizarse. Puedes iniciar un enrolamiento nuevo si la política lo permite.',
                    icon: RotateCcw,
                };
            case 'PENDING':
                // First enrollment: HR must approve it before the employee can punch.
                return {
                    label: 'Pendiente de aprobación',
                    title: 'Registro facial pendiente de aprobación de RRHH',
                    description: 'Recursos Humanos debe aprobar tu primer registro facial. Podrás marcar asistencia en cuanto sea aprobado; no necesitas volver a capturar tu rostro.',
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

    const statusTone: Tone = profile?.status === 'ACTIVE'
        ? 'success'
        : profile?.status === 'REVOKED'
            ? 'danger'
            : 'warning';

    return (
        <PageContent>
            <PageHeader
                breadcrumb={['Mi RH']}
                title="Mi biometría"
                description="Controla tu consentimiento y completa el enrolamiento de forma segura"
                actions={<MyHrNav />}
            />
            {!online && <OnlineOnlyNotice online={false} />}

            {loading && <HrLoading text="Cargando estado biométrico…" />}
            {!loading && error && !profile && <LoadErrorState message={error} onRetry={() => void load()} />}

            {!loading && profile && policy && statusCopy && (
                <>
                    <section className={form.panel} aria-label="Estado de mi perfil">
                        <div className={form.panelHead}>
                            <div className={form.cellStack}>
                                <span className={form.actions}>
                                    <Badge tone={statusTone} dot>{statusCopy.label}</Badge>
                                    {challenge && <Badge tone="primary"><LockKeyhole size={12} aria-hidden="true" /> Reto temporal activo</Badge>}
                                </span>
                                <h2 className={form.panelTitle}>{statusCopy.title}</h2>
                                <p className={form.help}>{statusCopy.description}</p>
                            </div>
                            <div className={form.actions}>
                                <Button variant="ghost" icon={RefreshCw} onClick={() => void load()} disabled={saving} aria-label="Actualizar estado biométrico">Actualizar</Button>
                                {(profile.status === 'ACTIVE' || profile.status === 'PENDING') && (
                                    <Button variant="danger" icon={Trash2} onClick={() => void revoke()} disabled={saving || !online}>Revocar biometría</Button>
                                )}
                            </div>
                        </div>
                        <dl className={form.facts}>
                            <div><dt>Consentimiento vigente</dt><dd>Versión {profile.consentVersion ?? policy.biometricConsentVersion}</dd></div>
                            <div><dt>Enrolamiento</dt><dd>{profile.enrolledAt ? formatDate(profile.enrolledAt) : 'No completado'}</dd></div>
                            <div><dt>Retención</dt><dd>{profile.retentionExpiresAt ? `Hasta ${formatDate(profile.retentionExpiresAt)}` : `${policy.biometricRetentionDays} días según política`}</dd></div>
                        </dl>
                        {(profile.revokedAt || profile.purgeRequestedAt) && (
                            <div className={form.alertInfo} role="status">
                                <strong>Registro de revocación. </strong>
                                {profile.revokedAt ? `Revocado el ${formatDate(profile.revokedAt)}.` : 'Revocación registrada.'} {profile.purgeRequestedAt ? `Eliminación solicitada el ${formatDate(profile.purgeRequestedAt)}.` : 'La retención se procesa según la política vigente.'}
                            </div>
                        )}
                    </section>

                    <div className={form.split}>
                        <section className={form.panel} aria-label="Flujo de enrolamiento">
                            <FormSection title="Tres pasos, una decisión informada" description="La imagen capturada vive sólo durante este intento y se envía directamente al servidor.">
                                <ol className={form.steps} aria-label="Progreso del enrolamiento">
                                    {steps.map((step, index) => {
                                        const isComplete = enrollmentSubmitted || (challenge ? index < currentStepIndex : false);
                                        const isCurrent = !enrollmentSubmitted && index === currentStepIndex;
                                        return (
                                            <li key={step.id} data-state={isComplete ? 'done' : isCurrent ? 'current' : 'todo'} aria-current={isCurrent ? 'step' : undefined}>
                                                <span className={form.stepMark}>{isComplete ? <Check size={14} aria-hidden="true" /> : index + 1}</span>
                                                <span className={form.cellStack}><span className={form.cellTitle}>{step.label}</span><span className={form.cellSub}>{step.hint}</span></span>
                                            </li>
                                        );
                                    })}
                                </ol>
                            </FormSection>

                            {!challenge && (
                                <div className={form.stack}>
                                    <h3 className={form.panelTitle}>{profile.status === 'ACTIVE'
                                        ? 'Tu enrolamiento está completo'
                                        : profile.status === 'PENDING'
                                            ? 'Registro facial pendiente de aprobación de RRHH'
                                            : 'Cuando estés listo, crea un reto seguro'}</h3>
                                    <p className={form.help}>{profile.status === 'ACTIVE'
                                        ? 'No necesitas repetirlo. Puedes revocar el consentimiento desde el estado superior.'
                                        : profile.status === 'PENDING'
                                            ? 'Tu captura ya fue enviada. Te avisaremos aquí cuando RRHH la apruebe; mientras tanto no podrás marcar con reconocimiento facial.'
                                            : 'El reto dura pocos minutos y no almacena evidencia en este dispositivo.'}</p>
                                    <div className={form.actions}>
                                        {profile.status !== 'ACTIVE' && profile.status !== 'PENDING' && (
                                            <Button variant="primary" icon={Fingerprint} loading={saving} onClick={() => void beginEnrollment()} disabled={!online || profile.canEnroll === false}>
                                                Iniciar enrolamiento
                                            </Button>
                                        )}
                                        {profile.status === 'ACTIVE' && (
                                            <Button variant="primary" icon={MapPin} onClick={() => navigate('/rh/marcaje')} disabled={!online || saving}>
                                                Ir a marcar ahora
                                            </Button>
                                        )}
                                    </div>
                                    {profile.canEnroll === false && profile.status !== 'ACTIVE' && (
                                        <p className={form.alertWarning} role="status">El servidor no permite un nuevo enrolamiento en este momento. Solicita apoyo a Recursos Humanos.</p>
                                    )}
                                </div>
                            )}

                            {challenge && (
                                <div className={form.stack}>
                                    {(challenge.livenessInstruction ?? challenge.instruction) && (
                                        <div className={form.alertInfo} role="note">
                                            <strong>Prueba de vida indicada por el servidor: </strong>{challenge.livenessInstruction ?? challenge.instruction}
                                        </div>
                                    )}
                                    <CameraCapture
                                        onCapture={setFaceEvidence}
                                        resetKey={challenge.id}
                                        disabled={saving}
                                        instruction={challenge.livenessInstruction ?? challenge.instruction}
                                        livenessAction={challenge.livenessAction}
                                        frameCount={challenge.captureFrameCount}
                                        intervalMs={challenge.captureIntervalMs}
                                    />
                                    <Checkbox
                                        id="hr-biometric-consent"
                                        checked={consent}
                                        onChange={(event) => setConsent(event.target.checked)}
                                        label={<span>Otorgo consentimiento explícito para enrolar mi plantilla biométrica bajo la versión <strong>{policy.biometricConsentVersion}</strong>. He leído el propósito, la alternativa supervisada y la política de retención.</span>}
                                    />
                                    {error && <div className={form.alertDanger} role="alert">{error}</div>}
                                    <div className={form.actionsEnd}>
                                        <Button variant="ghost" onClick={cancelEnrollment} disabled={saving}>Cancelar</Button>
                                        {error?.includes('expiró') ? (
                                            <Button variant="primary" icon={RefreshCw} onClick={() => void beginEnrollment()} disabled={!online || saving}>Crear reto nuevo</Button>
                                        ) : (
                                            <Button variant="primary" icon={ShieldCheck} loading={saving} onClick={() => void enroll()} disabled={!online || saving || !faceEvidence || !consent}>
                                                Confirmar enrolamiento
                                            </Button>
                                        )}
                                    </div>
                                    <p className={form.help}><Clock3 size={14} aria-hidden="true" /> Reto válido hasta {new Intl.DateTimeFormat('es-NI', { timeStyle: 'short' }).format(new Date(challenge.expiresAt))}.</p>
                                </div>
                            )}
                        </section>

                        <section className={form.panel} aria-label="Control y privacidad">
                            <FormSection title="Tus datos no son una contraseña más" description="Control y privacidad">
                                <ul className={form.list}>
                                    <li><span className={form.actions}><CheckCircle2 size={16} aria-hidden="true" />La comparación facial es 1:1 y ocurre en el servidor; el navegador no identifica personas.</span></li>
                                    <li><span className={form.actions}><CheckCircle2 size={16} aria-hidden="true" />Un resultado incierto debe enviarse a revisión o a un fallback supervisado.</span></li>
                                    <li><span className={form.actions}><CheckCircle2 size={16} aria-hidden="true" />La captura no se guarda en el almacenamiento local de este dispositivo.</span></li>
                                </ul>
                                {policy.biometricRetentionNotice && (
                                    <div className={form.cellStack}><span className={form.cellTitle}>Política de retención</span><p className={form.help}>{policy.biometricRetentionNotice}</p></div>
                                )}
                                <p className={form.help}>Si decides no enrolarte o revocas tu consentimiento, Recursos Humanos puede orientarte sobre la alternativa supervisada disponible.</p>
                            </FormSection>
                        </section>
                    </div>

                    {error && !challenge && (
                        <div className={`${form.alertDanger} ${form.actions}`} role="alert" aria-live="assertive">
                            <span>{error}</span>
                            {profile.status !== 'ACTIVE' && profile.canEnroll !== false && <Button variant="ghost" onClick={() => void beginEnrollment()} disabled={!online}>Reintentar</Button>}
                        </div>
                    )}
                </>
            )}
        </PageContent>
    );
}
