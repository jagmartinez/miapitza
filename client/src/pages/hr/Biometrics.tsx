import { useCallback, useEffect, useState } from 'react';
import { Fingerprint, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import CameraCapture from '../../components/hr/CameraCapture';
import { attendanceClient, getAttendanceErrorMessage } from '../../components/hr/attendanceClient';
import { isChallengeExpired } from '../../components/hr/attendanceRules';
import { useConfirmDialog } from '../../context/ConfirmContext';
import { useAppToast } from '../../context/ToastContext';
import type { HrAttendanceChallenge, HrAttendancePolicy, HrBiometricProfile } from '../../types/hr-attendance';
import './attendance.css';

export default function Biometrics() {
    const { confirm } = useConfirmDialog();
    const { success: showSuccess, error: showError } = useAppToast();
    const [profile, setProfile] = useState<HrBiometricProfile | null>(null);
    const [policy, setPolicy] = useState<HrAttendancePolicy | null>(null);
    const [challenge, setChallenge] = useState<HrAttendanceChallenge | null>(null);
    const [faceImage, setFaceImage] = useState<Blob | null>(null);
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
        setSaving(true);
        setError(null);
        setConsent(false);
        setFaceImage(null);
        try {
            setChallenge(await attendanceClient.createChallenge('BIOMETRIC_ENROLLMENT'));
        } catch (challengeError) {
            setError(getAttendanceErrorMessage(challengeError, 'No fue posible iniciar el enrolamiento.'));
        } finally {
            setSaving(false);
        }
    };

    const enroll = async () => {
        if (!challenge || !policy || !faceImage || !consent) return;
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
                faceImage,
            });
            setProfile(updated);
            setChallenge(null);
            setFaceImage(null);
            setConsent(false);
            showSuccess('Perfil biométrico enrolado.');
        } catch (enrollError) {
            showError(getAttendanceErrorMessage(enrollError, 'No fue posible completar el enrolamiento.'));
        } finally {
            setSaving(false);
        }
    };

    const revoke = async () => {
        const accepted = await confirm('Se revocará la plantilla biométrica activa. Los próximos marcajes requerirán enrolamiento nuevo o fallback supervisado.', { title: 'Revocar biometría', confirmText: 'Revocar', variant: 'warning' });
        if (!accepted) return;
        setSaving(true);
        try {
            await attendanceClient.revokeMyBiometrics();
            setChallenge(null);
            setFaceImage(null);
            setConsent(false);
            showSuccess('Perfil biométrico revocado.');
            await load();
        } catch (revokeError) {
            showError(getAttendanceErrorMessage(revokeError, 'No fue posible revocar la biometría.'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="page-wrapper hr-biometrics-page">
            <PageHeader title="Mi biometría" subtitle="Consentimiento, enrolamiento y revocación" icon={Fingerprint} />
            {loading && <LoadingSpinner text="Cargando estado biométrico…" />}
            {!loading && error && !profile && <div className="state-placeholder" role="alert"><ShieldAlert size={44} aria-hidden="true" /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void load()}><RefreshCw size={16} /> Reintentar</Button></div>}

            {!loading && profile && policy && (
                <>
                    <section className="hr-biometric-status">
                        <Fingerprint size={34} aria-hidden="true" />
                        <div><span>Estado</span><strong>{profile.status === 'ACTIVE' ? 'Activo' : profile.status === 'NOT_ENROLLED' ? 'No enrolado' : profile.status === 'REVOKED' ? 'Revocado' : 'Pendiente'}</strong>{profile.enrolledAt && <small>Enrolado: {new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(new Date(profile.enrolledAt))}</small>}{profile.retentionExpiresAt && <small>Retención hasta: {new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(new Date(profile.retentionExpiresAt))}</small>}{profile.purgeRequestedAt && <small>Eliminación externa solicitada: {new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(profile.purgeRequestedAt))}</small>}</div>
                        {profile.status === 'ACTIVE' && <Button variant="danger" onClick={() => void revoke()} disabled={saving}><Trash2 size={17} /> Revocar</Button>}
                    </section>

                    <section className="hr-biometric-notice" aria-labelledby="hr-biometric-notice-title">
                        <h2 id="hr-biometric-notice-title">Privacidad y alcance</h2>
                        <ul><li>La comparación facial es 1:1 y ocurre en el servidor; el navegador no identifica personas.</li><li>La biometría no es infalible. Un resultado incierto debe enviarse a revisión o fallback supervisado.</li><li>La captura de esta pantalla vive sólo durante el intento y no se guarda en almacenamiento local.</li></ul>
                        {policy.biometricRetentionNotice && <p>{policy.biometricRetentionNotice}</p>}
                    </section>

                    {!challenge && profile.status !== 'ACTIVE' && <Button onClick={() => void beginEnrollment()} disabled={saving}>{saving ? 'Creando reto…' : 'Iniciar enrolamiento'}</Button>}

                    {challenge && (
                        <section className="hr-enrollment-panel">
                            {(challenge.livenessInstruction ?? challenge.instruction) && (
                                <div className="hr-liveness-instruction" role="note">
                                    <strong>Prueba de vida indicada por el servidor</strong>
                                    <p>{challenge.livenessInstruction ?? challenge.instruction}</p>
                                </div>
                            )}
                            <CameraCapture onCapture={setFaceImage} resetKey={challenge.id} disabled={saving} />
                            <label className="hr-consent-check" htmlFor="hr-biometric-consent"><input id="hr-biometric-consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Otorgo consentimiento explícito para enrolar mi plantilla biométrica bajo la versión <strong>{policy.biometricConsentVersion}</strong>. He leído el propósito, la alternativa supervisada y la política de retención.</span></label>
                            {error && <div className="hr-attendance-alert danger" role="alert">{error}</div>}
                            <div className="hr-wizard-actions"><Button variant="ghost" onClick={() => { setChallenge(null); setFaceImage(null); setConsent(false); }} disabled={saving}>Cancelar</Button><Button onClick={() => void enroll()} disabled={saving || !faceImage || !consent}>{saving ? 'Enrolando en servidor…' : 'Confirmar enrolamiento'}</Button></div>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}
