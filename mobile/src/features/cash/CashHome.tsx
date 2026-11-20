import type { CashApi } from '../../data/cashApi';
import type { Session } from '../../core/session';
import { ownerKeyOf } from '../../data/types';
import { ActiveShiftScreen } from './ActiveShiftScreen';
import { OpenShiftScreen } from './OpenShiftScreen';
import { useCashShift } from './useCashShift';
import './cash.css';

export type CountMode = 'partial' | 'close';

export interface CashHomeProps {
    session: Session;
    api: CashApi;
    onBack: () => void;
    /** "Arqueo parcial" / "Cerrar turno": the count screen (Task 6) takes it from here. */
    onCount: (shiftId: number, mode: CountMode) => void;
}

/** Cash entry: no open shift of mine -> "Abrir turno"; otherwise the active shift. */
export function CashHome({ session, api, onBack, onCount }: CashHomeProps) {
    const cash = useCashShift(api, ownerKeyOf(session));

    if (cash.loading) {
        return (
            <main className="cash">
                <p className="muted cash-notice">Cargando caja…</p>
            </main>
        );
    }
    if (!cash.status) {
        return (
            <main className="cash">
                <header className="cash-bar">
                    <button type="button" className="btn" aria-label="Volver" onClick={onBack}>
                        ←
                    </button>
                    <strong className="cash-title">Caja</strong>
                </header>
                <p className="error cash-notice" role="alert">
                    {cash.error instanceof Error ? cash.error.message : 'No se pudo cargar la caja.'}{' '}
                    <button type="button" className="btn" onClick={() => void cash.refresh()}>
                        Reintentar
                    </button>
                </p>
            </main>
        );
    }
    if (cash.shift && cash.status.hasActiveShift) {
        return <ActiveShiftScreen key={ownerKeyOf(session) ?? ''} api={api} session={session} shift={cash.shift} requiresClose={cash.status.requiresClose} closeMessage={cash.status.message} addMovement={cash.addMovement} onBack={onBack} onCount={onCount} />;
    }
    return <OpenShiftScreen key={ownerKeyOf(session) ?? ''} api={api} openShift={cash.openShift} onOpened={() => void cash.refresh()} onBack={onBack} />;
}
