import { useRef, useState } from 'react';
import type { HrAttendanceChallenge, HrAttendancePolicy, HrBiometricProfile } from '@web/types/hr-attendance';
import { isChallengeExpired } from '@web/components/hr/attendanceRules';
import { HrError, type HrApi } from '../hrApi';
import { useFaceCapture } from './useFaceCapture';
import { appendFrames, CameraView, failureMessage, MSG, newActionId } from './captureCommon';

interface Pending {
    form: FormData;
    challenge: HrAttendanceChallenge;
    actionId: string;
}

type View =
    | { k: 'consent' }
    | { k: 'capturing'; instruction?: string }
    | { k: 'sending' }
    | { k: 'done'; profile: HrBiometricProfile }
    | { k: 'error'; msg: string; resend: boolean };

/** Face enrollment with consent. `onDone` receives the resulting profile. */
export function EnrollScreen({ hr, policy, onDone }: { hr: HrApi; policy: HrAttendancePolicy; onDone: (profile: HrBiometricProfile) => void }) {
    const face = useFaceCapture();
    const [accepted, setAccepted] = useState(false);
    const [view, setView] = useState<View>({ k: 'consent' });
    const pending = useRef<Pending | null>(null);

    const submit = async (p: Pending) => {
        setView({ k: 'sending' });
        try {
            const profile = await hr.enroll(p.form, { actionId: p.actionId });
            pending.current = null;
            setView({ k: 'done', profile });
        } catch (e) {
            const ambiguous = e instanceof HrError && e.isAmbiguous && e.code !== 'FACE_PROVIDER_UNAVAILABLE';
            if (!ambiguous) pending.current = null;
            setView({ k: 'error', msg: ambiguous ? MSG.unconfirmed : failureMessage(e), resend: ambiguous });
        }
    };

    const run = async () => {
        pending.current = null;
        try {
            const challenge = await hr.createChallenge('BIOMETRIC_ENROLLMENT');
            setView({ k: 'capturing', instruction: challenge.livenessInstruction ?? challenge.instruction });
            await face.start();
            const frames = await face.captureFrames(challenge.captureFrameCount, challenge.captureIntervalMs);
            face.stop();
            const form = new FormData();
            form.append('challengeId', challenge.id);
            if (challenge.token) form.append('challengeToken', challenge.token);
            form.append('consentAccepted', 'true');
            form.append('consentVersion', policy.biometricConsentVersion);
            appendFrames(form, frames, 'face-enrollment');
            const p = { form, challenge, actionId: newActionId() };
            pending.current = p;
            await submit(p);
        } catch (e) {
            face.stop();
            setView({ k: 'error', msg: failureMessage(e), resend: false });
        }
    };

    const retry = () => {
        const p = pending.current;
        if (p && !isChallengeExpired(p.challenge.expiresAt)) void submit(p);
        else void run();
    };

    const busy = view.k === 'capturing' || view.k === 'sending';
    return (
        <div className="att-screen">
            <CameraView videoRef={face.videoRef} visible={view.k === 'capturing'} instruction={view.k === 'capturing' ? view.instruction : undefined} />
            {view.k === 'consent' && (
                <>
                    <h2>Registro facial</h2>
                    <p className="att-notice">{policy.biometricRetentionNotice || 'Tu rostro se usará solo para verificar tu identidad al marcar asistencia.'}</p>
                    <label className="att-consent">
                        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                        <span>Acepto</span>
                    </label>
                    <button type="button" className="btn btn-primary" disabled={!accepted || busy} onClick={() => void run()}>
                        Registrar mi rostro
                    </button>
                </>
            )}
            {view.k === 'sending' && <p className="muted">Enviando…</p>}
            {view.k === 'done' && (
                <>
                    <div className="att-result" data-tone="ok">
                        <h2>{view.profile.status === 'PENDING' ? 'Enviado. RH debe aprobar tu registro antes de marcar.' : 'Registro facial listo. Ya puedes marcar.'}</h2>
                    </div>
                    <button type="button" className="btn btn-primary" onClick={() => onDone(view.profile)}>
                        Listo
                    </button>
                </>
            )}
            {view.k === 'error' && (
                <>
                    <p role="alert" className="att-error">{view.msg}</p>
                    <button type="button" className="btn btn-primary" onClick={retry}>
                        Reintentar
                    </button>
                </>
            )}
        </div>
    );
}
