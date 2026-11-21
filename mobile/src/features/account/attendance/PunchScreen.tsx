import { useCallback, useEffect, useRef, useState } from 'react';
import type { HrAttendanceAction, HrAttendanceChallenge, HrAttendancePolicy, HrAttendancePunchResult, HrBiometricProfile, HrTodayAttendance } from '@web/types/hr-attendance';
import { ATTENDANCE_ACTION_LABELS, isChallengeExpired, presentAttendanceChecks } from '@web/components/hr/attendanceRules';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useAccountNav } from '../AccountNav';
import { useSessionRestored } from '../useSessionRestored';
import type { HrApi } from '../hrApi';
import { useFaceCapture } from './useFaceCapture';
import { useLocation, type LocationFix } from './useLocation';
import { EnrollScreen } from './EnrollScreen';
import { appendFrames, CameraView, failureMessage, isInProgress, isResendable, MSG, newActionId } from './captureCommon';

const DONE_LABEL: Record<HrAttendanceAction, string> = {
    CHECK_IN: 'Entrada registrada',
    BREAK_START: 'Inicio de descanso registrado',
    BREAK_END: 'Fin de descanso registrado',
    CHECK_OUT: 'Salida registrada',
};

interface Pending {
    form: FormData;
    challenge: HrAttendanceChallenge;
    actionId: string;
}

type View =
    | { k: 'loading' }
    | { k: 'loadError'; msg: string }
    | { k: 'enroll'; policy: HrAttendancePolicy }
    | { k: 'pendingEnrollment' }
    | { k: 'ready' }
    | { k: 'preparing' }
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
    const running = useRef(false);
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
            const wanted = params.action as HrAttendanceAction | undefined;
            if (wanted && !t.blockingIssue && !t.availableActions?.includes(wanted)) return navigate('home');
            if (t.policy?.requireBiometric !== false) {
                if (bio.status === 'PENDING') return show({ k: 'pendingEnrollment' });
                if (bio.status === 'NOT_ENROLLED' || bio.status === 'REVOKED') return show({ k: 'enroll', policy });
            }
            show({ k: 'ready' });
        } catch (e) {
            show({ k: 'loadError', msg: failureMessage(e) });
        }
    }, [hr, show, navigate, params.action]);
    useEffect(() => {
        void load();
    }, [load]);
    // Re-login over a load error: read again (a form in progress keeps its state).
    const viewKind = useRef(view.k);
    viewKind.current = view.k;
    useSessionRestored(() => {
        if (viewKind.current === 'loadError') void load();
    });

    const [chosen, setChosen] = useState<HrAttendanceAction | undefined>();
    const available = today?.availableActions ?? [];
    // With several available actions and none picked on the home, the employee chooses here.
    const action: HrAttendanceAction | undefined = (params.action as HrAttendanceAction | undefined) ?? chosen ?? (available.length === 1 ? available[0] : undefined);

    const submit = async (p: Pending) => {
        show({ k: 'sending' });
        try {
            const result = await hr.punch(p.form, { actionId: p.actionId });
            pending.current = null;
            show({ k: 'result', result });
        } catch (e) {
            const resend = isResendable(e);
            if (!resend) pending.current = null;
            show({ k: 'error', msg: isInProgress(e) ? MSG.inProgress : resend ? MSG.unconfirmed : failureMessage(e), resend });
        }
    };

    /** Leaving the screen cancels the flow: nothing opens the camera or submits afterwards. */
    const cancelled = () => {
        if (mounted.current) return false;
        face.stop();
        return true;
    };

    const run = async () => {
        if (!today || !action || running.current) return;
        running.current = true;
        pending.current = null;
        show({ k: 'preparing' });
        const wantsFace = today.policy?.requireBiometric !== false;
        const wantsLocation = today.policy?.requireGeolocation !== false;
        try {
            let fix: LocationFix | null = null;
            if (wantsLocation) {
                show({ k: 'locating' });
                fix = await loc.get();
                if (cancelled()) return;
                const max = today.locationRequirements?.maxAccuracyM ?? today.policy?.maxLocationAccuracyM;
                if (max != null && fix.accuracyM > max) {
                    return show({ k: 'error', msg: `Ubicación imprecisa (±${Math.round(fix.accuracyM)} m). Sal a un lugar abierto y reintenta.`, resend: false });
                }
            }
            // The server requires a challenge for every punch, like the web wizard; only the frames depend on the policy.
            const challenge = await hr.createChallenge('ATTENDANCE_PUNCH', action);
            if (cancelled()) return;
            const form = new FormData();
            form.append('action', action);
            form.append('challengeId', challenge.id);
            if (challenge.token) form.append('challengeToken', challenge.token);
            if (wantsFace) {
                show({ k: 'capturing', instruction: challenge.livenessInstruction ?? challenge.instruction });
                await face.start();
                if (cancelled()) return;
                const frames = await face.captureFrames(challenge.captureFrameCount, challenge.captureIntervalMs);
                face.stop();
                if (cancelled()) return;
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
        } finally {
            running.current = false;
        }
    };

    const retry = async () => {
        const p = pending.current;
        if (p && !isChallengeExpired(p.challenge.expiresAt)) {
            if (running.current) return;
            running.current = true;
            try {
                await submit(p);
            } finally {
                running.current = false;
            }
        } else {
            await run();
        }
    };

    const tz = today?.timezone ?? 'UTC';
    const busy = view.k === 'preparing' || view.k === 'locating' || view.k === 'capturing' || view.k === 'sending';
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
                        <button type="button" className="btn btn-primary" onClick={() => void load()}>Actualizar</button>
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
                        ) : available.length > 1 ? (
                            available.map((a, i) => (
                                <button key={a} type="button" className={`btn${i === 0 ? ' btn-primary' : ''}`} onClick={() => setChosen(a)}>
                                    {ATTENDANCE_ACTION_LABELS[a]}
                                </button>
                            ))
                        ) : (
                            <p className="muted">No hay marcajes disponibles ahora.</p>
                        )}
                    </>
                )}
                {view.k === 'result' && <ResultView result={view.result} action={action} tz={tz} onRetry={() => void run()} onDone={back} />}
                {view.k === 'error' && (
                    <>
                        <p role="alert" className="att-error">{view.msg}</p>
                        <button type="button" className="btn btn-primary" onClick={view.resend ? () => void retry() : () => void run()}>
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
                        {`${DONE_LABEL[act] ?? 'Marcaje registrado'} ${when}`}
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
