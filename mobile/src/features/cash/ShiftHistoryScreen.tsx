import { useEffect, useState } from 'react';
import type { CashApi } from '../../data/cashApi';
import type { CashShiftInfo } from '../../data/cashTypes';
import { money } from '../waiter/order/orderModel';
import { cashErrorText, isRetryable } from './cashErrors';
import { localDayBoundsIso } from './dayBounds';
import './cash.css';

const RANGES = [
    { days: 7, label: '7 días' },
    { days: 30, label: '30 días' },
    { days: 90, label: '90 días' },
];

const timeOf = (iso: string | null | undefined) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' }) : '';
};
const dateOf = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** "Caja › Historial de turnos": closed shifts, newest first; each opens its close report. */
export function ShiftHistoryScreen({ api, onOpen, onBack, now = () => new Date(), tzOffset }: { api: Pick<CashApi, 'history'>; onOpen: (shiftId: number) => void; onBack: () => void; now?: () => Date; tzOffset?: number }) {
    const [days, setDays] = useState(30);
    const [rows, setRows] = useState<CashShiftInfo[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    const [retryable, setRetryable] = useState(false);

    useEffect(() => {
        let live = true;
        setRows(null);
        setError(null);
        const from = new Date(now());
        from.setDate(from.getDate() - days);
        // Local-day bounds as real instants: an evening shift (18:00+ in UTC-6 is already tomorrow in UTC) stays in today.
        const start = localDayBoundsIso(from, tzOffset).start;
        const end = localDayBoundsIso(now(), tzOffset).end;
        api.history({ from: start, to: end }).then(
            (list) => live && setRows(list.filter((s) => s.endDate).sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)))),
            (cause) => {
                if (!live) return;
                setError(cashErrorText(cause, 'No se pudo cargar el historial.'));
                setRetryable(isRetryable(cause));
            },
        );
        return () => {
            live = false;
        };
        // `now` is a clock, not state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api, days, tick, tzOffset]);

    return (
        <main className="cash" data-testid="cash-history">
            <header className="cash-bar">
                <button type="button" className="btn" aria-label="Volver" onClick={onBack}>
                    ←
                </button>
                <strong className="cash-title">Caja › Historial de turnos</strong>
                <span className="grow" />
                <div className="cash-chips" role="group" aria-label="Período">
                    {RANGES.map((r) => (
                        <button key={r.days} type="button" className="btn" aria-pressed={days === r.days} onClick={() => setDays(r.days)}>
                            {r.label}
                        </button>
                    ))}
                </div>
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
            {!rows && !error && <p className="muted cash-notice">Cargando historial…</p>}
            {rows && rows.length === 0 && <p className="muted cash-notice">No hay turnos cerrados en este período.</p>}
            {rows && rows.length > 0 && (
                <ul className="cash-history-list" aria-label="Turnos cerrados">
                    {rows.map((s) => (
                        <li key={s.id}>
                            <button type="button" className="btn cash-history-row" onClick={() => onOpen(s.id)}>
                                <span>
                                    <strong>{`${s.cashRegister?.name ?? 'Caja'} · Turno #${s.id}`}</strong>
                                    <span className="muted cash-num">{`${s.user?.name ?? ''}${s.user?.name ? ' · ' : ''}${dateOf(s.startDate)} ${timeOf(s.startDate)} – ${timeOf(s.endDate)}`}</span>
                                </span>
                                {s.endAmount != null && <strong className="cash-num">{money(Number(s.endAmount))}</strong>}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </main>
    );
}
