import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionOpts, CashApi } from '../../data/cashApi';
import { CashError, type CashRegisterRow } from '../../data/cashTypes';
import { useOnline } from '../../data/useOnline';
import { money } from '../waiter/order/orderModel';
import { Keypad, parseTyped, typeKey } from '../waiter/payment/controls';
import { cashErrorText, isRetryable } from './cashErrors';
import { OpeningCount } from './OpeningCount';
import '../waiter/payment/payment.css';
import './cash.css';

export const OFFLINE_TEXT = 'Requiere conexión';
const ROUND_AMOUNTS = [500, 1000, 2000];

export interface OpenShiftProps {
    api: Pick<CashApi, 'registers' | 'suggestedFloat'>;
    /** Opens the shift (the hook's openShift refreshes the active shift; the payment entry point passes the api's). */
    openShift: (body: { cashRegisterId: number; startAmount: number }, opts?: ActionOpts) => Promise<unknown>;
    onOpened: () => void;
    onBack?: () => void;
    title?: string;
    /** "Historial de turnos" (the standalone caja only). */
    onHistory?: () => void;
    /** "Turnos abiertos" (ADMIN / SUPERADMIN only: the caller passes it just for them). */
    onSupervise?: () => void;
}

/** Why an open failed, in words for the cashier. */
export function openErrorMessage(error: unknown): string {
    if (error instanceof CashError) {
        if (error.code === 'CASH_REGISTER_OCCUPIED') return error.occupiedBy ? `Caja ocupada por ${error.occupiedBy.name}.` : 'Esa caja ya está ocupada.';
        if (error.code === 'CASH_OFFLINE') return OFFLINE_TEXT;
        return error.message;
    }
    return cashErrorText(error, 'No se pudo abrir el turno.');
}

/** "Abrir turno" (spec 7.3.2b): register, opening float, open. Cash calls are online only. */
export function OpenShiftScreen({ api, openShift, onOpened, onBack, title = 'Abrir turno', onHistory, onSupervise }: OpenShiftProps) {
    const online = useOnline();
    const [registers, setRegisters] = useState<CashRegisterRow[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadRetry, setLoadRetry] = useState(false);
    const [registerId, setRegisterId] = useState<number | null>(null);
    /** Registers the server told us are taken (by whom), until a reload says otherwise. */
    const [taken, setTaken] = useState<Record<number, string>>({});
    const [typed, setTyped] = useState('');
    const [suggested, setSuggested] = useState<number | null>(null);
    const [counting, setCounting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [pending, setPending] = useState(false);
    const pendingRef = useRef(false);
    const actionId = useRef<string | null>(null);
    const alive = useRef(true);
    const autoPicked = useRef(false);

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const loadRegisters = useCallback(async () => {
        try {
            const rows = await api.registers();
            if (!alive.current) return;
            setRegisters(rows);
            setLoadError(null);
            // The only free register is picked for the cashier once, on the first load.
            if (!autoPicked.current) {
                autoPicked.current = true;
                const free = rows.filter((r) => !r.activeShift);
                if (free.length === 1) setRegisterId(free[0].id);
            }
        } catch (cause) {
            if (alive.current) {
                setLoadError(openErrorMessage(cause));
                setLoadRetry(isRetryable(cause));
            }
        }
    }, [api]);
    useEffect(() => {
        void loadRegisters();
    }, [loadRegisters]);

    useEffect(() => {
        setSuggested(null);
        if (registerId == null) return undefined;
        let live = true;
        api.suggestedFloat(registerId).then(
            (s) => live && setSuggested(typeof s.suggested === 'number' && s.suggested > 0 ? s.suggested : null),
            () => undefined,
        );
        return () => {
            live = false;
        };
    }, [api, registerId]);

    /** A changed register or amount is a new submit: the retry id of the failed one is dropped. */
    const edit = (next: string) => {
        actionId.current = null;
        setFailed(false);
        setError(null);
        setTyped(next);
    };
    const choose = (id: number) => {
        actionId.current = null;
        setFailed(false);
        setError(null);
        setRegisterId(id);
    };

    const amount = typed === '' ? null : parseTyped(typed);
    const canOpen = online && !pending && registerId != null && amount != null;

    const submit = async () => {
        if (!canOpen || pendingRef.current || registerId == null || amount == null) return;
        pendingRef.current = true;
        setPending(true);
        setError(null);
        actionId.current ??= crypto.randomUUID();
        try {
            await openShift({ cashRegisterId: registerId, startAmount: amount }, { actionId: actionId.current });
            actionId.current = null;
            if (alive.current) onOpened();
        } catch (cause) {
            if (!alive.current) return;
            if (cause instanceof CashError && cause.code === 'CASH_SHIFT_ALREADY_OPEN') {
                // The shift exists already: show it instead of failing.
                actionId.current = null;
                onOpened();
                return;
            }
            // A definitive answer ends the action; only an unknown outcome (network, timeout, 5xx) may be retried with the same id.
            if (!isRetryable(cause)) actionId.current = null;
            if (cause instanceof CashError) {
                if (cause.code === 'CASH_REGISTER_OCCUPIED') {
                    setTaken((t) => ({ ...t, [registerId]: cause.occupiedBy?.name ?? 'otro usuario' }));
                    setRegisterId(null);
                    void loadRegisters();
                }
            }
            setFailed(isRetryable(cause));
            setError(openErrorMessage(cause));
        } finally {
            pendingRef.current = false;
            if (alive.current) setPending(false);
        }
    };

    const label = amount == null ? 'Abrir turno' : `Abrir turno con ${money(amount)}`;

    return (
        <main className="cash" data-testid="open-shift">
            <header className="cash-bar">
                {onBack && (
                    <button type="button" className="btn" aria-label="Volver" disabled={pending} onClick={onBack}>
                        ←
                    </button>
                )}
                <strong className="cash-title">{title}</strong>
                {!online && (
                    <span className="cash-offline" role="status">
                        {OFFLINE_TEXT}
                    </span>
                )}
                {(onHistory || onSupervise) && (
                    <>
                        <span className="grow" />
                        {onSupervise && (
                            <button type="button" className="btn" aria-label="Turnos abiertos" disabled={pending} onClick={onSupervise}>
                                Turnos abiertos
                            </button>
                        )}
                    </>
                )}
                {onHistory && (
                    <>
                        <button type="button" className="btn" aria-label="Historial de turnos" disabled={pending} onClick={onHistory}>
                            Historial
                        </button>
                    </>
                )}
            </header>
            <div className="cash-open-body">
                <section className="cash-col" aria-label="Caja">
                    <h2 className="cash-h">Caja</h2>
                    {loadError && (
                        <p className="error" role="alert">
                            {loadError}{' '}
                            {loadRetry && (
                                <button type="button" className="btn" onClick={() => void loadRegisters()}>
                                    Reintentar
                                </button>
                            )}
                        </p>
                    )}
                    {!registers && !loadError && <p className="muted">Cargando cajas…</p>}
                    <div className="cash-registers">
                        {registers?.map((r) => {
                            const who = r.activeShift ? (r.activeShift.user?.name ?? 'otro usuario') : (taken[r.id] ?? null);
                            return (
                                <button key={r.id} type="button" className="btn cash-register" aria-pressed={registerId === r.id} disabled={!!who} onClick={() => choose(r.id)}>
                                    <strong>{r.name}</strong>
                                    <span className="muted">{who ? `En uso · ${who}` : 'Libre'}</span>
                                </button>
                            );
                        })}
                    </div>
                </section>
                <section className="cash-col cash-float" aria-label="Fondo inicial">
                    {counting ? (
                        <OpeningCount
                            onCancel={() => setCounting(false)}
                            onUse={(total) => {
                                edit(String(total));
                                setCounting(false);
                            }}
                        />
                    ) : (
                        <>
                            <h2 className="cash-h">Fondo inicial</h2>
                            <div className="cash-amount cash-num" aria-live="polite">
                                {money(amount ?? 0)}
                            </div>
                            <div className="cash-chips" role="group" aria-label="Montos rápidos">
                                {suggested != null && (
                                    <button type="button" className="btn" onClick={() => edit(String(suggested))}>
                                        {`Sugerido ${money(suggested)}`}
                                    </button>
                                )}
                                {ROUND_AMOUNTS.map((a) => (
                                    <button key={a} type="button" className="btn" onClick={() => edit(String(a))}>
                                        {money(a)}
                                    </button>
                                ))}
                                <button type="button" className="btn" onClick={() => setCounting(true)}>
                                    Contar billetes
                                </button>
                            </div>
                            <Keypad onKey={(k) => edit(typeKey(typed, k))} />
                        </>
                    )}
                </section>
            </div>
            {error && (
                <p className="error cash-notice" role="alert">
                    {error}{' '}
                    {failed && (
                        <button type="button" className="btn" disabled={pending} onClick={() => void submit()}>
                            Reintentar
                        </button>
                    )}
                </p>
            )}
            {!counting && (
                <footer className="cash-foot">
                    <button type="button" className="btn btn-primary cash-main" disabled={!canOpen} onClick={() => void submit()}>
                        {label}
                    </button>
                </footer>
            )}
        </main>
    );
}
