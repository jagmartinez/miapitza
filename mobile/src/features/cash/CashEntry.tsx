import { useEffect, useState } from 'react';
import type { Session } from '../../core/session';
import type { Services } from '../../core/services';
import type { CashApi } from '../../data/cashApi';
import { loadCashApi } from '../../data/loadCashApi';
import { CashHome, type CountMode } from './CashHome';
import { CloseReportScreen } from './CloseReportScreen';
import { ShiftHistoryScreen } from './ShiftHistoryScreen';

/** Lazy entry of the caja: loads the cash data layer, then shows the open-shift / active-shift screens. */
export default function CashEntry({ session, services, onBack, onCount }: { session: Session; services: Pick<Services, 'http' | 'sessions'>; onBack: () => void; onCount: (shiftId: number, mode: CountMode) => void }) {
    const [api, setApi] = useState<CashApi | null>(null);
    const [failed, setFailed] = useState(false);
    /** Local sub-views of the caja: the history list and one report opened from it. */
    const [view, setView] = useState<{ name: 'home' } | { name: 'history' } | { name: 'report'; shiftId: number }>({ name: 'home' });
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
                    <button type="button" className="btn" aria-label="Volver" onClick={onBack}>
                        ←
                    </button>
                    <strong className="cash-title">Caja</strong>
                </header>
                <p className={failed ? 'error cash-notice' : 'muted cash-notice'}>{failed ? 'No se pudo preparar la caja.' : 'Cargando caja…'}</p>
            </main>
        );
    }
    if (view.name === 'history') return <ShiftHistoryScreen api={api} onBack={() => setView({ name: 'home' })} onOpen={(shiftId) => setView({ name: 'report', shiftId })} />;
    if (view.name === 'report') return <CloseReportScreen api={api} session={session} shiftId={view.shiftId} onBack={() => setView({ name: 'history' })} />;
    return <CashHome session={session} api={api} onBack={onBack} onCount={onCount} onHistory={() => setView({ name: 'history' })} />;
}
