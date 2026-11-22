import { useMemo, useState } from 'react';
import { TicketList, type ListRow } from './TicketList';
import { IconCheck, IconX } from '../../../ui/Icon';
import { minutesSince, money, sumQuantity, type LineState, type ServerLine } from './orderModel';
import { type TicketActions } from './TicketPanel';
import type { QueuedLine } from '../../../data/offlineQueue';
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
    sentAt?: string | null;
    finishedAt?: string | null;
    /** Server id; only these can be delivered. */
    itemId?: number;
}

export interface FullTicketProps {
    title: string;
    /** Muted second part of the header ("12 personas · José"). */
    subtitle?: string;
    /** Order total, shown at the right of the header. */
    total?: number;
    drafts: DraftTicketLine[];
    serverLines: ServerLine[];
    /** Lines sent while offline, not on the server yet. */
    queued?: QueuedLine[];
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

/** Landscape, two panels: filters (with counts) and Dividir/Cobrar on the left; fixed-column list and footer on the right. */
export function FullTicketScreen({ title, subtitle, total, drafts, serverLines, queued = [], canEdit, canDeliver, busy, sendCount, sending, error, actions, onDeliver, onSend, onBack }: FullTicketProps) {
    const [filter, setFilter] = useState<Filter>('all');

    const all = useMemo<FullRow[]>(
        () => [
            ...drafts.map((l): FullRow => ({
                key: `d:${l.key}`,
                quantity: l.quantity,
                name: l.name,
                sub: subOf(l.modifierNames, l.notes),
                state: 'new',
                price: l.unitPrice * l.quantity,
            })),
            ...queued.map((l): FullRow => ({
                key: `q:${l.id}`,
                quantity: l.quantity,
                name: l.name,
                sub: [subOf(l.modifierNames, l.notes), l.status === 'failed' ? 'No se pudo sincronizar' : 'Pendiente de sincronizar'].filter(Boolean).join(' · '),
                state: 'new',
                price: l.unitPrice * l.quantity,
            })),
            ...serverLines.map((l): FullRow => ({
                key: `s:${l.id}`,
                quantity: l.quantity,
                name: l.name,
                sub: subOf(l.modifiers, l.notes),
                state: l.state,
                price: l.subtotal,
                itemId: l.id,
                sentAt: l.sentAt,
                finishedAt: l.finishedAt,
            })),
        ],
        [drafts, serverLines, queued],
    );
    const counts = useMemo(() => {
        const c: Record<Filter, number> = {
            all: sumQuantity(all),
            new: 0,
            preparing: 0,
            ready: 0,
            delivered: 0,
        };
        for (const r of all) c[r.state] += r.quantity;
        return c;
    }, [all]);
    const readyIds = useMemo(() => all.filter((r) => r.state === 'ready' && r.itemId != null).map((r) => r.itemId as number), [all]);
    const readyUnits = counts.ready;

    // Groups: unsent lines first, then each send (Envío N, newest first), like the mockup.
    const rows = useMemo<ListRow[]>(() => {
        const visible = all.filter((r) => filter === 'all' || r.state === filter);
        const sendKeys = [...new Set(all.filter((r) => r.state !== 'new' && r.sentAt).map((r) => (r.sentAt as string).slice(0, 16)))].sort();
        const groupOf = (r: FullRow) => (r.state === 'new' ? 'new' : r.sentAt ? (r.sentAt as string).slice(0, 16) : 'old');
        const order = ['new', ...[...sendKeys].reverse(), 'old'];
        const now = Date.now();
        const out: ListRow[] = [];
        for (const g of order) {
            const members = visible.filter((r) => groupOf(r) === g);
            if (members.length === 0) continue;
            const idx = sendKeys.indexOf(g);
            const label = g === 'new' ? 'Nuevo · sin enviar' : g === 'old' ? 'Enviado' : `Envío ${idx + 1} · ${new Date(members[0].sentAt as string).toLocaleTimeString('es-NI', { hour: 'numeric', minute: '2-digit' })}`;
            out.push({
                key: `h:${g}`,
                height: 32,
                node: (
                    <h3 className="ticket-section">
                        <span>{label}</span>
                        <span className="frow-sum">{money(members.reduce((n, r) => n + r.price, 0))}</span>
                    </h3>
                ),
            });
            for (const r of members) {
                const stateText =
                    r.state === 'ready'
                        ? `Listo${r.finishedAt ? ` · ${minutesSince(r.finishedAt, now)} min` : ''}`
                        : r.state === 'preparing'
                          ? `Preparando${r.sentAt ? ` · ${minutesSince(r.sentAt, now)} min` : ''}`
                          : r.state === 'delivered'
                            ? 'Entregado'
                            : 'Sin enviar';
                out.push({
                    key: r.key,
                    height: 56,
                    node: (
                        <div className="frow" data-state={r.state}>
                            <span className="qty-badge">{r.quantity}</span>
                            <span className="row-main">
                                <span className="row-name">{r.name}</span>
                                {r.sub && <span className="row-sub">{r.sub}</span>}
                            </span>
                            <span className="frow-state" data-state={r.state}>
                                {stateText}
                            </span>
                            <span className="row-price">{money(r.price)}</span>
                            <span className="frow-action">
                                {canDeliver && r.state === 'ready' && r.itemId != null && (
                                    <button type="button" className="ready-deliver deliver-btn" aria-label={`Entregar ${r.name}`} disabled={busy} onClick={() => onDeliver([r.itemId as number])}>
                                        <IconCheck size={18} stroke={1.5} aria-hidden />
                                        Entregar
                                    </button>
                                )}
                            </span>
                        </div>
                    ),
                });
            }
        }
        return out;
    }, [all, filter, canDeliver, busy, onDeliver]);

    return (
        <section className="full" aria-label="Ticket completo">
            <header className="full-bar">
                <button type="button" className="pos-back" aria-label="Volver al pedido" onClick={onBack}>
                    <IconX size={22} stroke={1.5} aria-hidden />
                </button>
                <strong className="pos-table">{`Ticket · ${title}`}</strong>
                {subtitle && <span className="muted pos-meta">{subtitle}</span>}
                <span className="grow" />
                {total != null && <strong className="full-total">{money(total)}</strong>}
            </header>
            <div className="full-body">
                <aside className="full-side">
                    <div className="full-filters" role="group" aria-label="Filtros">
                        {FILTERS.map((f) => (
                            <button key={f.id} type="button" className="filter-btn" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                                <span>
                                    {f.id === 'ready' && <i className="sent-dot" data-state="ready" aria-hidden="true" />}
                                    {f.label}
                                </span>
                                <span className="filter-count">{counts[f.id]}</span>
                            </button>
                        ))}
                    </div>
                    <span className="grow" />
                    {actions.canSplit && (
                        <button type="button" className="btn btn-outline" disabled={!actions.onSplit} onClick={actions.onSplit}>
                            Dividir
                        </button>
                    )}
                    {actions.canPay && (
                        <button type="button" className="btn btn-outline" disabled={!actions.onPay} onClick={actions.onPay}>
                            Cobrar
                        </button>
                    )}
                </aside>
                <div className="full-main">
                    <TicketList rows={rows} testId="full-list" />
                    {error && (
                        <p className="error ticket-error" role="alert">
                            {error}
                        </p>
                    )}
                    <footer className="full-foot">
                        {canDeliver && readyUnits > 0 && (
                            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => onDeliver(readyIds)}>
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
            </div>
        </section>
    );
}
