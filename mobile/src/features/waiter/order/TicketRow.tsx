import { IconNote, IconTrash } from '../../../ui/Icon';
import { money } from './orderModel';

export const ROW_HEIGHT = 56;
export const EXPANDED_HEIGHT = 132;

export interface RowData {
    key: string;
    quantity: number;
    name: string;
    sub: string;
    /** Whole-line price. */
    price: number;
}

export interface TicketRowProps {
    data: RowData;
    testId: string;
    expanded: boolean;
    highlighted?: boolean;
    /** Unsent lines can be edited; anything else is a plain row. */
    editable: boolean;
    busy?: boolean;
    onToggle: () => void;
    onQuantity: (quantity: number) => void;
    onNote: () => void;
    onRemove: () => void;
}

/** Uniform row: 26 dp quantity badge, name with a dim second line, price right-aligned in tabular figures. */
export function TicketRow({ data, testId, expanded, highlighted, editable, busy, onToggle, onQuantity, onNote, onRemove }: TicketRowProps) {
    const face = (
        <>
            <span className="qty-badge">{data.quantity}</span>
            <span className="row-main">
                <span className="row-name">{data.name}</span>
                {data.sub && <span className="row-sub">{data.sub}</span>}
            </span>
            <span className="row-price">{money(data.price)}</span>
        </>
    );
    return (
        <div className={`trow${expanded ? ' trow-open' : ''}`} data-testid={testId} data-highlighted={highlighted ? 'true' : undefined} data-expanded={expanded ? 'true' : undefined}>
            {editable ? (
                <button type="button" className="trow-face" aria-expanded={expanded} aria-label={`${data.name}${data.sub ? `, ${data.sub}` : ''}`} onClick={onToggle}>
                    {face}
                </button>
            ) : (
                <div className="trow-face">{face}</div>
            )}
            {editable && expanded && (
                <div className="trow-edit">
                    <div className="stepper stepper-big">
                        <button type="button" className="stepper-btn" aria-label="Menos" disabled={busy} onClick={() => onQuantity(data.quantity - 1)}>
                            −
                        </button>
                        <span className="stepper-n">{data.quantity}</span>
                        <button type="button" className="stepper-btn" aria-label="Más" disabled={busy} onClick={() => onQuantity(data.quantity + 1)}>
                            +
                        </button>
                    </div>
                    <button type="button" className="row-link" disabled={busy} onClick={onNote}>
                        <IconNote size={18} stroke={1.5} aria-hidden />
                        Nota
                    </button>
                    <button type="button" className="row-link" disabled={busy} onClick={onRemove}>
                        <IconTrash size={18} stroke={1.5} aria-hidden />
                        Quitar
                    </button>
                </div>
            )}
        </div>
    );
}
