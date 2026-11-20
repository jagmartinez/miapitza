import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../tables/Sheet';
import { ReadyCard } from './ReadyCard';
import { TicketList, type ListRow } from './TicketList';
import { EXPANDED_HEIGHT, ROW_HEIGHT, TicketRow } from './TicketRow';
import { money, sumQuantity, type LineState, type ServerLine } from './orderModel';
import type { DraftTicketLine } from './useOrderDraft';

export interface TicketActions {
    onPay?: () => void;
    onSplit?: () => void;
    onDiscount?: () => void;
    onMore?: () => void;
    canPay: boolean;
    canSplit: boolean;
    canDiscount: boolean;
}

/** What the server holds for the discount: shown above the total only when there is one. */
export interface TicketPricing {
    subtotal: number;
    discount: number;
    /** Reason chip (or "Cupón X"); null when there is no discount. */
    label: string | null;
}

export interface TicketPanelProps {
    title: string;
    subtitle: string;
    drafts: DraftTicketLine[];
    highlightKey: string | null;
    /** Everything the server holds for the order (unsent and sent). */
    serverLines: ServerLine[];
    now: number;
    /** Server order total (taxes and discounts included). */
    total: number;
    pricing?: TicketPricing;
    /** Draft lines at menu price: shown apart, never summed into the total. */
    unsentTotal: number;
    highlightSeq: number;
    sendCount: number;
    sending: boolean;
    error: string | null;
    canEdit: boolean;
    canDeliver: boolean;
    /** A mutation (deliver, edit a server line) is in flight. */
    busy: boolean;
    actions: TicketActions;
    onQuantity: (key: string, quantity: number) => void;
    onDraftNote: (key: string, note: string) => void;
    onServerQuantity: (line: ServerLine, quantity: number) => void;
    onServerNote: (line: ServerLine, note: string) => void;
    onServerRemove: (line: ServerLine) => void;
    onDeliver: (itemIds: number[]) => void;
    onSend: () => void;
    onOpenFull: () => void;
}

export const STATE_LABEL: Record<Exclude<LineState, 'new'>, string> = { ready: 'Listo', preparing: 'En preparación', delivered: 'Entregado' };

type FooterProps = Pick<TicketPanelProps, 'total' | 'pricing' | 'unsentTotal' | 'sendCount' | 'sending' | 'canEdit' | 'actions' | 'onSend'>;

/** Pinned footer: total, "Enviar a cocina · N" and the secondary actions. Never scrolls with the list. */
export function TicketFooter({ total, pricing, unsentTotal, sendCount, sending, canEdit, actions, onSend }: FooterProps) {
    return (
        <footer className="ticket-foot">
            {pricing && pricing.discount > 0 && (
                <div className="ticket-pricing">
                    <div className="ticket-line">
                        <span className="muted">Subtotal</span>
                        <span>{money(pricing.subtotal)}</span>
                    </div>
                    <div className="ticket-line">
                        <span className="ticket-chip">{pricing.label}</span>
                        <span>{`− ${money(pricing.discount)}`}</span>
                    </div>
                </div>
            )}
            <div className="ticket-total">
                <span className="muted">Total</span>
                <strong>{money(total)}</strong>
            </div>
            {sending && <span className="ticket-unsent muted" role="status">Enviando…</span>}
            {unsentTotal > 0 && <span className="ticket-unsent muted">{`+ ${money(unsentTotal)} sin enviar`}</span>}
            {canEdit && (
                <button type="button" className="btn btn-primary ticket-send" disabled={sendCount === 0 || sending} onClick={onSend}>
                    {`Enviar a cocina · ${sendCount}`}
                </button>
            )}
            <div className="ticket-secondary">
                {actions.canPay && (
                    <button type="button" className="btn" disabled={!actions.onPay} onClick={actions.onPay}>
                        Cobrar
                    </button>
                )}
                {actions.canSplit && (
                    <button type="button" className="btn" disabled={!actions.onSplit} onClick={actions.onSplit}>
                        Dividir
                    </button>
                )}
                {actions.canDiscount && (
                    <button type="button" className="btn" disabled={!actions.onDiscount} onClick={actions.onDiscount}>
                        Descuento
                    </button>
                )}
                {actions.onMore && (
                    <button type="button" className="btn icon-btn" aria-label="Más acciones" onClick={actions.onMore}>
                        ⋯
                    </button>
                )}
            </div>
        </footer>
    );
}

type NoteTarget = { kind: 'draft'; key: string; initial: string } | { kind: 'server'; line: ServerLine; initial: string };

export function NoteSheet({ initial, onSave, onClose }: { initial: string; onSave: (note: string) => void; onClose: () => void }) {
    const [text, setText] = useState(initial);
    return (
        <Sheet label="Nota" onClose={onClose}>
            <h2 className="sheet-title">Nota</h2>
            <label className="field">
                Nota
                <input value={text} maxLength={200} autoFocus placeholder="Ej. sin cebolla" onChange={(e) => setText(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary sheet-main" onClick={() => onSave(text)}>
                Guardar nota
            </button>
        </Sheet>
    );
}

const subOf = (modifiers: string[], notes: string) => [...modifiers, notes].filter(Boolean).join(' · ');

export function TicketPanel(props: TicketPanelProps) {
    const { title, subtitle, drafts, highlightKey, serverLines, now, error, canEdit, canDeliver, busy, sending } = props;
    const [expanded, setExpanded] = useState<string | null>(null); // one row open at a time
    const [noteFor, setNoteFor] = useState<NoteTarget | null>(null);
    // Where the list should scroll: an expanded row, or the line just added (a counter, so the same key can repeat).
    const [scrollReq, setScrollReq] = useState<{ key: string | null; n: number }>({ key: null, n: 0 });
    useEffect(() => {
        if (props.highlightSeq > 0 && highlightKey) setScrollReq((r) => ({ key: `d:${highlightKey}`, n: r.n + 1 }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.highlightSeq]);

    const unsent = useMemo(() => serverLines.filter((l) => l.state === 'new'), [serverLines]);
    const sent = useMemo(() => serverLines.filter((l) => l.state !== 'new'), [serverLines]);
    const ready = useMemo(() => sent.filter((l) => l.state === 'ready'), [sent]);

    const rows = useMemo<ListRow[]>(() => {
        const out: ListRow[] = [];
        const toggle = (key: string) => {
            setExpanded((cur) => (cur === key ? null : key));
            setScrollReq((r) => ({ key, n: r.n + 1 }));
        };
        if (drafts.length + unsent.length > 0) {
            out.push({ key: 'h-new', height: 32, node: <h3 className="ticket-section">Nuevo · sin enviar</h3> });
        }
        for (const l of drafts) {
            const key = `d:${l.key}`;
            const open = canEdit && !sending && expanded === key;
            out.push({
                key,
                height: open ? EXPANDED_HEIGHT : ROW_HEIGHT,
                node: (
                    <TicketRow
                        data={{ key, quantity: l.quantity, name: l.name, sub: subOf(l.modifierNames, l.notes), price: l.unitPrice * l.quantity }}
                        testId={`draft-${l.key}`}
                        expanded={open}
                        highlighted={highlightKey === l.key}
                        editable={canEdit && !sending}
                        onToggle={() => toggle(key)}
                        onQuantity={(q) => {
                            if (q <= 0) setExpanded(null);
                            props.onQuantity(l.key, q);
                        }}
                        onNote={() => setNoteFor({ kind: 'draft', key: l.key, initial: l.notes })}
                        onRemove={() => {
                            setExpanded(null);
                            props.onQuantity(l.key, 0);
                        }}
                    />
                ),
            });
        }
        for (const l of unsent) {
            const key = `s:${l.id}`;
            const open = canEdit && expanded === key;
            out.push({
                key,
                height: open ? EXPANDED_HEIGHT : ROW_HEIGHT,
                node: (
                    <TicketRow
                        data={{ key, quantity: l.quantity, name: l.name, sub: subOf(l.modifiers, l.notes), price: l.subtotal }}
                        testId={`unsent-${l.id}`}
                        expanded={open}
                        editable={canEdit}
                        busy={busy}
                        onToggle={() => toggle(key)}
                        onQuantity={(q) => {
                            if (q <= 0) setExpanded(null);
                            props.onServerQuantity(l, q);
                        }}
                        onNote={() => setNoteFor({ kind: 'server', line: l, initial: l.notes })}
                        onRemove={() => {
                            setExpanded(null);
                            props.onServerRemove(l);
                        }}
                    />
                ),
            });
        }
        if (sent.length > 0) {
            const by = (s: LineState) => sumQuantity(sent.filter((l) => l.state === s));
            const parts = (['ready', 'preparing', 'delivered'] as const).map((s) => ({ s, n: by(s) })).filter((p) => p.n > 0);
            out.push({
                key: 'sent-card',
                height: 56 + parts.length * 32,
                node: (
                    <button type="button" className="sent-card" onClick={props.onOpenFull}>
                        <span className="sent-card-head">
                            <strong>{`Enviado · ${sumQuantity(sent)}`}</strong>
                            <span className="muted" aria-hidden="true">
                                Ver ›
                            </span>
                        </span>
                        {parts.map((p) => (
                            <span key={p.s} className="sent-line" data-state={p.s}>
                                {`${STATE_LABEL[p.s]} · ${p.n}`}
                            </span>
                        ))}
                    </button>
                ),
            });
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drafts, unsent, sent, expanded, highlightKey, canEdit, sending, busy, props.onOpenFull]);

    const saveNote = (text: string) => {
        if (!noteFor) return;
        if (noteFor.kind === 'draft') {
            props.onDraftNote(noteFor.key, text);
            setExpanded(null);
        } else props.onServerNote(noteFor.line, text);
        setNoteFor(null);
    };

    return (
        <section className="ticket" aria-label="Ticket">
            <header className="ticket-head">
                <div className="ticket-head-text">
                    <strong>{title}</strong>
                    <span className="muted">{subtitle}</span>
                </div>
                <button type="button" className="btn icon-btn" aria-label="Ver ticket completo" onClick={props.onOpenFull}>
                    ⤢
                </button>
            </header>
            {canDeliver && <ReadyCard lines={ready} now={now} busy={busy} onDeliver={props.onDeliver} />}
            {rows.length > 0 ? <TicketList rows={rows} scrollTarget={scrollReq} /> : <p className="muted ticket-empty">Toca un producto para agregarlo.</p>}
            {error && (
                <p className="error ticket-error" role="alert">
                    {error}
                </p>
            )}
            <TicketFooter {...props} />
            {noteFor && <NoteSheet initial={noteFor.initial} onSave={saveNote} onClose={() => setNoteFor(null)} />}
        </section>
    );
}
