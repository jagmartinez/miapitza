import { useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import { can } from '../../../core/permissions';
import type { LoginUser } from '../../../core/session';
import { httpStatus } from '../../../core/httpErrors';
import { isOnline } from '../../../data/useOnline';
import type { Json, OrderRef, WaiterApi } from '../../../data/waiterApi';
import { IconBackspace, IconX } from '../../../ui/Icon';
import { money, type ServerLine } from '../order/orderModel';
import { amountToPercent, clampDiscount, inferTaxRate, newTotal, percentToAmount, QUICK_PERCENTS, REASONS, type Reason } from './discountMath';
import { fmtPercent, SupervisorAuthScreen } from './SupervisorAuthScreen';
import './discount.css';

export type DiscountApi = Pick<WaiterApi, 'pricing' | 'authorizeDiscount' | 'supervisors' | 'discountLimit' | 'validateCoupon'>;

/** Fixed sizes (dp) so the sheet fits 1024×600 and 1280×800 with no page scroll; tests add them up. */
export const LAYOUT = { header: 56, footer: 64, left: 250, segmented: 54, quick: 48, reasons: 104, summary: 56, display: 72, keypad: 216, keypadActions: 48 } as const;
const fixed = (height: number) => ({ 'data-fixed': height, style: { height } });

interface Props {
    api: DiscountApi;
    user: LoginUser;
    orderId: OrderRef;
    branchId: number | null;
    order: Json | null;
    lines: ServerLine[];
    /** Promotions as the order screen loaded them (informational). */
    promotions: unknown;
    onClose: () => void;
    /** The server accepted a change: reload the order. */
    onApplied: () => Promise<void> | void;
}

type Mode = 'percent' | 'amount';
interface AuthRequest {
    amount: number;
    limitPercent: number;
    requestedPercent: number;
    reason: Reason;
}

const num = (v: unknown) => Number(v) || 0;

function promoNames(promotions: unknown): string[] {
    if (!Array.isArray(promotions)) return [];
    return (promotions as Json[])
        .filter((p) => p && p.active !== false && p.scheduleActiveNow !== false && typeof p.name === 'string' && p.name)
        .map((p) => String(p.name))
        .slice(0, 12);
}

export function DiscountSheet({ api, user, orderId, branchId, order, lines, promotions, onClose, onApplied }: Props) {
    const subtotal = lines.reduce((n, l) => n + l.subtotal, 0);
    const currentDiscount = num(order?.discount);
    const currentCode = typeof order?.discountCode === 'string' && order.discountCode ? String(order.discountCode) : null;
    const taxRate = inferTaxRate({ subtotal, discount: currentDiscount, tax: num(order?.tax) });
    const tip = num(order?.tipAmount);

    const canApply = can(user, 'orders.discount.apply');
    const [limit, setLimit] = useState<number | null>(canApply ? null : 0); // the server gives a user without the permission a limit of 0
    const [mode, setMode] = useState<Mode>('percent');
    const [value, setValue] = useState<number | null>(null);
    const [custom, setCustom] = useState(false);
    const [keypad, setKeypad] = useState<string | null>(null); // text typed in the "Otro" keypad; null = closed
    const [reason, setReason] = useState<Reason | null>(null);
    const [coupon, setCoupon] = useState('');
    const [couponNote, setCouponNote] = useState<{ ok: boolean; text: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [auth, setAuth] = useState<AuthRequest | null>(null);
    const busyRef = useRef(false);
    const alive = useRef(true);

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    useEffect(() => {
        if (!canApply) return;
        api.discountLimit().then(
            (r) => alive.current && setLimit(typeof r?.limitPercent === 'number' ? r.limitPercent : null),
            () => undefined, // the limit is a hint; the server decides
        );
    }, [api, canApply]);

    const code = coupon.trim().toUpperCase();
    const amount = value == null ? 0 : mode === 'percent' ? percentToAmount(subtotal, value) : clampDiscount(value, subtotal);
    const percent = amountToPercent(amount, subtotal);
    const total = newTotal({ subtotal, discount: amount, taxRate, tip });
    // The server keeps one or the other: a coupon clears the manual discount and a manual one clears the code.
    const replaceWarning =
        code && currentDiscount > 0 && !currentCode
            ? 'Un cupón reemplaza el descuento manual actual.'
            : amount > 0 && currentCode
              ? `Un descuento manual reemplaza el cupón ${currentCode}.`
              : null;
    const overLimit = limit != null && percent > limit;

    /** One server call at a time; a second tap while one is in flight is ignored. */
    async function guarded(action: () => Promise<void>) {
        if (busyRef.current) return;
        if (!isOnline()) {
            setError('Aplicar un descuento requiere conexión.');
            return;
        }
        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
            await action();
        } catch (cause) {
            if (!alive.current) return;
            const body = (cause as { response?: { data?: Json } } | null)?.response?.data;
            if (httpStatus(cause) === 403 && body?.code === 'DISCOUNT_AUTH_REQUIRED' && reason) {
                setAuth({ amount, limitPercent: num(body.limitPercent), requestedPercent: num(body.requestedPercent) || percent, reason });
            } else if (cause instanceof Error && cause.name === 'OrderNotSyncedError') {
                setError('El pedido aún se está sincronizando; aplicar un descuento requiere conexión.');
            } else {
                setError(getApiErrorMessage(cause));
            }
        } finally {
            busyRef.current = false;
            if (alive.current) setBusy(false);
        }
    }

    const finish = async () => {
        await onApplied();
        onClose();
    };

    const applyManual = () => {
        if (!(amount > 0)) return setError('Indica el descuento.');
        if (!reason) return setError('Elige un motivo.');
        void guarded(async () => {
            await api.pricing(orderId, { discount: amount, discountReason: reason, discountCode: null });
            await finish();
        });
    };
    const remove = () =>
        void guarded(async () => {
            await api.pricing(orderId, { discount: 0, discountCode: null });
            await finish();
        });
    const validate = () => {
        if (!code) return;
        setCouponNote(null);
        void guarded(async () => {
            const res = (await api.validateCoupon({
                code,
                orderTotal: subtotal,
                branchId: branchId ?? undefined,
                items: lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, unitPrice: l.unitPrice })),
            })) as Json;
            const ok = res?.valid === true;
            setCouponNote({ ok, text: ok ? `${res.message ? `${res.message} · ` : ''}− ${money(num(res.discount))}` : String(res?.message || 'Cupón no válido.') });
        });
    };
    const applyCoupon = () =>
        void guarded(async () => {
            await api.pricing(orderId, { discountCode: code });
            await finish();
        });

    if (auth) {
        return (
            <SupervisorAuthScreen
                api={api}
                orderId={orderId}
                request={{ ...auth, subtotal, total: newTotal({ subtotal, discount: auth.amount, taxRate, tip }) }}
                onCancel={() => setAuth(null)}
                onAuthorized={finish}
            />
        );
    }

    const typed = keypad;
    const maxTyped = mode === 'percent' ? 100 : subtotal;
    const pressKey = (k: string) =>
        setKeypad((cur) => {
            const text = cur ?? '';
            if (k === '<') return text.slice(0, -1);
            if (k === '.') return text.includes('.') || text === '' ? (text === '' ? '0.' : text) : `${text}.`;
            if (/\.\d{2}$/.test(text) || text.length >= 8) return text;
            const next = text === '0' ? k : text + k;
            return Number(next) > maxTyped ? text : next; // never more than the subtotal (or 100 %)
        });
    const typedValue = typed ? Math.min(Number(typed) || 0, mode === 'percent' ? 100 : subtotal) : 0;
    const typedPercent = mode === 'percent' ? typedValue : amountToPercent(clampDiscount(typedValue, subtotal), subtotal);
    const keypadDone = () => {
        setValue(typedValue > 0 ? typedValue : null);
        setCustom(typedValue > 0);
        setKeypad(null);
        setError(null);
    };
    const unit = mode === 'percent' ? '%' : 'C$';
    const otherLabel = custom && value != null ? `Otro · ${mode === 'percent' ? fmtPercent(value) : money(value)}` : 'Otro';

    return (
        <div className="dsheet-backdrop">
            <div className="dsheet" role="dialog" aria-modal="true" aria-label="Promociones y descuentos" data-no-page-scroll="true">
                <header className="dsheet-head" data-part="header" {...fixed(LAYOUT.header)}>
                    <h2 className="dsheet-title">
                        Promociones y descuentos
                        {order?.table && typeof order.table === 'object' && (order.table as Json).number ? <span className="muted">{`Mesa ${String((order.table as Json).number)}`}</span> : null}
                    </h2>
                    <span className="dsheet-subtotal">
                        <span className="muted">Subtotal</span>
                        <strong>{money(subtotal)}</strong>
                    </span>
                    <button type="button" className="dsheet-close" aria-label="Cerrar" onClick={onClose}>
                        <IconX size={20} stroke={1.5} aria-hidden />
                    </button>
                </header>
                <div className="dsheet-body">
                    <section className="dsheet-left" data-part="left" data-width={LAYOUT.left} aria-label="Promociones" style={{ width: LAYOUT.left }}>
                        {(currentDiscount > 0 || currentCode) && (
                            <div className="dsheet-card">
                                <span className="dsheet-cap">Aplicado ahora</span>
                                <strong>{currentCode ? `Cupón ${currentCode}` : `${money(currentDiscount)}${order?.discountReason ? ` · ${String(order.discountReason)}` : ''}`}</strong>
                            </div>
                        )}
                        {replaceWarning && (
                            <p className="dsheet-note" role="status">
                                {replaceWarning}
                            </p>
                        )}
                        <h3 className="dsheet-h">Disponibles</h3>
                        <ul className="dsheet-promos">
                            {promoNames(promotions).map((n) => (
                                <li key={n}>{n}</li>
                            ))}
                            {promoNames(promotions).length === 0 && <li className="muted">Sin promociones vigentes.</li>}
                        </ul>
                        <div className="dsheet-coupon">
                            <label className="dsheet-field">
                                <span className="dsheet-cap">Código de cupón</span>
                                <input
                                    value={coupon}
                                    maxLength={40}
                                    autoCapitalize="characters"
                                    autoComplete="off"
                                    onChange={(e) => {
                                        setCoupon(e.target.value);
                                        setCouponNote(null);
                                    }}
                                />
                            </label>
                            {couponNote && (
                                <p className={couponNote.ok ? 'dsheet-note' : 'error'} role="status">
                                    {couponNote.text}
                                </p>
                            )}
                            {couponNote?.ok ? (
                                <button type="button" className="btn btn-primary" disabled={busy} onClick={applyCoupon}>
                                    Aplicar cupón
                                </button>
                            ) : (
                                <button type="button" className="btn btn-outline" disabled={busy || !code} onClick={validate}>
                                    Validar
                                </button>
                            )}
                        </div>
                    </section>

                    <section className="dsheet-right" data-part="right" aria-label="Descuento manual">
                        {typed === null ? (
                            <>
                                <div className="seg dsheet-seg" role="group" aria-label="Tipo" {...fixed(LAYOUT.segmented)}>
                                    {(['percent', 'amount'] as const).map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            className="seg-item"
                                            aria-pressed={mode === m}
                                            onClick={() => {
                                                setMode(m);
                                                setValue(null);
                                                setCustom(false);
                                            }}
                                        >
                                            {m === 'percent' ? '%' : 'Monto'}
                                        </button>
                                    ))}
                                </div>
                                <div className="dsheet-quick" role="group" aria-label="Valores rápidos" {...fixed(LAYOUT.quick)}>
                                    {QUICK_PERCENTS.map((p) => (
                                        <button
                                            key={p}
                                            type="button"
                                            className="btn btn-outline"
                                            aria-pressed={mode === 'percent' && !custom && value === p}
                                            onClick={() => {
                                                setMode('percent');
                                                setValue(p);
                                                setCustom(false);
                                                setError(null);
                                            }}
                                        >
                                            {`${p} %`}
                                        </button>
                                    ))}
                                    <button type="button" className="btn btn-outline" aria-pressed={custom} onClick={() => setKeypad('')}>
                                        {otherLabel}
                                    </button>
                                </div>
                                <div className="dsheet-reasons" role="group" aria-label="Motivo" {...fixed(LAYOUT.reasons)}>
                                    {REASONS.map((r) => (
                                        <button
                                            key={r}
                                            type="button"
                                            className="btn btn-outline"
                                            aria-pressed={reason === r}
                                            onClick={() => {
                                                setReason(r);
                                                setError(null);
                                            }}
                                        >
                                            {r}
                                        </button>
                                    ))}
                                </div>
                                <div className="dsheet-summary" {...fixed(LAYOUT.summary)}>
                                    <span className="muted">{limit == null ? '' : `Tu límite: ${fmtPercent(limit)}`}</span>
                                    <span className={overLimit ? 'dsheet-over' : 'muted'}>
                                        {amount > 0 ? `Descuento ${money(amount)} · ${fmtPercent(percent)}${overLimit ? ' · pedirá autorización' : ''}` : 'Sin descuento manual'}
                                    </span>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="dsheet-display" {...fixed(LAYOUT.display)} aria-live="polite">
                                    <strong>{`${typed || '0'} ${unit}`}</strong>
                                    {typedPercent > (limit ?? 100) && <span className="dsheet-over">{`Supera tu límite de ${fmtPercent(limit ?? 0)}: pedirá autorización`}</span>}
                                </div>
                                <div className="dsheet-keys" {...fixed(LAYOUT.keypad)}>
                                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '<'].map((k) => (
                                        <button key={k} type="button" className="key" aria-label={k === '<' ? 'Borrar' : k} onClick={() => pressKey(k)}>
                                            {k === '<' ? <IconBackspace size={22} stroke={1.5} aria-hidden /> : k}
                                        </button>
                                    ))}
                                </div>
                                <div className="dsheet-keyactions" {...fixed(LAYOUT.keypadActions)}>
                                    <button type="button" className="btn btn-outline" onClick={() => setKeypad(null)}>
                                        Cancelar
                                    </button>
                                    <button type="button" className="btn btn-primary" onClick={keypadDone}>
                                        Listo
                                    </button>
                                </div>
                            </>
                        )}
                        {error && (
                            <p className="error" role="alert">
                                {error}
                            </p>
                        )}
                    </section>
                </div>
                <footer className="dsheet-foot" data-part="footer" {...fixed(LAYOUT.footer)}>
                    <div className="dsheet-newtotal">
                        <span className="muted">Nuevo total</span>
                        <strong>{money(amount > 0 ? total : num(order?.total))}</strong>
                    </div>
                    {(currentDiscount > 0 || currentCode) && (
                        <button type="button" className="btn btn-outline" disabled={busy} onClick={remove}>
                            Quitar descuento
                        </button>
                    )}
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={applyManual}>
                        Aplicar descuento
                    </button>
                </footer>
            </div>
        </div>
    );
}

export default DiscountSheet;
