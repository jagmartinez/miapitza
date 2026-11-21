import { useCallback, useEffect, useRef, useState } from 'react';
import type { HrAttendanceAction, HrAttendanceChallenge, HrAttendancePolicy, HrAttendancePunchResult, HrBiometricProfile, HrTodayAttendance } from '@web/types/hr-attendance';
import { ATTENDANCE_ACTION_LABELS, isChallengeExpired, presentAttendanceChecks } from '@web/components/hr/attendanceRules';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useAccountNav } from '../AccountNav';
import { HrError, type HrApi } from '../hrApi';
import { useFaceCapture } from './useFaceCapture';
import { useLocation, type LocationFix } from './useLocation';
import { EnrollScreen } from './EnrollScreen';
import { appendFrames, CameraView, failureMessage, MSG, newActionId } from './captureCommon';

const DONE_LABEL: Record<HrAttendanceAction, string> = {
    CHECK_IN: 'Entrada registrada',
    BREAK_START: 'Inicio de descanso registrado',
    BREAK_END: 'Fin de descanso registrado',
    CHECK_OUT: 'Salida registrada',
};

interface Pending {
    form: FormData;
    challenge: HrAttendanceChallenge | null;
    actionId: string;
}

type View =
    | { k: 'loading' }
    | { k: 'loadError'; msg: string }
    | { k: 'enroll'; policy: HrAttendancePolicy }
    | { k: 'pendingEnrollment' }
    | { k: 'ready' }
    | { k: 'locating' }
    | { k: 'capturing'; instruction?: string }
    | { k: 'sending' }
    | { k: 'result'; result: HrAttendancePunchResult }
    | { k: 'error'; msg: string; resend: boolean };

function formatTime(iso: string | undefined, timeZone: string): string {
    const d = iso ? new Date(iso) : new Date();
    try {
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
    } catch {
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
}

export function PunchScreen({ hr }: { hr: HrApi }) {
    const { back, navigate, params } = useAccountNav();
    const face = useFaceCapture();
    const loc = useLocation();
    const [view, setView] = useState<View>({ k: 'loading' });
    const [today, setToday] = useState<HrTodayAttendance | null>(null);
    const pending = useRef<Pending | null>(null);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const show = useCallback((v: View) => {
        if (mounted.current) setView(v);
    }, []);

    const load = useCallback(async () => {
        show({ k: 'loading' });
        try {
            const [t, policy, bio] = await Promise.all([hr.attendanceToday(), hr.attendancePolicy(), hr.biometricStatus()]);
            if (!mounted.current) return;
            setToday(t);
            if (t.policy?.requireBiometric !== false) {
                if (bio.status === 'PENDING') return show({ k: 'pendingEnrollment' });
                if (bio.status === 'NOT_ENROLLED' || bio.status === 'REVOKED') return show({ k: 'enroll', policy });
            }
            show({ k: 'ready' });
        } catch (e) {
            show({ k: 'loadError', msg: failureMessage(e) });
        }
    }, [hr, show]);
    useEffect(() => {
        void load();
    }, [load]);

    const action: HrAttendanceAction | undefined = (params.action as HrAttendanceAction | undefined) ?? today?.availableActions?.[0];

    const submit = async (p: Pending) => {
        show({ k: 'sending' });
        try {
            const result = await hr.punch(p.form, { actionId: p.actionId });
            pending.current = null;
            show({ k: 'result', result });
        } catch (e) {
            const ambiguous = e instanceof HrError && e.isAmbiguous && e.code !== 'FACE_PROVIDER_UNAVAILABLE';
            if (!ambiguous) pending.current = null;
            show({ k: 'error', msg: ambiguous ? MSG.unconfirmed : failureMessage(e), resend: ambiguous });
        }
    };

    const run = async () => {
        if (!today || !action) return;
        pending.current = null;
        const wantsFace = today.policy?.requireBiometric !== false;
        const wantsLocation = today.policy?.requireGeolocation !== false;
        try {
            let fix: LocationFix | null = null;
            if (wantsLocation) {
                show({ k: 'locating' });
                fix = await loc.get();
                const max = today.locationRequirements?.maxAccuracyM ?? today.policy?.maxLocationAccuracyM;
                if (max != null && fix.accuracyM > max) {
                    return show({ k: 'error', msg: `Ubicación imprecisa (±${Math.round(fix.accuracyM)} m). Sal a un lugar abierto y reintenta.`, resend: false });
                }
            }
            const form = new FormData();
            form.append('action', action);
            let challenge: HrAttendanceChallenge | null = null;
            if (wantsFace) {
                challenge = await hr.createChallenge('ATTENDANCE_PUNCH', action);
                show({ k: 'capturing', instruction: challenge.livenessInstruction ?? challenge.instruction });
                await face.start();
                const frames = await face.captureFrames(challenge.captureFrameCount, challenge.captureIntervalMs);
                face.stop();
                form.append('challengeId', challenge.id);
                if (challenge.token) form.append('challengeToken', challenge.token);
                appendFrames(form, frames, 'face-evidence');
            }
            if (fix) {
                form.append('latitude', String(fix.latitude));
                form.append('longitude', String(fix.longitude));
                form.append('accuracyM', String(fix.accuracyM));
                form.append('locationCapturedAt', fix.capturedAt);
            }
            const p = { form, challenge, actionId: newActionId() };
            pending.current = p;
            await submit(p);
        } catch (e) {
            face.stop();
            show({ k: 'error', msg: failureMessage(e), resend: false });
        }
    };

    const retry = () => {
        const p = pending.current;
        if (p && (!p.challenge || !isChallengeExpired(p.challenge.expiresAt))) void submit(p);
        else void run();
    };

    const tz = today?.timezone ?? 'UTC';
    const busy = view.k === 'locating' || view.k === 'capturing' || view.k === 'sending';
    const shift = today?.scheduledShift;

    return (
        <main>
            <ScreenHeader title="Marcar" onBack={back} />
            <div className="att-screen">
                <CameraView videoRef={face.videoRef} visible={view.k === 'capturing'} instruction={view.k === 'capturing' ? view.instruction : undefined} />
                {view.k === 'loading' && <p className="muted">Cargando…</p>}
                {view.k === 'loadError' && (
                    <>
                        <p role="alert" className="att-error">{view.msg}</p>
                        <button type="button" className="btn btn-primary" onClick={() => void load()}>Reintentar</button>
                    </>
                )}
                {view.k === 'pendingEnrollment' && (
                    <div className="att-result" data-tone="review">
                        <h2>Registro facial pendiente de aprobación</h2>
                        <p className="muted">RH debe aprobar tu registro antes de que puedas marcar.</p>
                    </div>
                )}
                {view.k === 'enroll' && (
                    <EnrollScreen
                        hr={hr}
                        policy={view.policy}
                        onDone={(profile: HrBiometricProfile) => (profile.status === 'PENDING' ? show({ k: 'pendingEnrollment' }) : void load())}
                    />
                )}
                {(view.k === 'ready' || busy) && today && (
                    <>
                        {today.blockingIssue ? (
                            <>
                                <p>{today.blockingIssue.message}</p>
                                <button type="button" className="btn btn-primary" onClick={() => navigate('correction', { stale: true })}>
                                    Solicitar corrección
                                </button>
                            </>
                        ) : action ? (
                            <>
                                <h2>{ATTENDANCE_ACTION_LABELS[action]}</h2>
                                <p className="muted">
                                    {today.targetBranch?.name ?? 'Sucursal'}
                                    {shift ? ` · Turno ${formatTime(shift.startAt, tz)}–${formatTime(shift.endAt, tz)}` : ' · Sin turno programado'}
                                </p>
                                {view.k === 'locating' && <p className="muted">Obteniendo tu ubicación…</p>}
                                {view.k === 'sending' && <p className="muted">Enviando…</p>}
                                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run()}>
                                    Marcar {ATTENDANCE_ACTION_LABELS[action].toLowerCase()}
                                </button>
                            </>
                        ) : (
                            <p className="muted">No hay marcajes disponibles ahora.</p>
                        )}
                    </>
                )}
                {view.k === 'result' && <ResultView result={view.result} action={action} tz={tz} onRetry={() => void run()} onDone={back} />}
                {view.k === 'error' && (
                    <>
                        <p role="alert" className="att-error">{view.msg}</p>
                        <button type="button" className="btn btn-primary" onClick={view.resend ? retry : () => void run()}>
                            Reintentar
                        </button>
                    </>
                )}
            </div>
        </main>
    );
}

function ResultView({ result, action, tz, onRetry, onDone }: { result: HrAttendancePunchResult; action?: HrAttendanceAction; tz: string; onRetry: () => void; onDone: () => void }) {
    if (result.decision === 'ACCEPTED') {
        const act = result.punch?.action ?? result.event?.action ?? action ?? 'CHECK_IN';
        const when = formatTime(result.punch?.occurredAt ?? result.event?.occurredAt, tz);
        return (
            <>
                <div className="att-result" data-tone="ok">
                    <h2>
                        <span aria-hidden="true">✓ </span>
                        {`${DONE_LABEL[act]} ${when}`}
                    </h2>
                </div>
                <button type="button" className="btn btn-primary" onClick={onDone}>Listo</button>
            </>
        );
    }
    if (result.decision === 'REVIEW_REQUIRED') {
        return (
            <>
                <div className="att-result" data-tone="review">
                    <h2>{`Registrado — RH lo revisará: ${result.message}`}</h2>
                </div>
                <button type="button" className="btn btn-primary" onClick={onDone}>Listo</button>
            </>
        );
    }
    const failed = presentAttendanceChecks(result.checks).filter((c) => c.check.status === 'FAILED' || c.check.status === 'REVIEW');
    return (
        <>
            <div className="att-result" data-tone="rejected">
                <h2>{result.message}</h2>
                {failed.length > 0 && (
                    <ul>
                        {failed.map((c) => (
                            <li key={c.key}>
                                <strong>{c.label}</strong>
                                {c.guidance ? ` — ${c.guidance}` : ''}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <button type="button" className="btn btn-primary" onClick={onRetry}>Reintentar</button>
        </>
    );
}
