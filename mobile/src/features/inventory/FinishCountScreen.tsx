import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnline } from '../../data/useOnline';
import type { InventoryApi } from './inventoryApi';
import { OfflineError } from './inventoryApi';
import { COUNT_ERROR, type SubmittedSheet } from './inventoryTypes';
import { DropNotices } from './DropNotices';
import type { DroppedLine } from './useDroppedLines';
import './inventory.css';

const codeOf = (e: unknown): string => String((e as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code ?? '');
const RECHECK_MS = 1500;

export interface FinishCountScreenProps {
    api: Pick<InventoryApi, 'sheet' | 'pendingLines' | 'submit'>;
    sheetId: number;
    /** "Volver a contarlos": back to the count, listing only what is uncounted. */
    onRecount: () => void;
    onSubmitted: (result: SubmittedSheet) => void;
    /** Back to the count as it was. */
    onBack?: () => void;
    /** Lines the queue dropped (from the entry): shown here, and the totals are recomputed when `dropTick` goes up. */
    drops?: DroppedLine[];
    onDismissDrop?: (key: string) => void;
    dropTick?: number;
}

export function FinishCountScreen({ api, sheetId, onRecount, onSubmitted, onBack, drops = [], onDismissDrop, dropTick = 0 }: FinishCountScreenProps) {
    const online = useOnline();
    const [totals, setTotals] = useState<{ counted: number; notCounted: number } | null>(null);
    const [failed, setFailed] = useState(false);
    const [pending, setPending] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const busy = useRef(false);

    const load = useCallback(() => {
        setFailed(false);
        api.sheet(sheetId).then(
            (s) => {
                const counted = s.lines.filter((l) => l.counted).length;
                setTotals({ counted, notCounted: s.lines.length - counted });
            },
            () => setFailed(true),
        );
    }, [api, sheetId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(load, [load, dropTick]);

    // Saves still on the device block the sending; look again while there are any (and when the connection changes).
    const refreshPending = useCallback(() => api.pendingLines(sheetId).then(setPending, () => undefined), [api, sheetId]);
    useEffect(() => {
        void refreshPending();
    }, [refreshPending, online, dropTick]);
    useEffect(() => {
        if (pending === 0) return undefined;
        const t = setInterval(() => void refreshPending(), RECHECK_MS);
        return () => clearInterval(t);
    }, [pending, refreshPending]);

    const blocked = pending > 0 || !online;

    const submit = async () => {
        if (busy.current || blocked || !totals) return;
        busy.current = true;
        setSubmitting(true);
        setError(null);
        try {
            const result = await api.submit(sheetId);
            onSubmitted(result);
        } catch (e) {
            const code = codeOf(e);
            if (e instanceof OfflineError) setError('Requiere conexión.');
            else if (code === COUNT_ERROR.empty) setError('Cuenta al menos un producto antes de enviar.');
            else if (code === COUNT_ERROR.recountPending) setError('Faltan productos por recontar. Vuelve a contarlos.');
            else setError('No se pudo enviar. Intenta de nuevo.');
            busy.current = false;
            setSubmitting(false);
            void refreshPending();
        }
    };

    return (
        <main className="cnt-finish" data-testid="finish-screen">
            <header className="cnt-header">
                {onBack && (
                    <button type="button" className="btn cnt-back" aria-label="Volver" onClick={onBack}>
                        ←
                    </button>
                )}
                <strong className="cnt-title">Terminar conteo</strong>
            </header>
            <div className="cnt-finish-body">
                {drops.filter((x) => x.sheetId === sheetId).length > 0 && (
                    <div className="cnt-notices">
                        <DropNotices drops={drops.filter((x) => x.sheetId === sheetId)} onDismiss={(key) => onDismissDrop?.(key)} />
                    </div>
                )}
                {failed && (
                    <div className="inv-error" role="alert">
                        <p className="error">No se pudo cargar el conteo.</p>
                        <button type="button" className="btn" onClick={load}>
                            Reintentar
                        </button>
                    </div>
                )}
                {!failed && !totals && <p className="muted">Cargando…</p>}
                {totals && (
                    <>
                        <dl className="cnt-totals">
                            <div>
                                <dt>Contados</dt>
                                <dd data-testid="total-counted">{totals.counted}</dd>
                            </div>
                            <div>
                                <dt>Sin contar</dt>
                                <dd data-testid="total-uncounted">{totals.notCounted}</dd>
                            </div>
                        </dl>
                        {totals.notCounted > 0 && <p className="muted">Los productos sin contar no se ajustan</p>}
                        {pending > 0 && <p className="cnt-warn">{pending === 1 ? 'Queda 1 guardado' : `Quedan ${pending} guardados`} sin enviar al servidor. Se podrá enviar al sincronizar.</p>}
                        {!online && <p className="cnt-warn">Sin conexión: enviar a revisión requiere conexión.</p>}
                        {error && (
                            <p className="error" role="alert">
                                {error}
                            </p>
                        )}
                        <div className="cnt-finish-actions">
                            {totals.notCounted > 0 && (
                                <button type="button" className="btn" onClick={onRecount}>
                                    Volver a contarlos
                                </button>
                            )}
                            <button type="button" className="btn btn-primary" disabled={blocked || submitting} onClick={() => void submit()}>
                                Enviar a revisión
                            </button>
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}
