import { useEffect, useState } from 'react';
import type { Session } from '../../core/session';
import type { Services } from '../../core/services';
import type { CashApi } from '../../data/cashApi';
import { loadCashApi } from '../../data/loadCashApi';
import { CloseReportScreen } from './CloseReportScreen';

/** Lazy entry of the close report (right after a close): loads the cash data layer, then shows the report. */
export default function CloseReportEntry({ session, services, shiftId, onDone }: { session: Session; services: Pick<Services, 'http' | 'sessions'>; shiftId: number; onDone: () => void }) {
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
            <main className="cash" data-testid="cash-report" data-shift={shiftId}>
                <header className="cash-bar">
                    <strong className="cash-title">Turno cerrado</strong>
                    <span className="grow" />
                    <button type="button" className="btn" onClick={onDone}>
                        Listo
                    </button>
                </header>
                <p className={failed ? 'error cash-notice' : 'muted cash-notice'}>{failed ? 'No se pudo preparar la caja.' : 'Cargando reporte…'}</p>
            </main>
        );
    }
    return <CloseReportScreen api={api} session={session} shiftId={shiftId} onDone={onDone} />;
}
