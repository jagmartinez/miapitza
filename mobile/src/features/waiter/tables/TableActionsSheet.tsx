import { useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import { isAmbiguousMutationFailure } from '@web/utils/idempotency';
import { can } from '../../../core/permissions';
import type { LoginUser } from '../../../core/session';
import { plural } from '../../../core/text';
import { IconArrowRight, IconFileInvoice, IconLink } from '../../../ui/Icon';
import { money } from '../order/orderModel';
import { Sheet } from './Sheet';
import { elapsedMinutes, formatElapsed, type ActiveOrder, type PlanTable } from './tableState';

export type SheetAction = 'view' | 'pay' | 'invoice' | 'transfer' | 'group';

/** Sum of a decimal-ish field over a list; strings from the API are decimals. */
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Sum of ACTIVE payments of a GET /orders/:id payload (it lists reversed ones too). */
export function paidAmount(detail: unknown): number {
    const payments = (detail as { payments?: { amount?: unknown; status?: string }[] } | null)?.payments;
    if (!Array.isArray(payments)) return 0;
    return payments.filter((p) => !p.status || p.status === 'ACTIVE').reduce((sum, p) => sum + num(p.amount), 0);
}

export interface TableActionsSheetProps {
    table: PlanTable;
    areaName: string;
    order: ActiveOrder;
    user: LoginUser;
    online: boolean;
    now: number;
    /** GET /orders/:id: /orders/active carries no payments, so what is already paid is read on demand. */
    loadDetail: (orderId: number) => Promise<unknown>;
    onClose: () => void;
    onAction: (action: SheetAction) => void;
    /** Downloads and shares the invoice PDF of the order. Rejects when the download or the share fails. */
    onInvoicePdf?: (order: ActiveOrder) => Promise<void>;
}

export function TableActionsSheet({ table, areaName, order, user, online, now, loadDetail, onClose, onAction, onInvoicePdf }: TableActionsSheetProps) {
    const [paid, setPaid] = useState<number | null>(null);
    const [invoiceBusy, setInvoiceBusy] = useState(false);
    const [invoiceError, setInvoiceError] = useState<string | null>(null);
    const invoiceRef = useRef(false);
    useEffect(() => {
        if (!online) return undefined;
        let alive = true;
        loadDetail(Number(order.id)).then(
            (detail) => alive && setPaid(paidAmount(detail)),
            () => undefined, // unknown stays as a dash
        );
        return () => {
            alive = false;
        };
    }, [online, order.id, loadDetail]);
    const unpaid = paid === null ? null : Math.max(0, num(order.total) - paid);

    const items = (order.items ?? []).filter((i) => !i.voidedQuantity || i.voidedQuantity < i.quantity);
    const products = items.reduce((sum, i) => sum + num(i.quantity) - num(i.voidedQuantity), 0);
    const inKitchen = items.filter((i) => i.sentAt && i.status !== 'DONE').reduce((sum, i) => sum + num(i.quantity), 0);
    const minutes = elapsedMinutes(order.createdAt, now);
    const chips = [
        order.guests ? plural(order.guests, 'persona', 'personas') : null,
        minutes !== null ? formatElapsed(minutes) : null,
        `${products} ${products === 1 ? 'producto' : 'productos'}`,
        `${inKitchen} en cocina`,
    ].filter((c): c is string => !!c);

    const canView = can(user, 'orders.view');
    const canPay = can(user, 'payments.process') && can(user, 'invoices.issue');
    const canTransfer = can(user, 'tables.transfer');
    const canGroup = can(user, 'tables.group.manage');
    // The PDF route needs invoices.view (server invoice.routes); the tile is for whoever issues invoices, and only once the order has one.
    const canInvoice = !!onInvoicePdf && can(user, 'invoices.issue') && can(user, 'invoices.view') && !!order.invoiceNumber && !order.pendingSync;

    const openInvoice = async () => {
        if (!onInvoicePdf || invoiceRef.current) return; // a double tap shares once
        invoiceRef.current = true;
        setInvoiceBusy(true);
        setInvoiceError(null);
        try {
            await onInvoicePdf(order);
        } catch (cause) {
            // Ambiguous (network, timeout, 5xx): tapping Factura again is the retry. A definitive answer says why.
            setInvoiceError(isAmbiguousMutationFailure(cause) ? 'No se pudo abrir la factura. Toca Factura para reintentar.' : `No se pudo abrir la factura. ${getApiErrorMessage(cause)}`);
        } finally {
            invoiceRef.current = false;
            setInvoiceBusy(false);
        }
    };

    return (
        <Sheet
            label={`Acciones de la mesa ${table.number}`}
            title={`Mesa ${table.number}`}
            subtitle={[areaName, order.user?.name].filter(Boolean).join(' · ')}
            aside={
                <div className="actions-total">
                    <strong>{unpaid === null ? '—' : money(unpaid)}</strong>
                    <span className="muted">sin cobrar</span>
                </div>
            }
            onClose={onClose}
        >
            <div className="info-chips">
                {chips.map((c) => (
                    <span key={c} className="info-chip">
                        {c}
                    </span>
                ))}
            </div>
            {(canView || canPay) && (
                <div className="actions-main">
                    {canView && (
                        <button type="button" className="btn" onClick={() => onAction('view')}>
                            Ver pedido
                        </button>
                    )}
                    {canPay && (
                        <button type="button" className="btn btn-primary" onClick={() => onAction('pay')}>
                            Cobrar
                        </button>
                    )}
                </div>
            )}
            {(canTransfer || canGroup || canInvoice) && (
                <div className="actions-grid">
                    {canTransfer && (
                        <button type="button" className="btn-ghost action-tile" disabled={!online} onClick={() => onAction('transfer')}>
                            <IconArrowRight size={20} stroke={1.5} aria-hidden />
                            <span>Trasladar</span>
                            {!online && <small className="muted">requiere conexión</small>}
                        </button>
                    )}
                    {canGroup && (
                        <button type="button" className="btn-ghost action-tile" disabled={!online} onClick={() => onAction('group')}>
                            <IconLink size={20} stroke={1.5} aria-hidden />
                            <span>Unir</span>
                            {!online && <small className="muted">requiere conexión</small>}
                        </button>
                    )}
                    {canInvoice && (
                        <button type="button" className="btn-ghost action-tile" disabled={!online || invoiceBusy} onClick={() => void openInvoice()}>
                            <IconFileInvoice size={20} stroke={1.5} aria-hidden />
                            <span>{invoiceBusy ? 'Abriendo…' : 'Factura'}</span>
                            {!online && <small className="muted">requiere conexión</small>}
                        </button>
                    )}
                </div>
            )}
            {invoiceError && (
                <p className="error" role="alert">
                    {invoiceError}
                </p>
            )}
        </Sheet>
    );
}
