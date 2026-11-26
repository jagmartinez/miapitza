import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../tables/Sheet';
import { IconArrowsMaximize, IconChevronRight, IconDots } from '../../../ui/Icon';
import { ReadyCard } from './ReadyCard';
import { TicketList, type ListRow } from './TicketList';
import { EXPANDED_HEIGHT, ROW_HEIGHT, TicketRow } from './TicketRow';
import { money, sumQuantity, type LineState, type ServerLine } from './orderModel';
import type { QueuedLine } from '../../../data/offlineQueue';
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
    /** Server tax (IVA); null when the order does not carry one. */
    tax: number | null;
    tip: number;
    /** Reason chip (or "Cupón X"); null when there is no discount. */
    label: string | null;
    /** Company tax rate in percent (settings); used while the order has no tax of its own. */
    companyRate?: number | null;
}

export interface TicketPanelProps {
    title: string;
    subtitle: string;
    drafts: DraftTicketLine[];
    highlightKey: string | null;
    /** Everything the server holds for the order (unsent and sent). */
    serverLines: ServerLine[];
    /** Lines sent while offline: queued on this device, not on the server yet. */
    queued?: QueuedLine[];
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

const NOT_SYNCED = 'No se pudo sincronizar';

/** Rows of the queued lines: plain (the queue list is where they are retried or discarded). */
export function queuedRows(queued: QueuedLine[]): ListRow[] {
    if (queued.length === 0) return [];
    return [
        { key: 'h-queued', height: 32, node: <h3 className="ticket-section">Pendiente de sincronizar</h3> },
        ...queued.map(
            (l): ListRow => ({
                key: `q:${l.id}`,
                height: ROW_HEIGHT,
                node: (
                    <TicketRow
                        data={{ key: `q:${l.id}`, quantity: l.quantity, name: l.name, sub: [...l.modifierNames, l.notes, l.status === 'failed' ? NOT_SYNCED : ''].filter(Boolean).join(' · '), price: l.unitPrice * l.quantity }}
                        testId={`queued-${l.id}`}
                        expanded={false}
                        editable={false}
                        onToggle={() => undefined}
                        onQuantity={() => undefined}
                        onNote={() => undefined}
                        onRemove={() => undefined}
                    />
                ),
            }),
        ),
    ];
}

const EMPTY_QUEUED: QueuedLine[] = [];

export const STATE_LABEL: Record<Exclude<LineState, 'new'>, string> = { ready: 'Listo', preparing: 'En preparación', delivered: 'Entregado' };

/** "···" sheet: Descuento and the table actions. Shared by the panel and the full ticket. */
export function MoreActionsSheet({ actions, onClose }: { actions: Pick<TicketActions, 'canDiscount' | 'onDiscount' | 'onMore'>; onClose: () => void }) {
    return (
        <Sheet label="Más acciones" title="Más acciones" onClose={onClose}>
            <div className="more-actions">
                {actions.canDiscount && (
                    <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={!actions.onDiscount}
                        onClick={() => {
                            onClose();
                            actions.onDiscount?.();
                        }}
                    >
                        Descuento
                    </button>
                )}
                {actions.onMore && (
                    <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                            onClose();
                            actions.onMore?.();
                        }}
                    >
                        Acciones de la mesa
                    </button>
                )}
            </div>
        </Sheet>
    );
}

/** Unsent lines carry the order's own tax rate (server tax over taxable base) so Total is the same before and after sending. */
export function unsentWithTax(pricing: TicketPricing | undefined, unsent: number): { unsentGross: number; rateKnown: boolean } {
    if (unsent <= 0) return { unsentGross: 0, rateKnown: true };
    if (!pricing) return { unsentGross: unsent, rateKnown: false };
    const base = pricing.subtotal - pricing.discount;
    let rate: number | null = null;
    if (base > 0 && pricing.tax != null) rate = Math.max(0, pricing.tax) / base;
    else if (pricing.companyRate != null && pricing.companyRate >= 0) rate = pricing.companyRate / 100;
    if (rate == null) return { unsentGross: unsent, rateKnown: false };
    return { unsentGross: Math.round((unsent + Math.round(unsent * rate * 100 + 1e-9) / 100) * 100) / 100, rateKnown: true };
}

type FooterProps = Pick<TicketPanelProps, 'total' | 'pricing' | 'unsentTotal' | 'sendCount' | 'sending' | 'canEdit' | 'actions' | 'onSend'>;

/** Pinned footer: total, one primary "Enviar a cocina · N" and the outlined secondary row (Cobrar | Dividir | ···). Never scrolls with the list. */
export function TicketFooter({ total, pricing, unsentTotal, sendCount, sending, canEdit, actions, onSend }: FooterProps) {
    const [moreOpen, setMoreOpen] = useState(false);
    const showMore = (actions.canDiscount && !!actions.onDiscount) || !!actions.onMore;
    const { unsentGross, rateKnown } = unsentWithTax(pricing, unsentTotal);
    const hasPricing = !!pricing && pricing.subtotal > 0;
    return (
        <footer className="ticket-foot">
            {/* Same rows in every state: without sent lines the block is a hidden placeholder so the buttons never jump. */}
            {!hasPricing && (
                <div className="ticket-pricing ticket-pricing-ghost" aria-hidden="true">
                    <div className="ticket-line"><span>Subtotal</span><span>&nbsp;</span></div>
                    <div className="ticket-line"><span>IVA</span><span>&nbsp;</span></div>
                </div>
            )}
            {pricing && hasPricing && (
                <div className="ticket-pricing">
                    <div className="ticket-line">
                        <span>Subtotal</span>
                        <span>{money(pricing.subtotal)}</span>
                    </div>
                    {pricing.discount > 0 && (
                        <div className="ticket-line">
                            <span className="ticket-chip">{pricing.label}</span>
                            <span>{`− ${money(pricing.discount)}`}</span>
                        </div>
                    )}
                    {/* IVA is the server field; an order without one shows what is left between subtotal, discount, tip and total. */}
                    <div className="ticket-line">
                        <span>IVA</span>
                        <span>{money(pricing.tax ?? Math.max(0, total - (pricing.subtotal - pricing.discount) - pricing.tip))}</span>
                    </div>
                    {pricing.tip > 0 && (
                        <div className="ticket-line">
                            <span>Propina</span>
                            <span>{money(pricing.tip)}</span>
                        </div>
                    )}
                </div>
            )}
            <div className="ticket-total">
                <span className="muted">Total</span>
                <strong>{money(total + unsentGross)}</strong>
            </div>
            <span className={sending || unsentTotal > 0 ? 'ticket-unsent muted' : 'ticket-unsent-ghost'} role={sending ? 'status' : undefined}>
                {sending ? 'Enviando…' : unsentTotal > 0 ? `${money(unsentGross)} sin enviar${rateKnown ? '' : ' (antes de IVA)'}` : ' '}
            </span>
            {(() => {
                const moreBtn = (
                    <button type="button" className="btn btn-outline icon-btn" aria-label="Más acciones" onClick={() => setMoreOpen(true)}>
                        <IconDots size={20} stroke={1.5} aria-hidden />
                    </button>
                );
                const hasSecondary = actions.canPay || actions.canSplit;
                const sendBtn = canEdit && (
                    <button type="button" className="btn btn-primary ticket-send" disabled={sendCount === 0 || sending} onClick={onSend}>
                        {sendCount > 0 ? `Enviar a cocina · ${sendCount}` : 'Enviar a cocina'}
                    </button>
                );
                return (
                    <>
                        {/* Without Cobrar/Dividir (waiter) the "···" sits at the right of the send row instead of alone. */}
                        {sendBtn && (hasSecondary || !showMore ? sendBtn : <div className="ticket-sendrow">{sendBtn}{moreBtn}</div>)}
                        {(hasSecondary || (!sendBtn && showMore)) && (
                            <div className="ticket-secondary">
                                {actions.canPay && (
                                    <button type="button" className="btn btn-outline" disabled={!actions.onPay} onClick={actions.onPay}>
                                        Cobrar
                                    </button>
                                )}
                                {actions.canSplit && (
                                    <button type="button" className="btn btn-outline" disabled={!actions.onSplit} onClick={actions.onSplit}>
                                        Dividir
                                    </button>
                                )}
                                {showMore && moreBtn}
                            </div>
                        )}
                    </>
                );
            })()}
            {moreOpen && <MoreActionsSheet actions={actions} onClose={() => setMoreOpen(false)} />}
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

const SectionCaption = ({ label, count }: { label: string; count: number }) => (
    <h3 className="ticket-section">
        <span>{label}</span>
        <span className="count-pill">{count}</span>
    </h3>
);

const subOf =(modifiers: string[], notes: string) => [...modifiers, notes].filter(Boolean).join(' · ');

export function TicketPanel(props: TicketPanelProps) {
    const { title, subtitle, drafts, highlightKey, serverLines, now, error, canEdit, canDeliver, busy, sending } = props;
    const queued = props.queued ?? EMPTY_QUEUED;
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
            out.push({ key: 'h-new', height: 32, node: <SectionCaption label="Nuevo" count={sumQuantity(unsent) + drafts.reduce((n, d) => n + d.quantity, 0)} /> });
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
        out.push(...queuedRows(queued));
        if (sent.length > 0) {
            const by = (s: LineState) => sumQuantity(sent.filter((l) => l.state === s));
            const parts = (['ready', 'preparing', 'delivered'] as const).map((s) => ({ s, n: by(s) })).filter((p) => p.n > 0);
            out.push({
                key: 'sent-card',
                height: 72 + parts.length * 40,
                node: (
                    <button type="button" className="sent-card" onClick={props.onOpenFull}>
                        <span className="sent-card-head">
                            <strong>{`Enviado · ${sumQuantity(sent)}`}</strong>
                            <span className="muted sent-ver" aria-hidden="true">
                                Ver
                                <IconArrowsMaximize size={16} stroke={1.5} />
                            </span>
                        </span>
                        {parts.map((p) => (
                            <span key={p.s} className="sent-row" data-state={p.s}>
                                <i className="sent-dot" aria-hidden="true" />
                                <span className="sent-line" data-state={p.s}>
                                    {`${STATE_LABEL[p.s]} · ${p.n}`}
                                </span>
                                <IconChevronRight size={16} stroke={1.5} aria-hidden />
                            </span>
                        ))}
                    </button>
                ),
            });
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drafts, unsent, sent, queued, expanded, highlightKey, canEdit, sending, busy, props.onOpenFull]);

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
                <button type="button" className="btn btn-ghost icon-btn" aria-label="Ver ticket completo" onClick={props.onOpenFull}>
                    <IconArrowsMaximize size={20} stroke={1.5} aria-hidden />
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
