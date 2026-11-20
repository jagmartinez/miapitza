import { useEffect, useState } from 'react';
import type { CashApi } from '../../data/cashApi';
import type { CashRegisterRow } from '../../data/cashTypes';
import { useOnline } from '../../data/useOnline';
import { cashErrorText, isRetryable } from './cashErrors';
import type { CountMode } from './CashHome';
import './cash.css';

const timeOf = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });
};

/**
 * "Caja › Turnos abiertos" (ADMIN / SUPERADMIN only: CashHome never offers it to anyone else, and the server refuses a close by a
 * non-supervisor). Registers with an active shift; each opens the count / close screen of that shift, whoever owns it.
 * Force close there still needs a note.
 */
export function OpenShiftsScreen({ api, onBack, onCount }: { api: Pick<CashApi, 'registers'>; onBack: () => void; onCount: (shiftId: number, mode: CountMode) => void }) {
    const online = useOnline();
    const [rows, setRows] = useState<CashRegisterRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retryable, setRetryable] = useState(false);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let live = true;
        setError(null);
        api.registers().then(
            (list) => live && setRows(list.filter((r) => r.activeShift)),
            (cause) => {
                if (!live) return;
                setError(cashErrorText(cause, 'No se pudieron cargar los turnos.'));
                setRetryable(isRetryable(cause));
            },
        );
        return () => {
            live = false;
        };
    }, [api, tick]);

    return (
        <main className="cash" data-testid="open-shifts">
            <header className="cash-bar">
                <button type="button" className="btn" aria-label="Volver" onClick={onBack}>
                    ←
                </button>
                <strong className="cash-title">Caja › Turnos abiertos</strong>
                {!online && (
                    <span className="cash-offline" role="status">
                        Requiere conexión
                    </span>
                )}
            </header>
            {error && (
                <p className="error cash-notice" role="alert">
                    {error}{' '}
                    {retryable && (
                        <button type="button" className="btn" onClick={() => setTick((t) => t + 1)}>
                            Reintentar
                        </button>
                    )}
                </p>
            )}
            {!rows && !error && <p className="muted cash-notice">Cargando turnos…</p>}
            {rows && rows.length === 0 && <p className="muted cash-notice">No hay turnos abiertos.</p>}
            {rows && rows.length > 0 && (
                <ul className="cash-history-list" aria-label="Turnos abiertos">
                    {rows.map((r) => (
                        <li key={r.id} className="cash-history-row">
                            <span>
                                <strong>{r.branch?.name ? `${r.name} · ${r.branch.name}` : r.name}</strong>
                                <span className="muted cash-num">{`${r.activeShift?.user?.name ?? 'Otro usuario'} · desde ${timeOf(r.activeShift!.startDate)}`}</span>
                            </span>
                            <span className="cash-chips">
                                <button type="button" className="btn" aria-label={`Arqueo de ${r.name}`} disabled={!online} onClick={() => onCount(r.activeShift!.id, 'partial')}>
                                    Arqueo parcial
                                </button>
                                <button type="button" className="btn btn-primary" aria-label={`Cerrar turno de ${r.name}`} disabled={!online} onClick={() => onCount(r.activeShift!.id, 'close')}>
                                    Cerrar turno
                                </button>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}
