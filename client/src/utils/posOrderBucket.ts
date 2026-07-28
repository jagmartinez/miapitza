import type { Order } from '../types';

type PosBucketOrder = Pick<Order, 'id' | 'tableId' | 'table' | 'invoiceNumber' | 'invoicedAt' | 'invoiceFiscalStatus'>;

export function isEligibleForPosOrderBucket(order: PosBucketOrder): boolean {
    if (order.invoiceNumber?.trim() || order.invoicedAt) {
        return false;
    }

    return !order.invoiceFiscalStatus || order.invoiceFiscalStatus === 'NOT_ISSUED';
}

/**
 * Returns the account that owns the table, including an immutable invoiced
 * account. The active-account API is oldest-first, so historical duplicate
 * accounts are recovered one at a time. Editability and physical occupancy
 * are intentionally independent.
 */
export function findTableAccountForTable<T extends PosBucketOrder>(
    orders: T[],
    tableId: number,
): T | null {
    return orders.find((order) => {
        const orderTableId = order.tableId ?? order.table?.id;
        return orderTableId === tableId;
    }) ?? null;
}

export function buildInvoiceStatusMessage(input: {
    invoiceNumber: string;
    orderId: number;
    tableNumber?: string | null;
    financialStatus: Order['financialStatus'];
}): string {
    const tableState = input.tableNumber
        ? input.financialStatus === 'PAID'
            ? ` Mesa ${input.tableNumber} liberada por pago total.`
            : ` Mesa ${input.tableNumber} permanece ocupada hasta confirmar el pago total.`
        : '';
    const pendingHandoff = input.financialStatus === 'PAID'
        ? ` La orden #${input.orderId} queda pendiente de entrega en Pedidos; allí se descontará el inventario.`
        : ` La orden #${input.orderId} queda pendiente de pago y luego de entrega en Pedidos; el inventario se descontará al entregar.`;

    return `Factura ${input.invoiceNumber} emitida.${tableState}${pendingHandoff}`;
}
