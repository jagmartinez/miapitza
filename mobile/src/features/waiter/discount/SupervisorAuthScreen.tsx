import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import { httpStatus } from '../../../core/httpErrors';
import { isOnline } from '../../../data/useOnline';
import type { Json, OrderRef, WaiterApi } from '../../../data/waiterApi';
import { IconBackspace } from '../../../ui/Icon';
import { money } from '../order/orderModel';
import './discount.css';

export const fmtPercent = (n: number) => `${Number(n.toFixed(2))} %`;

const MIN_DIGITS = 4;
const MAX_DIGITS = 6;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const GENERIC_ERROR = 'Autorización inválida';

export interface AuthRequest {
    /** Discount in currency (what the server stores). */
    amount: number;
    limitPercent: number;
    requestedPercent: number;
    reason: string;
    subtotal: number;
    total: number;
}

interface Supervisor {
    id: number;
    name: string;
    initials: string;
    color: string | null;
}

interface Props {
    api: Pick<WaiterApi, 'supervisors' | 'authorizeDiscount'>;
    orderId: OrderRef;
    request: AuthRequest;
    onCancel: () => void;
    /** The server applied the discount; the caller reloads the order and closes. */
    onAuthorized: () => Promise<void> | void;
}

/**
 * A supervisor types their PIN on this tablet to authorize a discount above the waiter's limit.
 * It opens no session and changes no user. The PIN lives only in this component's state: it is cleared on success,
 * cancel, error and unmount, and never reaches a log, a draft, the cache, the queue or an app event.
 */
export function SupervisorAuthScreen({ api, orderId, request, onCancel, onAuthorized }: Props) {
    const [supervisors, setSupervisors] = useState<Supervisor[] | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);
    const [pin, setPin] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const alive = useRef(true);

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            setPin(''); // nothing outlives the screen
        };
    }, []);

    const load = useCallback(() => {
        setLoadFailed(false);
        api.supervisors().then(
            (list) => alive.current && setSupervisors(Array.isArray(list) ? (list as Json[]).map((s) => ({ id: s.id, name: String(s.name ?? ''), initials: String(s.initials ?? ''), color: s.color ?? null })) : []),
            () => alive.current && setLoadFailed(true),
        );
    }, [api]);
    useEffect(() => load(), [load]);

    const press = (digit: string) => {
        if (busyRef.current) return;
        setError(null);
        setPin((cur) => (cur.length < MAX_DIGITS ? cur + digit : cur));
    };

    async function authorize() {
        if (busyRef.current || selected == null || pin.length < MIN_DIGITS) return;
        if (!isOnline()) {
            setError('Autorizar un descuento requiere conexión.');
            return;
        }
        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
            await api.authorizeDiscount(orderId, { supervisorUserId: selected, pin, discount: request.amount, discountReason: request.reason });
            if (!alive.current) return;
            setPin('');
            await onAuthorized();
        } catch (cause) {
            if (!alive.current) return;
            setPin('');
            // Every rejection (wrong PIN, no permission, lockout, bad device) is the same generic 401: never say which.
            if (httpStatus(cause) === 401) setError(GENERIC_ERROR);
            else if (cause instanceof Error && cause.name === 'OrderNotSyncedError') setError('El pedido aún se está sincronizando; autorizar requiere conexión.');
            else setError(getApiErrorMessage(cause));
        } finally {
            busyRef.current = false;
            if (alive.current) setBusy(false);
        }
    }

    const cancel = () => {
        setPin('');
        onCancel();
    };

    const requested = Math.max(request.requestedPercent, 0.01);
    const withinPct = Math.min(100, (Math.min(request.limitPercent, requested) / requested) * 100);

    return (
        <div className="dsheet-backdrop">
            <div className="dsheet" role="dialog" aria-modal="true" aria-label="Autorización de supervisor" data-no-page-scroll="true">
                <div className="dsheet-body dauth">
                    <section className="dauth-left" aria-label="Descuento solicitado">
                        <p className="dauth-kicker">Se necesita autorización</p>
                        <strong className="dauth-big">{fmtPercent(request.requestedPercent)}</strong>
                        <div className="dauth-bar" role="img" aria-label={`Límite ${fmtPercent(request.limitPercent)} de ${fmtPercent(request.requestedPercent)} solicitado`}>
                            <span className="dauth-bar-ok" style={{ width: `${withinPct}%` }} />
                            <span className="dauth-bar-over" style={{ width: `${100 - withinPct}%` }} />
                        </div>
                        <div className="dauth-legend">
                            <span>{`Tu límite ${fmtPercent(request.limitPercent)}`}</span>
                            <span className="dsheet-over">{`Solicitado ${fmtPercent(request.requestedPercent)}`}</span>
                        </div>
                        <dl className="dauth-facts">
                            <div>
                                <dt>Motivo</dt>
                                <dd>{request.reason}</dd>
                            </div>
                            <div>
                                <dt>Subtotal</dt>
                                <dd>{money(request.subtotal)}</dd>
                            </div>
                            <div>
                                <dt>Descuento</dt>
                                <dd>{`− ${money(request.amount)}`}</dd>
                            </div>
                            <div>
                                <dt>Nuevo total</dt>
                                <dd>
                                    <strong>{money(request.total)}</strong>
                                </dd>
                            </div>
                        </dl>
                    </section>

                    <section className="dauth-right" aria-label="Supervisor">
                        <div className="dauth-people">
                            {loadFailed && (
                                <p className="error" role="alert">
                                    No se pudo cargar la lista de supervisores.{' '}
                                    <button type="button" className="btn" onClick={load}>
                                        Reintentar
                                    </button>
                                </p>
                            )}
                            {!loadFailed && supervisors === null && <p className="muted">Cargando…</p>}
                            {supervisors?.length === 0 && <p className="muted">No hay supervisores disponibles en esta tablet.</p>}
                            {supervisors?.map((s) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    className="avatar"
                                    aria-label={s.name}
                                    aria-pressed={selected === s.id}
                                    disabled={busy}
                                    onClick={() => {
                                        setSelected(s.id);
                                        setPin('');
                                        setError(null);
                                    }}
                                >
                                    <span className="avatar-disc">
                                        {s.initials}
                                    </span>
                                    <span>{s.name.split(' ')[0]}</span>
                                </button>
                            ))}
                        </div>
                        <div className="pin-dots" data-testid="auth-dots" data-filled={pin.length}>
                            {Array.from({ length: MAX_DIGITS }, (_, i) => (
                                <span key={i} className={i < pin.length ? 'pin-dot on' : 'pin-dot'} />
                            ))}
                        </div>
                        {error && (
                            <p className="error dauth-error" role="alert">
                                {error}
                            </p>
                        )}
                        <div className="keypad">
                            {DIGITS.map((d) => (
                                <button key={d} type="button" className="key" aria-label={d} disabled={selected == null || busy} onClick={() => press(d)}>
                                    {d}
                                </button>
                            ))}
                            <button type="button" className="key" aria-label="Borrar" disabled={selected == null || busy || !pin} onClick={() => setPin((p) => p.slice(0, -1))}>
                                <IconBackspace size={22} stroke={1.5} aria-hidden />
                            </button>
                            <button type="button" className="key" aria-label="0" disabled={selected == null || busy} onClick={() => press('0')}>
                                0
                            </button>
                            <span />
                        </div>
                    </section>
                </div>
                <footer className="dsheet-foot">
                    <button type="button" className="btn btn-outline" disabled={busy} onClick={cancel}>
                        Cancelar
                    </button>
                    <button type="button" className="btn btn-primary" disabled={busy || selected == null || pin.length < MIN_DIGITS} onClick={() => void authorize()}>
                        {`Autorizar ${fmtPercent(request.requestedPercent)}`}
                    </button>
                </footer>
            </div>
        </div>
    );
}
