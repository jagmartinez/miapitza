import { useCallback, useEffect, useRef, useState } from 'react';
import type { HrAttendancePolicy, HrBiometricProfile } from '@web/types/hr-attendance';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useAccountNav } from '../AccountNav';
import { useSessionRestored } from '../useSessionRestored';
import type { HrApi } from '../hrApi';
import { EnrollScreen } from './EnrollScreen';
import { failureMessage } from './captureCommon';

type View =
    | { k: 'loading' }
    | { k: 'loadError'; msg: string }
    | { k: 'disabled' }
    | { k: 'enroll'; policy: HrAttendancePolicy }
    | { k: 'pending' }
    | { k: 'active'; profile: HrBiometricProfile };

function formatDate(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Own face registration, reachable from the account home without a shift:
 * an employee can enroll ahead of time and see where the registration stands.
 */
export function FaceSetupScreen({ hr }: { hr: HrApi }) {
    const { back } = useAccountNav();
    const [view, setView] = useState<View>({ k: 'loading' });
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
            const [policy, bio] = await Promise.all([hr.attendancePolicy(), hr.biometricStatus()]);
            if (!mounted.current) return;
            if (bio.status === 'ACTIVE') return show({ k: 'active', profile: bio });
            if (bio.status === 'PENDING') return show({ k: 'pending' });
            if (policy.requireBiometric === false) return show({ k: 'disabled' });
            show({ k: 'enroll', policy });
        } catch (e) {
            show({ k: 'loadError', msg: failureMessage(e) });
        }
    }, [hr, show]);
    useEffect(() => {
        void load();
    }, [load]);
    const viewKind = useRef(view.k);
    viewKind.current = view.k;
    useSessionRestored(() => {
        if (viewKind.current === 'loadError') void load();
    });

    const since = view.k === 'active' ? formatDate(view.profile.approvedAt ?? view.profile.enrolledAt) : null;

    return (
        <main>
            <ScreenHeader title="Registro facial" onBack={back} />
            <div className="att-screen">
                {view.k === 'loading' && <p className="muted">Cargando…</p>}
                {view.k === 'loadError' && (
                    <>
                        <p role="alert" className="att-error">{view.msg}</p>
                        <button type="button" className="btn btn-primary" onClick={() => void load()}>Reintentar</button>
                    </>
                )}
                {view.k === 'disabled' && (
                    <div className="att-result">
                        <h2>No se requiere registro facial</h2>
                        <p className="muted">Tu sucursal no usa reconocimiento facial para marcar.</p>
                    </div>
                )}
                {view.k === 'pending' && (
                    <div className="att-result" data-tone="review">
                        <h2>Registro facial pendiente de aprobación</h2>
                        <p className="muted">RH debe aprobar tu registro antes de que puedas marcar.</p>
                        <button type="button" className="btn btn-primary" onClick={() => void load()}>Actualizar</button>
                    </div>
                )}
                {view.k === 'active' && (
                    <div className="att-result" data-tone="ok">
                        <h2>Registro facial activo</h2>
                        <p className="muted">{since ? `Registrado desde el ${since}. ` : ''}Al marcar, la app verifica tu rostro.</p>
                    </div>
                )}
                {view.k === 'enroll' && (
                    <EnrollScreen hr={hr} policy={view.policy} onDone={(profile) => (profile.status === 'PENDING' ? show({ k: 'pending' }) : void load())} />
                )}
            </div>
        </main>
    );
}
