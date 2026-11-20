import { useEffect, useState } from 'react';
import { formatCurrency } from '@web/utils/currency';
import { can } from '../../../core/permissions';
import type { LoginUser } from '../../../core/session';
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
}

export function TableActionsSheet({ table, areaName, order, user, online, now, loadDetail, onClose, onAction }: TableActionsSheetProps) {
    const [paid, setPaid] = useState<number | null>(null);
    useEffect(() => {
        if (!online) return undefined;
        let alive = true;
        loadDetail(order.id).then(
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
        order.guests ? `${order.guests} pers` : null,
        minutes !== null ? formatElapsed(minutes) : null,
        `${products} ${products === 1 ? 'producto' : 'productos'}`,
        `${inKitchen} en cocina`,
    ].filter((c): c is string => !!c);

    const canView = can(user, 'orders.view');
    const canPay = can(user, 'payments.process') && can(user, 'invoices.issue');
    const canTransfer = can(user, 'tables.transfer');
    const canGroup = can(user, 'tables.group.manage');
    const canInvoice = can(user, 'invoices.issue');

    return (
        <Sheet label={`Acciones de la mesa ${table.number}`} onClose={onClose}>
            <div className="actions-head">
                <div>
                    <h2 className="sheet-title">{`Mesa ${table.number} · ${areaName}`}</h2>
                    {order.user?.name && <p className="muted sheet-sub">{order.user.name}</p>}
                </div>
                <div className="actions-total">
                    <span className="muted">Sin cobrar</span>
                    <strong>{unpaid === null ? '—' : formatCurrency(unpaid)}</strong>
                </div>
            </div>
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
                        <button type="button" className="btn action-tile" disabled={!online} onClick={() => onAction('transfer')}>
                            <span>Trasladar</span>
                            {!online && <small className="muted">requiere conexión</small>}
                        </button>
                    )}
                    {canGroup && (
                        <button type="button" className="btn action-tile" disabled={!online} onClick={() => onAction('group')}>
                            <span>Unir</span>
                            {!online && <small className="muted">requiere conexión</small>}
                        </button>
                    )}
                    {canInvoice && (
                        <button type="button" className="btn action-tile" onClick={() => onAction('invoice')}>
                            <span>Factura</span>
                        </button>
                    )}
                </div>
            )}
        </Sheet>
    );
}
