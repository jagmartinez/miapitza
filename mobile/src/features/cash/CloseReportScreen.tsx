import { useEffect, useRef, useState } from 'react';
import type { CashApi } from '../../data/cashApi';
import type { ShiftReport } from '../../data/cashTypes';
import type { Session } from '../../core/session';
import { closeTicket } from '../print/closeTicket';
import { printOrShare, printOut as defaultPrintOut, type PrintOut } from '../print/printOut';
import { money } from '../waiter/order/orderModel';
import { reportView, type ReportView, type SalesByMethod } from './reportModel';
import './cash.css';

export interface CloseReportProps {
    api: Pick<CashApi, 'report' | 'summary'>;
    session: Session;
    shiftId: number;
    /** After a close: "Listo" goes back to the tables. */
    onDone?: () => void;
    /** From the history: back to the list. */
    onBack?: () => void;
    printer?: PrintOut;
}

const timeOf = (iso: string | null) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' }) : '';
};
const dateOf = (iso: string | null) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
};
const dash = (n: number | null) => (n == null ? '—' : money(n));
const signed = (n: number | null) => (n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`);

function tagOf(v: ReportView): { text: string; tone: 'ok' | 'bad' | 'warn' } | null {
    if (!v.status || v.difference == null) return null;
    if (v.status === 'CUADRADO') return { text: 'Cuadrado', tone: 'ok' };
    return { text: `${v.status === 'SOBRANTE' ? 'Sobrante' : 'Faltante'} ${money(Math.abs(v.difference))}`, tone: v.status === 'SOBRANTE' ? 'warn' : 'bad' };
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className={strong ? 'cash-line-strong' : undefined}>
            <dt>{label}</dt>
            <dd className="cash-num">{value}</dd>
        </div>
    );
}

/**
 * Close report v2 (spec 7.3.2b). Once the shift is closed the server sends everything to every role, so nothing is hidden here:
 * the blind rule only applies while counting.
 */
export function CloseReportScreen({ api, session, shiftId, onDone, onBack, printer = defaultPrintOut }: CloseReportProps) {
    const [report, setReport] = useState<ShiftReport | null>(null);
    const [sales, setSales] = useState<SalesByMethod | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    const [showDenoms, setShowDenoms] = useState(false);
    const [busy, setBusy] = useState<'print' | 'share' | null>(null);
    const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
    const busyRef = useRef(false);

    useEffect(() => {
        let live = true;
        setError(null);
        // Sales by method live in the shift summary (not blind data); without them the figure shows a dash, the report still opens.
        Promise.all([api.report(shiftId), api.summary(shiftId).then((s) => s.summary.salesByMethod ?? null, () => null)]).then(
            ([r, by]) => {
                if (!live) return;
                setReport(r);
                setSales(by);
            },
            (cause) => live && setError(cause instanceof Error ? cause.message : 'No se pudo cargar el reporte.'),
        );
        return () => {
            live = false;
        };
    }, [api, shiftId, tick]);

    const v = report ? reportView(report, sales) : null;
    const tag = v ? tagOf(v) : null;

    const run = async (kind: 'print' | 'share') => {
        if (!report || busyRef.current) return; // a double tap never shares twice
        busyRef.current = true;
        setBusy(kind);
        setNotice(null);
        try {
            const text = closeTicket(report, { printedAt: new Date(), printedBy: session.user.name, sales });
            if (kind === 'share') {
                await printer.shareText(text);
            } else {
                const how = await printOrShare(printer, text);
                if (how === 'shared') setNotice({ text: 'No hay impresora conectada: se abrió el menú para compartir.', error: false });
            }
        } catch (cause) {
            setNotice({ text: cause instanceof Error && cause.message ? cause.message : 'No se pudo imprimir el ticket.', error: true });
        } finally {
            busyRef.current = false;
            setBusy(null);
        }
    };

    return (
        <main className="cash" data-testid="cash-report" data-shift={shiftId}>
            <header className="cash-bar">
                {onBack && (
                    <button type="button" className="btn" aria-label="Volver" onClick={onBack}>
                        ←
                    </button>
                )}
                <div className="cash-head">
                    <strong className="cash-title">{v ? `${v.register}${v.shiftNo != null ? ` · Turno #${v.shiftNo}` : ''}` : 'Reporte de cierre'}</strong>
                    {v && <span className="muted cash-num">{`${v.cashier} · ${dateOf(v.start)} ${timeOf(v.start)} – ${timeOf(v.end)}`}</span>}
                </div>
                {tag && (
                    <span className={`cash-tag cash-tag-${tag.tone}`} data-testid="result-tag">
                        {tag.text}
                    </span>
                )}
                <span className="grow" />
                {onDone && (
                    <button type="button" className="btn" onClick={onDone}>
                        Listo
                    </button>
                )}
            </header>
            {error && (
                <p className="error cash-notice" role="alert">
                    {error}{' '}
                    <button type="button" className="btn" onClick={() => setTick((t) => t + 1)}>
                        Reintentar
                    </button>
                </p>
            )}
            {!v && !error && <p className="muted cash-notice">Cargando reporte…</p>}
            {v && (
                <div className="cash-report-body">
                    <div className="cash-cards" role="group" aria-label="Cifras clave">
                        <div className="cash-card" data-card>
                            <span className="muted">Ventas</span>
                            <strong className="cash-num cash-card-amount">{dash(v.salesTotal)}</strong>
                        </div>
                        <div className="cash-card" data-card>
                            <span className="muted">Debe haber</span>
                            <strong className="cash-num cash-card-amount" data-testid="expected">
                                {dash(v.expected)}
                            </strong>
                        </div>
                        <div className="cash-card" data-card>
                            <span className="muted">Contado</span>
                            <strong className="cash-num cash-card-amount" data-testid="counted">
                                {dash(v.counted)}
                            </strong>
                        </div>
                        <div className="cash-card" data-card>
                            <span className="muted">Diferencia</span>
                            <strong className={`cash-num cash-card-amount ${v.status === 'FALTANTE' ? 'cash-out' : ''}`} data-testid="difference">
                                {signed(v.difference)}
                            </strong>
                        </div>
                    </div>
                    <div className="cash-report-cards">
                        <section className="cash-right" aria-label="Ventas por método">
                            <h2 className="cash-h">Ventas por método</h2>
                            <dl className="cash-lines">
                                <Line label="Efectivo" value={v.sales ? money(v.sales.cash) : money(v.cashSales)} />
                                <Line label="Tarjeta" value={v.sales ? money(v.sales.card) : '—'} />
                                <Line label="Transferencia" value={v.sales ? money(v.sales.transfer) : '—'} />
                                <Line label={v.sales ? `Total · ${v.sales.paymentCount} ${v.sales.paymentCount === 1 ? 'cobro' : 'cobros'}` : 'Total'} value={dash(v.salesTotal)} strong />
                            </dl>
                        </section>
                        <section className="cash-right" aria-label="Efectivo">
                            <h2 className="cash-h">Efectivo</h2>
                            <dl className="cash-lines">
                                <Line label="Fondo inicial" value={money(v.startAmount)} />
                                <Line label="Ventas en efectivo" value={money(v.cashSales)} />
                                <Line label="Entradas" value={`+${money(v.moneyIn)}`} />
                                <Line label="Salidas" value={`−${money(v.moneyOut)}`} />
                                {v.refunds > 0 && <Line label="Devoluciones" value={`−${money(v.refunds)}`} />}
                                <Line label="Debe haber" value={dash(v.expected)} strong />
                            </dl>
                        </section>
                        <section className="cash-right" aria-label="Arqueo">
                            <h2 className="cash-h">Arqueo</h2>
                            <dl className="cash-lines">
                                <Line label="Córdobas" value={money(v.nioCounted)} />
                                <Line label={`Dólares US$ ${v.usd}${v.rate != null ? ` · TC ${v.rate}` : ''}`} value={money(v.usdInNio)} />
                                <Line label="Contado" value={dash(v.counted)} strong />
                                <Line label="Diferencia" value={signed(v.difference)} />
                            </dl>
                            {v.notes && <p className="muted cash-note">{`Nota: ${v.notes}`}</p>}
                        </section>
                    </div>
                    {showDenoms && (
                        <section className="cash-right" aria-label="Denominaciones">
                            <h2 className="cash-h">Denominaciones</h2>
                            <div className="cash-denoms-cols">
                                <ul className="cash-moves" aria-label="Córdobas contados">
                                    {[...v.bills, ...v.coins].map((r) => (
                                        <li key={`n${r.denomination}`} className="cash-move">
                                            <span className="cash-num">{`C$ ${r.denomination} × ${r.count}`}</span>
                                            <strong className="cash-num">{money(r.denomination * r.count)}</strong>
                                        </li>
                                    ))}
                                    {v.bills.length + v.coins.length === 0 && <li className="muted">Sin córdobas contados</li>}
                                </ul>
                                <ul className="cash-moves" aria-label="Dólares contados">
                                    {v.usdBills.map((r) => (
                                        <li key={`u${r.denomination}`} className="cash-move">
                                            <span className="cash-num">{`US$ ${r.denomination} × ${r.count}`}</span>
                                            <strong className="cash-num">{`US$ ${r.denomination * r.count}`}</strong>
                                        </li>
                                    ))}
                                    {v.usdBills.length === 0 && <li className="muted">Sin dólares contados</li>}
                                </ul>
                            </div>
                        </section>
                    )}
                </div>
            )}
            {notice && (
                <p className={notice.error ? 'error cash-notice' : 'muted cash-notice'} role={notice.error ? 'alert' : 'status'}>
                    {notice.text}
                </p>
            )}
            <footer className="cash-foot cash-report-foot">
                <button type="button" className="btn" aria-pressed={showDenoms} disabled={!v} onClick={() => setShowDenoms((s) => !s)}>
                    Denominaciones
                </button>
                <button type="button" className="btn" disabled={!v || busy !== null} onClick={() => void run('share')}>
                    Enviar
                </button>
                <button type="button" className="btn btn-primary cash-main" disabled={!v || busy !== null} onClick={() => void run('print')}>
                    Imprimir ticket
                </button>
            </footer>
        </main>
    );
}
