import { useCallback, useEffect, useState } from 'react';
import type { ActionOpts, CashApi } from '../../data/cashApi';
import type { CashMovementRow, CashShiftInfo, MovementInput, ShiftSummary } from '../../data/cashTypes';
import type { Session } from '../../core/session';
import { isCashAdmin } from '../../core/permissions';
import { useOnline } from '../../data/useOnline';
import { money } from '../waiter/order/orderModel';
import { cashErrorText, isRetryable } from './cashErrors';
import { expectedFromSummary } from './cashMath';
import type { CountMode } from './CashHome';
import { MovementSheet } from './MovementSheet';
import { CASH_POLL_MS } from './useCashShift';
import './cash.css';

export interface ActiveShiftProps {
    api: Pick<CashApi, 'summary'>;
    session: Session;
    shift: CashShiftInfo;
    /** The shift is from a previous day: it must be closed before cash payments. */
    requiresClose?: boolean;
    closeMessage?: string | null;
    addMovement: (shiftId: number, input: MovementInput, opts?: ActionOpts) => Promise<unknown>;
    onBack: () => void;
    /** "Arqueo parcial" / "Cerrar turno": the count screen takes it from here. */
    onCount: (shiftId: number, mode: CountMode) => void;
    onHistory?: () => void;
    /** "Turnos abiertos" (ADMIN / SUPERADMIN only: the caller passes it just for them). */
    onSupervise?: () => void;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const timeOf = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });
};
/** Largest-remainder rounding: the shown percentages always add up to 100. */
function percents(parts: number[]): string[] {
    const total = parts.reduce((n, p) => n + p, 0);
    if (total <= 0) return parts.map(() => '—');
    const raw = parts.map((p) => (p / total) * 100);
    const out = raw.map(Math.floor);
    let left = 100 - out.reduce((n, p) => n + p, 0);
    raw.map((r, i) => ({ i, f: r - Math.floor(r) }))
        .sort((a, b) => b.f - a.f || a.i - b.i)
        .forEach(({ i }) => {
            if (left > 0) {
                out[i] += 1;
                left -= 1;
            }
        });
    return out.map((p) => `${p}%`);
}

/** Cash the sale itself brought in is already in the sales cards: the list shows what the cashier moved by hand. */
const isManual = (m: CashMovementRow) => !/PAY-/.test(String(m.reference ?? ''));

function Card({ title, amount, note }: { title: string; amount: string; note: string }) {
    return (
        <div className="cash-card" data-card>
            <span className="muted">{title}</span>
            <strong className="cash-num cash-card-amount">{amount}</strong>
            <span className="muted cash-num">{note}</span>
        </div>
    );
}

/** Active shift (spec 7.3.2b). The count is blind: "Debe haber" is rendered for ADMIN / SUPERADMIN only, from the server value. */
export function ActiveShiftScreen({ api, session, shift, requiresClose = false, closeMessage = null, addMovement, onBack, onCount, onHistory, onSupervise }: ActiveShiftProps) {
    const online = useOnline();
    const admin = isCashAdmin(session.user);
    const [data, setData] = useState<ShiftSummary | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadRetry, setLoadRetry] = useState(false);
    const [tick, setTick] = useState(0);
    const [sheet, setSheet] = useState<'IN' | 'OUT' | null>(null);

    useEffect(() => {
        let live = true;
        api.summary(shift.id).then(
            (d) => {
                if (!live) return;
                setData(d);
                setLoadError(null);
            },
            (cause) => {
                if (!live) return;
                setLoadError(cashErrorText(cause, 'No se pudo cargar el resumen.'));
                setLoadRetry(isRetryable(cause));
            },
        );
        return () => {
            live = false;
        };
    }, [api, shift.id, tick]);

    useEffect(() => {
        const timer = setInterval(() => setTick((t) => t + 1), CASH_POLL_MS);
        return () => clearInterval(timer);
    }, []);

    const reload = useCallback(() => setTick((t) => t + 1), []);

    const s = data?.summary;
    const by = s?.salesByMethod;
    const sales = by ? by.cash + by.card + by.transfer : null;
    const [pCash, pCard, pTransfer] = by ? percents([by.cash, by.card, by.transfer]) : ['—', '—', '—'];
    const movements = (data?.shift.movements ?? []).filter(isManual);
    const who = (data?.shift.user ?? shift.user)?.name;
    const register = data?.shift.cashRegister?.name ?? shift.cashRegister?.name ?? 'Caja';
    // Blind rule: the expected cash is read from the server value and only for ADMIN / SUPERADMIN; never derived.
    const expected = admin ? expectedFromSummary(data) : null;

    return (
        <main className="cash" data-testid="active-shift">
            <header className="cash-bar">
                <button type="button" className="btn" aria-label="Volver" onClick={onBack}>
                    ←
                </button>
                <div className="cash-head">
                    <strong className="cash-title">{`${register} · Abierto`}</strong>
                    <span className="muted cash-num">{`${who ?? ''}${who ? ' · ' : ''}desde ${timeOf(shift.startDate)}`}</span>
                </div>
                <span className="grow" />
                {!online && (
                    <span className="cash-offline" role="status">
                        Requiere conexión
                    </span>
                )}
                <button type="button" className="btn" disabled={!online} onClick={() => setSheet('IN')}>
                    Entrada
                </button>
                <button type="button" className="btn" disabled={!online} onClick={() => setSheet('OUT')}>
                    Salida
                </button>
                <button type="button" className="btn" disabled={!online} onClick={() => onCount(shift.id, 'partial')}>
                    Arqueo parcial
                </button>
                {onSupervise && (
                    <button type="button" className="btn" aria-label="Turnos abiertos" onClick={onSupervise}>
                        Turnos abiertos
                    </button>
                )}
                {onHistory && (
                    <button type="button" className="btn" aria-label="Historial de turnos" onClick={onHistory}>
                        Historial
                    </button>
                )}
            </header>
            {(requiresClose || loadError) && (
                <p className={requiresClose ? 'cash-notice cash-warn' : 'error cash-notice'} role={loadError ? 'alert' : 'status'}>
                    {requiresClose ? (closeMessage ?? 'Este turno es de un día anterior: ciérralo antes de cobrar en efectivo.') : loadError}
                    {loadError && loadRetry && (
                        <>
                            {' '}
                            <button type="button" className="btn" onClick={reload}>
                                Reintentar
                            </button>
                        </>
                    )}
                </p>
            )}
            <div className="cash-active-body">
                <section className="cash-left">
                    <div className="cash-cards" role="group" aria-label="Resumen de ventas">
                        <Card title="Ventas" amount={sales != null ? money(sales) : '—'} note={by ? `${by.paymentCount} ${by.paymentCount === 1 ? 'cobro' : 'cobros'}` : ' '} />
                        <Card title="Efectivo" amount={by ? money(by.cash) : s ? money(num(s.totalSalesCash)) : '—'} note={pCash} />
                        <Card title="Tarjeta" amount={by ? money(by.card) : '—'} note={pCard} />
                        <Card title="Transferencia" amount={by ? money(by.transfer) : '—'} note={pTransfer} />
                    </div>
                    <h2 className="cash-h">Movimientos de efectivo</h2>
                    <ul className="cash-moves" aria-label="Movimientos de efectivo">
                        {data && movements.length === 0 && <li className="muted">Sin movimientos de efectivo</li>}
                        {movements.map((m) => (
                            <li key={m.id} className="cash-move">
                                <span className="cash-move-text">{m.description || (m.type === 'IN' ? 'Entrada' : 'Salida')}</span>
                                <span className="muted cash-num">{timeOf(m.createdAt)}</span>
                                <strong className={`cash-num ${m.type === 'OUT' ? 'cash-out' : ''}`}>{`${m.type === 'OUT' ? '−' : '+'}${money(num(m.amount))}`}</strong>
                            </li>
                        ))}
                    </ul>
                </section>
                <aside className="cash-right" aria-label="Efectivo en caja">
                    <h2 className="cash-h">Efectivo en caja</h2>
                    {s && (
                        <dl className="cash-lines">
                            <div>
                                <dt>Fondo inicial</dt>
                                <dd className="cash-num">{money(num(s.startAmount))}</dd>
                            </div>
                            <div>
                                <dt>Ventas en efectivo</dt>
                                <dd className="cash-num">{money(num(s.totalSalesCash))}</dd>
                            </div>
                            <div>
                                <dt>Entradas</dt>
                                <dd className="cash-num">{`+${money(num(s.otherIncome))}`}</dd>
                            </div>
                            <div>
                                <dt>Salidas</dt>
                                <dd className="cash-num">{`−${money(num(s.otherOutflows))}`}</dd>
                            </div>
                            {num(s.cashRefunds) > 0 && (
                                <div>
                                    <dt>Devoluciones</dt>
                                    <dd className="cash-num">{`−${money(num(s.cashRefunds))}`}</dd>
                                </div>
                            )}
                        </dl>
                    )}
                    {admin ? (
                        <div className="cash-expected">
                            <span className="muted">Debe haber</span>
                            <strong className="cash-num" data-testid="expected">
                                {expected != null ? money(expected) : '—'}
                            </strong>
                        </div>
                    ) : (
                        <p className="muted cash-blind">Cuenta ciega: el total esperado no se muestra.</p>
                    )}
                </aside>
            </div>
            <footer className="cash-foot">
                <button type="button" className="btn btn-primary cash-main" disabled={!online} onClick={() => onCount(shift.id, 'close')}>
                    Cerrar turno
                </button>
            </footer>
            {sheet && (
                <MovementSheet
                    shiftId={shift.id}
                    type={sheet}
                    addMovement={addMovement}
                    onClose={() => setSheet(null)}
                    onSaved={() => {
                        setSheet(null);
                        reload();
                    }}
                />
            )}
        </main>
    );
}
