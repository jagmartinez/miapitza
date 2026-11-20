import { useEffect } from 'react';
import type { CashApi } from '../../data/cashApi';
import type { Session } from '../../core/session';
import { isCashAdmin } from '../../core/permissions';
import { ownerKeyOf } from '../../data/types';
import { cashErrorText, isRetryable } from './cashErrors';
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
    /** "Historial de turnos": closed shifts and their reports. */
    onHistory?: () => void;
    /** ADMIN / SUPERADMIN: "Turnos abiertos" (count / close another user's shift). Ignored for everyone else. */
    onOpenShifts?: () => void;
    /** Shift whose close was sent and whose outcome the cashier did not see (she left the count screen). */
    closeAttempt?: number | null;
    /** Opens the close report of a shift. */
    onReport?: (shiftId: number) => void;
    /** The attempt was checked: forget it. */
    onAttemptSeen?: () => void;
}

/** Cash entry: no open shift of mine -> "Abrir turno"; otherwise the active shift. */
export function CashHome({ session, api, onBack, onCount, onHistory, onOpenShifts, closeAttempt = null, onReport, onAttemptSeen }: CashHomeProps) {
    const cash = useCashShift(api, ownerKeyOf(session));
    const supervise = isCashAdmin(session.user) ? onOpenShifts : undefined;
    // After a close whose outcome the cashier did not see: once the status is fresh, either the shift is gone (offer its report) or it is still open (forget it).
    const stillOpen = !!cash.status && cash.status.hasActiveShift && cash.shift?.id === closeAttempt;
    const settled = closeAttempt != null && !cash.loading && !!cash.status;
    useEffect(() => {
        if (settled && stillOpen) onAttemptSeen?.();
    }, [settled, stillOpen, onAttemptSeen]);
    if (settled && !stillOpen && onReport) {
        return (
            <main className="cash" data-testid="cash-closed-notice">
                <header className="cash-bar">
                    <strong className="cash-title">Caja</strong>
                </header>
                <div className="cash-notice" role="status">
                    <h2 className="cash-h">Tu turno se cerró</h2>
                    <p className="muted">El cierre se registró. Puedes ver o imprimir el reporte.</p>
                    <div className="cash-sheet-actions">
                        <button type="button" className="btn" onClick={() => onAttemptSeen?.()}>
                            Continuar
                        </button>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => {
                                onAttemptSeen?.();
                                onReport(closeAttempt);
                            }}
                        >
                            Ver reporte
                        </button>
                    </div>
                </div>
            </main>
        );
    }

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
                    {cashErrorText(cash.error, 'No se pudo cargar la caja.')}{' '}
                    {isRetryable(cash.error) && (
                        <button type="button" className="btn" onClick={() => void cash.refresh()}>
                            Reintentar
                        </button>
                    )}
                </p>
            </main>
        );
    }
    if (cash.shift && cash.status.hasActiveShift) {
        return <ActiveShiftScreen key={ownerKeyOf(session) ?? ''} api={api} session={session} shift={cash.shift} requiresClose={cash.status.requiresClose} closeMessage={cash.status.message} addMovement={cash.addMovement} onBack={onBack} onCount={onCount} onHistory={onHistory} onSupervise={supervise} />;
    }
    return <OpenShiftScreen key={ownerKeyOf(session) ?? ''} api={api} openShift={cash.openShift} onOpened={() => void cash.refresh()} onBack={onBack} onHistory={onHistory} onSupervise={supervise} />;
}
