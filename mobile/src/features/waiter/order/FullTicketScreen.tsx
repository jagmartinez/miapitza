import { useMemo, useState } from 'react';
import { TicketList, type ListRow } from './TicketList';
import { money, sumQuantity, type LineState, type ServerLine } from './orderModel';
import { STATE_LABEL, type TicketActions } from './TicketPanel';
import type { DraftTicketLine } from './useOrderDraft';

type Filter = 'all' | LineState;

const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Todo' },
    { id: 'new', label: 'Nuevo' },
    { id: 'ready', label: 'Listos' },
    { id: 'preparing', label: 'En preparación' },
    { id: 'delivered', label: 'Entregados' },
];

interface FullRow {
    key: string;
    quantity: number;
    name: string;
    sub: string;
    state: LineState;
    price: number;
    /** Server id; only these can be delivered. */
    itemId?: number;
}

export interface FullTicketProps {
    title: string;
    drafts: DraftTicketLine[];
    serverLines: ServerLine[];
    canEdit: boolean;
    canDeliver: boolean;
    busy: boolean;
    sendCount: number;
    sending: boolean;
    error: string | null;
    actions: Pick<TicketActions, 'canPay' | 'canSplit' | 'onPay' | 'onSplit'>;
    onDeliver: (itemIds: number[]) => void;
    onSend: () => void;
    onBack: () => void;
}

const subOf = (modifiers: string[], notes: string) => [...modifiers, notes].filter(Boolean).join(' · ');
const STATE_TEXT: Record<LineState, string> = { new: 'Nuevo', ...STATE_LABEL };

/** Landscape, two panels: filters (with counts) and Dividir/Cobrar on the left; fixed-column list and footer on the right. */
export function FullTicketScreen({ title, drafts, serverLines, canEdit, canDeliver, busy, sendCount, sending, error, actions, onDeliver, onSend, onBack }: FullTicketProps) {
    const [filter, setFilter] = useState<Filter>('all');

    const all = useMemo<FullRow[]>(
        () => [
            ...drafts.map((l): FullRow => ({ key: `d:${l.key}`, quantity: l.quantity, name: l.name, sub: subOf(l.modifierNames, l.notes), state: 'new', price: l.unitPrice * l.quantity })),
            ...serverLines.map((l): FullRow => ({ key: `s:${l.id}`, quantity: l.quantity, name: l.name, sub: subOf(l.modifiers, l.notes), state: l.state, price: l.subtotal, itemId: l.id })),
        ],
        [drafts, serverLines],
    );
    const counts = useMemo(() => {
        const c: Record<Filter, number> = { all: sumQuantity(all), new: 0, preparing: 0, ready: 0, delivered: 0 };
        for (const r of all) c[r.state] += r.quantity;
        return c;
    }, [all]);
    const readyIds = useMemo(() => all.filter((r) => r.state === 'ready' && r.itemId != null).map((r) => r.itemId as number), [all]);
    const readyUnits = counts.ready;

    const rows = useMemo<ListRow[]>(
        () =>
            all
                .filter((r) => filter === 'all' || r.state === filter)
                .map((r) => ({
                    key: r.key,
                    height: 56,
                    node: (
                        <div className="frow" data-state={r.state}>
                            <span className="qty-badge">{r.quantity}</span>
                            <span className="row-main">
                                <span className="row-name">{r.name}</span>
                                {r.sub && <span className="row-sub">{r.sub}</span>}
                            </span>
                            <span className="frow-state">{STATE_TEXT[r.state]}</span>
                            <span className="row-price">{money(r.price)}</span>
                            <span className="frow-action">
                                {canDeliver && r.state === 'ready' && r.itemId != null && (
                                    <button type="button" className="btn deliver-btn" aria-label={`Entregar ${r.name}`} disabled={busy} onClick={() => onDeliver([r.itemId as number])}>
                                        Entregar
                                    </button>
                                )}
                            </span>
                        </div>
                    ),
                })),
        [all, filter, canDeliver, busy, onDeliver],
    );

    return (
        <section className="full" aria-label="Ticket completo">
            <aside className="full-side">
                <button type="button" className="btn" onClick={onBack}>
                    Volver al pedido
                </button>
                <h2 className="full-title">{title}</h2>
                <div className="full-filters" role="group" aria-label="Filtros">
                    {FILTERS.map((f) => (
                        <button key={f.id} type="button" className="filter-btn" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                            <span>{f.label}</span>
                            <span className="filter-count">{counts[f.id]}</span>
                        </button>
                    ))}
                </div>
                <span className="grow" />
                {actions.canSplit && (
                    <button type="button" className="btn" disabled={!actions.onSplit} onClick={actions.onSplit}>
                        Dividir
                    </button>
                )}
                {actions.canPay && (
                    <button type="button" className="btn" disabled={!actions.onPay} onClick={actions.onPay}>
                        Cobrar
                    </button>
                )}
            </aside>
            <div className="full-main">
                <div className="frow frow-head" aria-hidden="true">
                    <span className="qty-badge-sp">Cant.</span>
                    <span className="row-main">Producto</span>
                    <span className="frow-state">Estado</span>
                    <span className="row-price">Precio</span>
                    <span className="frow-action" />
                </div>
                <TicketList rows={rows} testId="full-list" />
                {error && (
                    <p className="error ticket-error" role="alert">
                        {error}
                    </p>
                )}
                <footer className="full-foot">
                    {canDeliver && readyUnits > 0 && (
                        <button type="button" className="btn" disabled={busy} onClick={() => onDeliver(readyIds)}>
                            {`Entregar listos · ${readyUnits}`}
                        </button>
                    )}
                    {canEdit && (
                        <button type="button" className="btn btn-primary" disabled={sendCount === 0 || sending} onClick={onSend}>
                            {`Enviar a cocina · ${sendCount}`}
                        </button>
                    )}
                </footer>
            </div>
        </section>
    );
}
