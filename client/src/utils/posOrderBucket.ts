import type { Order } from '../types';

type PosBucketOrder = Pick<Order, 'id' | 'tableId' | 'table' | 'invoiceNumber' | 'invoicedAt' | 'invoiceFiscalStatus'>;

export function isEligibleForPosOrderBucket(order: PosBucketOrder): boolean {
    if (order.invoiceNumber?.trim() || order.invoicedAt) {
        return false;
    }

    return !order.invoiceFiscalStatus || order.invoiceFiscalStatus === 'NOT_ISSUED';
}

export function findPosOrderBucketForTable<T extends PosBucketOrder>(
    orders: T[],
    tableId: number,
): T | null {
    return orders.find((order) => {
        const orderTableId = order.tableId ?? order.table?.id;
        return orderTableId === tableId && isEligibleForPosOrderBucket(order);
    }) ?? null;
}

export class PosBucketReleaseTracker {
    private readonly releasedOrderIds = new Set<number>();

    releaseAfterConfirmedInvoice(
        orderId: number,
        invoiceNumber: string | null | undefined,
        release: () => void,
    ): boolean {
        if (!invoiceNumber?.trim() || this.releasedOrderIds.has(orderId)) {
            return false;
        }

        this.releasedOrderIds.add(orderId);
        release();
        return true;
    }
}

export function buildInvoiceReleaseMessage(input: {
    invoiceNumber: string;
    orderId: number;
    tableNumber?: string | null;
    financialStatus: Order['financialStatus'];
}): string {
    const tableRelease = input.tableNumber
        ? ` Mesa ${input.tableNumber} liberada.`
        : '';
    const pendingHandoff = input.financialStatus === 'PAID'
        ? ` La orden #${input.orderId} queda pendiente de entrega en Pedidos; allí se descontará el inventario.`
        : ` La orden #${input.orderId} queda pendiente de pago y luego de entrega en Pedidos; el inventario se descontará al entregar.`;

    return `Factura ${input.invoiceNumber} emitida.${tableRelease}${pendingHandoff}`;
}
