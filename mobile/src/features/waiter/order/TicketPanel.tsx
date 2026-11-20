import type { ReactNode } from 'react';
import { money, type LineState, type ServerLine } from './orderModel';
import type { DraftTicketLine } from './useOrderDraft';

export interface TicketActions {
    canSend: boolean;
    onPay?: () => void;
    onSplit?: () => void;
    onDiscount?: () => void;
    onMore?: () => void;
    canPay: boolean;
    canSplit: boolean;
    canDiscount: boolean;
}

export interface TicketPanelProps {
    title: string;
    subtitle: string;
    drafts: DraftTicketLine[];
    highlightKey: string | null;
    /** Sent or unsent lines already on the server. */
    serverLines: ServerLine[];
    total: number;
    sendCount: number;
    sending: boolean;
    error: string | null;
    canEdit: boolean;
    actions: TicketActions;
    onQuantity: (key: string, quantity: number) => void;
    onSend: () => void;
    children?: ReactNode;
}

const STATE_LABEL: Record<LineState, string> = { new: 'Sin enviar', preparing: 'En preparación', ready: 'Listo', delivered: 'Entregado' };

export function Footer({ total, sendCount, sending, canEdit, actions, onSend }: Pick<TicketPanelProps, 'total' | 'sendCount' | 'sending' | 'canEdit' | 'actions' | 'onSend'>) {
    return (
        <footer className="ticket-foot">
            <div className="ticket-total">
                <span className="muted">Total</span>
                <strong>{money(total)}</strong>
            </div>
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

export function TicketPanel(props: TicketPanelProps) {
    const { title, subtitle, drafts, highlightKey, serverLines, error, canEdit, onQuantity } = props;
    const unsent = serverLines.filter((l) => l.state === 'new');
    const sent = serverLines.filter((l) => l.state !== 'new');
    return (
        <section className="ticket" aria-label="Ticket">
            <header className="ticket-head">
                <strong>{title}</strong>
                <span className="muted">{subtitle}</span>
            </header>
            <div className="ticket-body">
                {(drafts.length > 0 || unsent.length > 0) && (
                    <>
                        <h3 className="ticket-section">Nuevo · sin enviar</h3>
                        <ul className="ticket-list">
                            {drafts.map((l) => (
                                <li key={l.key} className="row" data-testid={`draft-${l.key}`} data-highlighted={highlightKey === l.key ? 'true' : undefined}>
                                    <span className="qty-badge">{l.quantity}</span>
                                    <span className="row-main">
                                        <span className="row-name">{l.name}</span>
                                        {(l.modifierNames.length > 0 || l.notes) && <span className="row-sub">{[...l.modifierNames, l.notes].filter(Boolean).join(' · ')}</span>}
                                    </span>
                                    {canEdit && (
                                        <span className="stepper">
                                            <button type="button" className="btn" aria-label={`Menos ${l.name}`} onClick={() => onQuantity(l.key, l.quantity - 1)}>
                                                −
                                            </button>
                                            <button type="button" className="btn" aria-label={`Más ${l.name}`} onClick={() => onQuantity(l.key, l.quantity + 1)}>
                                                +
                                            </button>
                                        </span>
                                    )}
                                    <span className="row-price">{money(l.unitPrice * l.quantity)}</span>
                                </li>
                            ))}
                            {unsent.map((l) => (
                                <li key={`s${l.id}`} className="row" data-testid={`unsent-${l.id}`}>
                                    <span className="qty-badge">{l.quantity}</span>
                                    <span className="row-main">
                                        <span className="row-name">{l.name}</span>
                                        {(l.modifiers.length > 0 || l.notes) && <span className="row-sub">{[...l.modifiers, l.notes].filter(Boolean).join(' · ')}</span>}
                                    </span>
                                    <span className="row-price">{money(l.subtotal)}</span>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
                {sent.length > 0 && (
                    <>
                        <h3 className="ticket-section">{`En cocina · ${sent.reduce((n, l) => n + l.quantity, 0)}`}</h3>
                        <ul className="ticket-list">
                            {sent.map((l) => (
                                <li key={l.id} className="row row-sent" data-state={l.state}>
                                    <span className="qty-badge">{l.quantity}</span>
                                    <span className="row-main">
                                        <span className="row-name">{l.name}</span>
                                        <span className="row-sub">{[STATE_LABEL[l.state], ...l.modifiers, l.notes].filter(Boolean).join(' · ')}</span>
                                    </span>
                                    <span className="row-price">{money(l.subtotal)}</span>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
                {drafts.length === 0 && serverLines.length === 0 && <p className="muted ticket-empty">Toca un producto para agregarlo.</p>}
            </div>
            {error && (
                <p className="error ticket-error" role="alert">
                    {error}
                </p>
            )}
            <Footer {...props} />
        </section>
    );
}
