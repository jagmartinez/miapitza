import { useEffect, useRef, useState } from 'react';
import type { CashApi } from '../../data/cashApi';
import { CashError } from '../../data/cashApi';
import type { ClosePayload, ClosePreview, ShiftSummary } from '../../data/cashTypes';
import type { Session } from '../../core/session';
import { useExtendedIdleLock } from '../../core/IdleLockBoundary';
import { isCashAdmin } from '../../core/permissions';
import { ownerKeyOf } from '../../data/types';
import { useOnline } from '../../data/useOnline';
import { money } from '../waiter/order/orderModel';
import { Keypad } from '../waiter/payment/controls';
import { cashErrorText, isRetryable } from './cashErrors';
import { DENOMINATIONS, buildClosePayload, countedTotals, emptyBreakdown, expectedFromSummary, type Breakdown } from './cashMath';
import type { CountMode } from './CashHome';
import { DenominationColumn, type DenomRow } from './DenominationColumn';
import '../waiter/tables/sheets.css';
import './cash.css';

export interface CountCloseProps {
    api: Pick<CashApi, 'summary' | 'settings' | 'previewClose' | 'close'>;
    session: Session;
    shiftId: number;
    mode: CountMode;
    onBack: () => void;
    /** The shift is closed (or was already closed by this user): go to the close report. */
    onClosed: (shiftId: number) => void;
    /** A close is about to be sent: if the cashier lands back in Caja before knowing the outcome, Caja checks the shift. */
    onCloseAttempt?: (shiftId: number) => void;
}

type Group = keyof Breakdown;
type Target = { kind: 'denom'; group: Group; denom: number } | { kind: 'rate' };
type Status = 'CUADRADO' | 'SOBRANTE' | 'FALTANTE';

const STATUS_LABEL: Record<Status, string> = { CUADRADO: 'Cuadrado', SOBRANTE: 'Sobrante', FALTANTE: 'Faltante' };
const SUPERVISOR = 'La diferencia excede la tolerancia. Llama a un supervisor.';
const label = (n: number) => String(n).replace(/\.0+$/, '');
const signed = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${money(Math.abs(d))}`;
const newId = () => crypto.randomUUID();

/** A failed send that may or may not have reached the server: "Reintentar" resends exactly this with the same action id. */
interface Retry {
    op: 'close';
    payload: ClosePayload;
    id: string;
}

/**
 * Blind arqueo and shift close (spec 7.3.2b). Blind rule: expected cash and difference are rendered for ADMIN / SUPERADMIN
 * only, from server values and never derived; everyone else sees the totals they counted and the result label.
 * Session fence: the count lives in this component's state only (never persisted) and the screen is keyed by owner.
 */
export function CountCloseScreen(props: CountCloseProps) {
    return <CountClose key={ownerKeyOf(props.session) ?? ''} {...props} />;
}

function CountClose({ api, session, shiftId, mode, onBack, onClosed, onCloseAttempt }: CountCloseProps) {
    const online = useOnline();
    const admin = isCashAdmin(session.user);
    const [breakdown, setBreakdown] = useState<Breakdown>(emptyBreakdown);
    const [rateText, setRateText] = useState('');
    const [notes, setNotes] = useState('');
    const [sel, setSel] = useState<Target | null>(null);
    const [summary, setSummary] = useState<ShiftSummary | null>(null);
    const [validated, setValidated] = useState<{ key: string; result: ClosePreview } | null>(null);
    const [pending, setPending] = useState<'validate' | 'close' | null>(null);
    const [confirmLeave, setConfirmLeave] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState<Retry | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const fresh = useRef(true);
    const busy = useRef(false);
    const alive = useRef(true);

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false; // lock / switch / leaving: a late answer touches nothing
        };
    }, []);

    useEffect(() => {
        let live = true;
        api.settings().then(
            (s) => live && setRateText((cur) => (cur === '' && Number.isFinite(Number(s.exchangeRateUsd)) ? String(Number(Number(s.exchangeRateUsd).toFixed(4))) : cur)),
            () => live && setLoadError('No se pudo cargar el tipo de cambio: escríbelo.'),
        );
        api.summary(shiftId).then(
            (d) => live && setSummary(d),
            () => undefined, // header details only; the count works without them
        );
        return () => {
            live = false;
        };
    }, [api, shiftId]);

    const rate = Number(rateText) || 0;
    const totals = countedTotals(breakdown, rate);
    const rateOk = totals.usd === 0 || rate > 0;
    const payloadKey = JSON.stringify(buildClosePayload(breakdown, rate, ''));
    // Editing the count or the rate changes the key: a stale validation is never shown nor used.
    const result = validated && validated.key === payloadKey ? validated.result : null;
    const noteRequired = !!result && (result.requiresNote === true || result.exceedsTolerance === true);
    const exceeds = result?.exceedsTolerance === true;
    const hasNote = notes.trim() !== '';
    const can = online && rateOk && pending === null;
    // A count with entries is work in progress: leaving asks first, and the idle lock waits longer (it still locks and clears).
    const hasEntries = totals.totalC > 0 || totals.usd > 0;
    useExtendedIdleLock(hasEntries);

    const edited = () => {
        setError(null);
        setRetry(null);
    };

    const key = (k: string) => {
        if (!sel) return;
        const reset = fresh.current;
        fresh.current = false;
        edited();
        if (sel.kind === 'rate') {
            if (k === '.' && (reset || rateText.includes('.'))) {
                if (reset) setRateText('0.');
                return;
            }
            const base = reset ? '' : rateText;
            const next = k === '<' ? base.slice(0, -1) : base + k;
            if (/^\d{0,3}(\.\d{0,4})?$/.test(next)) setRateText(next);
            return;
        }
        if (k === '.') return;
        const { group, denom } = sel;
        setBreakdown((cur) => {
            const prev = reset ? '' : String(cur[group][String(denom)] ?? 0);
            const next = k === '<' ? prev.slice(0, -1) : prev === '0' ? k : prev + k;
            const n = Math.min(Number(next || 0), 9999);
            return { ...cur, [group]: { ...cur[group], [String(denom)]: n } };
        });
    };
    const select = (t: Target) => {
        fresh.current = true;
        setSel(t);
    };

    const fail = (cause: unknown, again: Retry | null) => {
        if (cause instanceof CashError && cause.code === 'CASH_DIFF_EXCEEDS_TOLERANCE') setError(SUPERVISOR);
        else setError(cashErrorText(cause, 'No se pudo completar.'));
        // A definitive answer ends the action; only an unknown outcome (network, timeout, 5xx) may be retried with the same id.
        setRetry(isRetryable(cause) ? again : null);
    };

    const validate = async () => {
        if (!can || busy.current) return;
        busy.current = true;
        setPending('validate');
        setError(null);
        setRetry(null);
        const at = payloadKey;
        try {
            const r = await api.previewClose(shiftId, buildClosePayload(breakdown, rate, ''), { actionId: newId() });
            if (alive.current) setValidated({ key: at, result: r });
        } catch (cause) {
            if (alive.current) fail(cause, null);
        } finally {
            busy.current = false;
            if (alive.current) setPending(null);
        }
    };

    const send = async (payload: ClosePayload, id: string) => {
        if (busy.current) return;
        busy.current = true;
        setPending('close');
        setError(null);
        setRetry(null);
        onCloseAttempt?.(shiftId);
        try {
            await api.close(shiftId, payload, { actionId: id }); // { alreadyClosed: true } is a success too
            if (alive.current) onClosed(shiftId);
        } catch (cause) {
            if (alive.current) fail(cause, { op: 'close', payload, id });
        } finally {
            busy.current = false;
            if (alive.current) setPending(null);
        }
    };

    const close = (force: boolean) => {
        if (!can || !result) return;
        void send(buildClosePayload(breakdown, rate, notes, force), newId());
    };

    const leave = () => {
        if (pending !== null) return;
        if (hasEntries) setConfirmLeave(true);
        else onBack();
    };

    const row = (group: Group, denom: number, kind: string, currency: string): DenomRow => {
        const n = breakdown[group][String(denom)] ?? 0;
        const cents = Math.round(denom * n * 100);
        const sub = group === 'usdBills' ? `US$ ${(cents / 100).toLocaleString('en-US')}` : money(cents / 100);
        return { key: `${group}:${denom}`, name: `${kind} ${currency} ${label(denom)}`, label: `${currency} ${label(denom)}`, count: n, subtotal: sub, selected: sel?.kind === 'denom' && sel.group === group && sel.denom === denom };
    };
    const onSelect = (k: string) => {
        const [group, d] = k.split(':');
        select({ kind: 'denom', group: group as Group, denom: Number(d) });
    };

    // Blind rule: only ADMIN / SUPERADMIN read the server's expected amount and difference.
    const expected = admin ? (result?.expectedAmount ?? expectedFromSummary(summary)) : null;
    const difference = admin && result && typeof result.difference === 'number' ? result.difference : null;
    const register = summary?.shift.cashRegister?.name ?? 'Caja';
    const cashier = summary?.shift.user?.name ?? session.user.name;
        const title = mode === 'close' ? 'Cerrar turno' : 'Arqueo parcial';

    return (
        <main className="cash" data-testid="cash-count" data-mode={mode}>
            <header className="cash-bar">
                <button type="button" className="btn" aria-label="Volver" disabled={pending !== null} onClick={leave}>
                    ←
                </button>
                <div className="cash-head">
                    <strong className="cash-title">{`${title} · ${register}`}</strong>
                    <span className="muted cash-num">{cashier}</span>
                </div>
                <span className="grow" />
                {!online && (
                    <span className="cash-offline" role="status">
                        Requiere conexión
                    </span>
                )}
                <label className="cash-rate">
                    <span className="muted">TC C$/US$</span>
                    <input className="cash-num" aria-label="Tipo de cambio" readOnly inputMode="none" value={rateText} placeholder="0" data-selected={sel?.kind === 'rate'} onClick={() => select({ kind: 'rate' })} onFocus={() => select({ kind: 'rate' })} />
                </label>
            </header>
            {loadError && <p className="error cash-notice">{loadError}</p>}
            <div className="cash-count-body">
                <DenominationColumn
                    title="Córdobas"
                    groups={[
                        { heading: 'Billetes', rows: DENOMINATIONS.nioBills.map((d) => row('nioBills', d, 'Billete', 'C$')) },
                        { heading: 'Monedas', rows: DENOMINATIONS.nioCoins.map((d) => row('nioCoins', d, 'Moneda', 'C$')) },
                    ]}
                    onSelect={onSelect}
                    footer={[{ label: 'Córdobas', value: money((totals.nioBillsC + totals.nioCoinsC) / 100) }]}
                />
                <div className="cash-count-mid">
                    <DenominationColumn
                        title="Dólares"
                        groups={[{ rows: DENOMINATIONS.usdBills.map((d) => row('usdBills', d, 'Billete', 'US$')) }]}
                        onSelect={onSelect}
                        footer={[
                            { label: 'Total US$', value: `US$ ${totals.usd.toLocaleString('en-US')}` },
                            { label: 'En córdobas', value: money(totals.usdInNioC / 100) },
                        ]}
                    />
                    <Keypad onKey={key} disabled={!sel} />
                </div>
                <aside className="cash-count-panel" aria-label="Resultado del arqueo">
                    <dl className="cash-lines">
                        <div>
                            <dt>Córdobas contados</dt>
                            <dd className="cash-num">{money((totals.nioBillsC + totals.nioCoinsC) / 100)}</dd>
                        </div>
                        <div>
                            <dt>Dólares en C$</dt>
                            <dd className="cash-num">{money(totals.usdInNioC / 100)}</dd>
                        </div>
                        <div className="cash-total">
                            <dt>Total contado</dt>
                            <dd className="cash-num" data-testid="total-counted">
                                {money(totals.totalC / 100)}
                            </dd>
                        </div>
                        {admin && (
                            <>
                                <div>
                                    <dt>Debe haber</dt>
                                    <dd className="cash-num" data-testid="expected">
                                        {expected == null ? '—' : money(expected)}
                                    </dd>
                                </div>
                                <div>
                                    <dt>Diferencia</dt>
                                    <dd className={`cash-num ${difference == null || difference === 0 ? '' : difference < 0 ? 'cash-out' : 'cash-warn'}`} data-testid="difference">
                                        {difference == null ? '—' : signed(difference)}
                                    </dd>
                                </div>
                            </>
                        )}
                    </dl>
                    {result && (
                        <p className={`cash-result ${result.status === 'FALTANTE' ? 'cash-out' : result.status === 'SOBRANTE' ? 'cash-warn' : ''}`} data-testid="count-result">
                            {result.status ? STATUS_LABEL[result.status] : 'Validado'}
                        </p>
                    )}
                    {mode === 'partial' && <p className="muted">Verificación — no se registra</p>}
                    {noteRequired && <span className="muted">La nota es obligatoria.</span>}
                    <textarea className="cash-notes" aria-label="Nota" placeholder="Nota del cierre" rows={2} value={notes} onChange={(e) => {
                            // A new note is a new close: the failed one (and its id) is dropped.
                            setNotes(e.target.value);
                            edited();
                        }}
                    />
                    {exceeds && !admin && <p className="error">{SUPERVISOR}</p>}
                    {error && (
                        <p className="error" role="alert">
                            {error}
                        </p>
                    )}
                    {!rateOk && <span className="muted">Indica el tipo de cambio.</span>}
                </aside>
            </div>
                <footer className="cash-count-foot" aria-label="Acciones del arqueo">
                    {retry && (
                        <button type="button" className="btn" disabled={!online || pending !== null} onClick={() => void send(retry.payload, retry.id)}>
                            Reintentar
                        </button>
                    )}
                    <button type="button" className="btn" disabled={!can} onClick={() => void validate()}>
                        {pending === 'validate' ? 'Validando…' : 'Validar'}
                    </button>
                    {mode === 'close' &&
                        (exceeds && admin ? (
                            <button type="button" className="btn btn-primary" disabled={!can || !hasNote} onClick={() => close(true)}>
                                {pending === 'close' ? 'Cerrando…' : 'Forzar cierre'}
                            </button>
                        ) : (
                            <button type="button" className="btn btn-primary" disabled={!can || !result || exceeds || (noteRequired && !hasNote)} onClick={() => close(false)}>
                                {pending === 'close' ? 'Cerrando…' : 'Cerrar turno'}
                            </button>
                        ))}
                </footer>
            {confirmLeave && (
                <div className="sheet-backdrop">
                    <div className="sheet cash-confirm" role="alertdialog" aria-modal="true" aria-label="Descartar conteo">
                        <h2 className="sheet-title">¿Descartar el conteo?</h2>
                        <p className="muted">Lo que contaste se perderá.</p>
                        <div className="cash-sheet-actions">
                            <button type="button" className="btn" onClick={() => setConfirmLeave(false)}>
                                Seguir contando
                            </button>
                            <button type="button" className="btn btn-primary" onClick={onBack}>
                                Descartar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
