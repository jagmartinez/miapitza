import type { Order, OrderItem } from '../types';

/**
 * A kitchen-voided row stays on the order (quantity 0, subtotal 0) so the KDS,
 * the table and the order history can show what was voided and why.
 */
export const isVoidedOrderLine = (item: Pick<OrderItem, 'quantity' | 'voidedQuantity' | 'voidedAt'>): boolean =>
    Boolean(item.voidedAt) || (Number(item.voidedQuantity || 0) > 0 && Number(item.quantity) === 0);

/** Live (billable) lines of an order: voided rows are excluded. */
export const billableOrderLines = (items: OrderItem[] | undefined): OrderItem[] =>
    (items || []).filter((item) => !isVoidedOrderLine(item) && Number(item.quantity) > 0);

/**
 * Why the whole order cannot have kitchen lines voided, mirroring the backend
 * guard. Null when the order is still a mutable, unpaid kitchen account.
 */
export const orderLineVoidBlocker = (
    order: Pick<Order, 'status' | 'financialStatus' | 'invoiceNumber' | 'preInvoicedAt' | 'payments'> & Partial<Pick<Order, 'salesChannel'>>,
): string | null => {
    if (order.status === 'CANCELLED') return 'La orden está cancelada.';
    if (order.salesChannel && order.salesChannel !== 'RESTAURANT') {
        return 'Las órdenes de canales externos no admiten anular líneas: use el flujo de cancelación del canal.';
    }
    if (order.status === 'DELIVERED') return 'La orden ya fue entregada; use una cancelación o nota de crédito.';
    if (order.invoiceNumber) return 'La orden está facturada: emita una nota de crédito para anular productos.';
    if (order.preInvoicedAt) return 'La orden tiene prefactura: revierta la prefactura antes de anular productos.';
    const activePayments = (order.payments || []).filter((payment) => payment.status !== 'REVERSED');
    if (order.financialStatus !== 'UNPAID' || activePayments.length > 0) {
        return 'La orden tiene pagos registrados: revierta los pagos antes de anular productos.';
    }
    return null;
};

/** A line can be voided once it was sent to kitchen and still has live units. */
export const isVoidableOrderLine = (item: OrderItem): boolean =>
    Boolean(item.sentAt) && !isVoidedOrderLine(item) && Number(item.quantity) > 0;

export const voidableOrderLines = (order: Pick<Order, 'items'>): OrderItem[] =>
    (order.items || []).filter(isVoidableOrderLine);

export interface OrderLineVoidRequest {
    quantity: number;
    reason: string;
    warehouseId?: number;
}

/** Client-side validation that mirrors POST /orders/:id/items/:itemId/void. */
export const validateOrderLineVoid = (item: OrderItem | undefined, request: OrderLineVoidRequest): string | null => {
    if (!item || !isVoidableOrderLine(item)) return 'Seleccione una línea ya enviada a cocina.';
    if (!Number.isInteger(request.quantity) || request.quantity < 1) return 'La cantidad a anular debe ser al menos 1.';
    if (request.quantity > Number(item.quantity)) return `Solo hay ${item.quantity} unidad(es) en esta línea.`;
    const reason = request.reason.trim();
    if (reason.length < 3) return 'Indique el motivo de la anulación (mínimo 3 caracteres).';
    if (reason.length > 500) return 'El motivo no puede superar 500 caracteres.';
    return null;
};
