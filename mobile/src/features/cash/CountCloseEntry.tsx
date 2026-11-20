import { useEffect, useState } from 'react';
import type { Session } from '../../core/session';
import type { Services } from '../../core/services';
import type { CashApi } from '../../data/cashApi';
import { loadCashApi } from '../../data/loadCashApi';
import { CountCloseScreen } from './CountCloseScreen';
import type { CountMode } from './CashHome';

/** Lazy entry of the count / close screen: loads the cash data layer, then shows the screen. */
export default function CountCloseEntry({ session, services, shiftId, mode, onBack, onClosed }: { session: Session; services: Pick<Services, 'http' | 'sessions'>; shiftId: number; mode: CountMode; onBack: () => void; onClosed: (shiftId: number) => void }) {
    const [api, setApi] = useState<CashApi | null>(null);
    const [failed, setFailed] = useState(false);
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
            <main className="cash" data-testid="cash-count">
                <header className="cash-bar">
                    <button type="button" className="btn" aria-label="Volver" onClick={onBack}>
                        ←
                    </button>
                    <strong className="cash-title">{mode === 'close' ? 'Cerrar turno' : 'Arqueo parcial'}</strong>
                </header>
                <p className={failed ? 'error cash-notice' : 'muted cash-notice'}>{failed ? 'No se pudo preparar la caja.' : 'Cargando caja…'}</p>
            </main>
        );
    }
    return <CountCloseScreen api={api} session={session} shiftId={shiftId} mode={mode} onBack={onBack} onClosed={onClosed} />;
}
