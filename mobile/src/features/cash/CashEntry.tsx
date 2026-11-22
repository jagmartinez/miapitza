import { useEffect, useState } from 'react';
import { IconArrowLeft } from '../../ui/Icon';
import type { Session } from '../../core/session';
import type { Services } from '../../core/services';
import type { CashApi } from '../../data/cashApi';
import { loadCashApi } from '../../data/loadCashApi';
import { CashHome, type CountMode } from './CashHome';
import { CloseReportScreen } from './CloseReportScreen';
import { OpenShiftsScreen } from './OpenShiftsScreen';
import { ShiftHistoryScreen } from './ShiftHistoryScreen';

/** Lazy entry of the caja: loads the cash data layer, then shows the open-shift / active-shift screens. */
export default function CashEntry({ session, services, onBack, onCount, closeAttempt = null, onAttemptSeen }: { session: Session; services: Pick<Services, 'http' | 'sessions'>; onBack: () => void; onCount: (shiftId: number, mode: CountMode) => void; closeAttempt?: number | null; onAttemptSeen?: () => void }) {
    const [api, setApi] = useState<CashApi | null>(null);
    const [failed, setFailed] = useState(false);
    /** Local sub-views of the caja: the history list and one report opened from it. */
    const [view, setView] = useState<{ name: 'home' } | { name: 'history' } | { name: 'openShifts' } | { name: 'report'; shiftId: number; from: 'history' | 'home' }>({ name: 'home' });
    useEffect(() => {
        let alive = true;
        loadCashApi(services).then(
            (a) => alive && setApi(a),
            () => alive && setFailed(true),
        );
        return () => {
            alive = false;
        };
    }, [services]);

    if (!api) {
        return (
            <main className="cash" data-testid="cash-entry">
                <header className="cash-bar">
                    <button type="button" className="cash-back" aria-label="Volver" onClick={onBack}>
<IconArrowLeft size={22} stroke={1.5} aria-hidden />
</button>
                    <strong className="cash-title">Caja</strong>
                </header>
                <p className={failed ? 'error cash-notice' : 'muted cash-notice'}>{failed ? 'No se pudo preparar la caja.' : 'Cargando caja…'}</p>
            </main>
        );
    }
    if (view.name === 'openShifts') return <OpenShiftsScreen api={api} onBack={() => setView({ name: 'home' })} onCount={onCount} />;
    if (view.name === 'history') return <ShiftHistoryScreen api={api} onBack={() => setView({ name: 'home' })} onOpen={(shiftId) => setView({ name: 'report', shiftId, from: 'history' })} />;
    if (view.name === 'report') return <CloseReportScreen api={api} session={session} shiftId={view.shiftId} onBack={() => setView(view.from === 'home' ? { name: 'home' } : { name: 'history' })} />;
    return <CashHome session={session} api={api} onBack={onBack} onCount={onCount} onHistory={() => setView({ name: 'history' })} onOpenShifts={() => setView({ name: 'openShifts' })} closeAttempt={closeAttempt} onReport={(shiftId) => setView({ name: 'report', shiftId, from: 'home' })} onAttemptSeen={onAttemptSeen} />;
}
