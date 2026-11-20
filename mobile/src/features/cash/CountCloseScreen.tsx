import { useEffect, useRef, useState } from 'react';
import type { CashApi } from '../../data/cashApi';
import { CashError } from '../../data/cashApi';
import type { ClosePayload, ClosePreview, CountResult, ShiftSummary } from '../../data/cashTypes';
import type { Session } from '../../core/session';
import { isCashAdmin } from '../../core/permissions';
import { ownerKeyOf } from '../../data/types';
import { useOnline } from '../../data/useOnline';
import { money } from '../waiter/order/orderModel';
import { Keypad } from '../waiter/payment/controls';
import { DENOMINATIONS, buildClosePayload, buildCountBody, countedTotals, emptyBreakdown, expectedFromSummary, type Breakdown } from './cashMath';
import type { CountMode } from './CashHome';
import { DenominationColumn, type DenomRow } from './DenominationColumn';
import './cash.css';

export interface CountCloseProps {
    api: Pick<CashApi, 'summary' | 'settings' | 'count' | 'previewClose' | 'close'>;
    session: Session;
    shiftId: number;
    mode: CountMode;
    onBack: () => void;
    /** The shift is closed (or was already closed by this user): go to the close report. */
    onClosed: (shiftId: number) => void;
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
    op: 'close' | 'count';
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

function CountClose({ api, session, shiftId, mode, onBack, onClosed }: CountCloseProps) {
    const online = useOnline();
    const admin = isCashAdmin(session.user);
    const [breakdown, setBreakdown] = useState<Breakdown>(emptyBreakdown);
    const [rateText, setRateText] = useState('');
    const [notes, setNotes] = useState('');
    const [sel, setSel] = useState<Target | null>(null);
    const [summary, setSummary] = useState<ShiftSummary | null>(null);
    const [validated, setValidated] = useState<{ key: string; result: ClosePreview } | null>(null);
    const [saved, setSaved] = useState<CountResult | null>(null);
    const [pending, setPending] = useState<'validate' | 'count' | 'close' | null>(null);
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
            (s) => live && setRateText((cur) => (cur === '' ? String(s.exchangeRateUsd) : cur)),
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

    const edited = () => {
        setError(null);
        setRetry(null);
        setSaved(null);
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
        if (cause instanceof CashError) {
            setError(cause.code === 'CASH_DIFF_EXCEEDS_TOLERANCE' ? SUPERVISOR : cause.message || 'No se pudo completar.');
            setRetry(null); // a definitive answer ends the action
        } else {
            setError(cause instanceof Error && cause.message ? `${cause.message}. Puedes reintentar.` : 'No se pudo completar. Puedes reintentar.');
            setRetry(again);
        }
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

    const send = async (op: 'close' | 'count', payload: ClosePayload, id: string) => {
        if (busy.current) return;
        busy.current = true;
        setPending(op);
        setError(null);
        setRetry(null);
        try {
            if (op === 'count') {
                const { endAmount: _e, notes: _n, forceClose: _f, ...body } = payload;
                void _e;
                void _n;
                void _f;
                const r = await api.count(shiftId, body, { actionId: id });
                if (alive.current) setSaved(r);
            } else {
                await api.close(shiftId, payload, { actionId: id }); // { alreadyClosed: true } is a success too
                if (alive.current) onClosed(shiftId);
            }
        } catch (cause) {
            if (alive.current) fail(cause, { op, payload, id });
        } finally {
            busy.current = false;
            if (alive.current) setPending(null);
        }
    };

    const saveCount = () => {
        if (!can) return;
        setSaved(null);
        void send('count', { ...buildCountBody(breakdown, rate), endAmount: totals.totalC / 100 }, newId());
    };
    const close = (force: boolean) => {
        if (!can || !result) return;
        void send('close', buildClosePayload(breakdown, rate, notes, force), newId());
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
    const status = result?.status ?? saved?.status;
    const title = mode === 'close' ? 'Cerrar turno' : 'Arqueo parcial';

    return (
        <main className="cash" data-testid="cash-count" data-mode={mode}>
            <header className="cash-bar">
                <button type="button" className="btn" aria-label="Volver" onClick={onBack}>
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
                    {saved && (
                        <p className="muted" data-testid="count-saved">
                            {`Arqueo guardado${status ? ` · ${STATUS_LABEL[status]}` : ''}`}
                            {admin && typeof saved.difference === 'number' ? ` · ${signed(saved.difference)}` : ''}
                        </p>
                    )}
                    {noteRequired && <span className="muted">La nota es obligatoria.</span>}
                    <textarea className="cash-notes" aria-label="Nota" placeholder="Nota del cierre" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                    {exceeds && !admin && <p className="error">{SUPERVISOR}</p>}
                    {error && (
                        <p className="error" role="alert">
                            {error}
                        </p>
                    )}
                    {!rateOk && <span className="muted">Indica el tipo de cambio.</span>}
                    <div className="cash-panel-actions">
                        {retry && (
                            <button type="button" className="btn" disabled={!online || pending !== null} onClick={() => void send(retry.op, retry.payload, retry.id)}>
                                Reintentar
                            </button>
                        )}
                        <button type="button" className="btn" disabled={!can} onClick={() => void validate()}>
                            {pending === 'validate' ? 'Validando…' : 'Validar'}
                        </button>
                        <button type="button" className="btn" disabled={!can} onClick={saveCount}>
                            {pending === 'count' ? 'Guardando…' : 'Guardar arqueo'}
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
                    </div>
                </aside>
            </div>
        </main>
    );
}
