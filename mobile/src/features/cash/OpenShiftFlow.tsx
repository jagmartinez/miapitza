import { useEffect, useState } from 'react';
import type { CashApi } from '../../data/cashApi';
import { OpenShiftScreen } from './OpenShiftScreen';

/** "Abrir turno" from the payment screen: loads the cash data layer on demand, opens, and hands control back. */
export default function OpenShiftFlow({ loadCash, onOpened, onBack }: { loadCash: () => Promise<CashApi>; onOpened: () => void; onBack: () => void }) {
    const [api, setApi] = useState<CashApi | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let alive = true;
        loadCash().then(
            (a) => alive && setApi(a),
            () => alive && setFailed(true),
        );
        return () => {
            alive = false;
        };
    }, [loadCash]);

    if (!api) {
        return (
            <main className="cash" data-testid="open-shift">
                <header className="cash-bar">
                    <button type="button" className="btn" aria-label="Volver" onClick={onBack}>
                        ←
                    </button>
                </header>
                <p className={failed ? 'error cash-notice' : 'muted cash-notice'}>{failed ? 'No se pudo preparar la caja.' : 'Cargando caja…'}</p>
            </main>
        );
    }
    return <OpenShiftScreen api={api} openShift={(body, opts) => api.openShift(body, opts)} onOpened={onOpened} onBack={onBack} />;
}
