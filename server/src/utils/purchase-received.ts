/**
 * Received-basis helpers for purchase reporting. A purchase counts for what
 * actually arrived: PARTIALLY_RECEIVED orders contribute their receipts, and
 * an order closed short (RECEIVED with receivingClosedAt) its received lines,
 * never the ordered quantity of the abandoned remainder.
 */

/** Order statuses that carry received (stocked) purchases. */
export const RECEIVED_PURCHASE_STATUSES = ['RECEIVED', 'PARTIALLY_RECEIVED'] as const;

type NumberLike = number | string | { toString(): string } | null | undefined;

/** Received value of an order: receivedTotal while partial, else the (closing-adjusted) total. */
export function purchaseOrderReceivedValue(order: { status: string; total: NumberLike; receivedTotal?: NumberLike }): number {
    return order.status === 'PARTIALLY_RECEIVED'
        ? Number(order.receivedTotal ?? 0)
        : Number(order.total ?? 0);
}

/**
 * Received share of one line: `value` (purchase money) and `baseQuantity`
 * (product base unit, null for legacy lines without conversion data). The
 * share is receivedQuantity / quantity, in the line's purchase unit.
 */
export function purchaseLineReceived(item: {
    quantity: NumberLike;
    receivedQuantity?: NumberLike;
    subtotal: NumberLike;
    baseQuantity?: NumberLike;
}): { fraction: number; value: number; baseQuantity: number | null } {
    const ordered = Number(item.quantity ?? 0);
    const received = Number(item.receivedQuantity ?? 0);
    const fraction = ordered > 0 && Number.isFinite(received)
        ? Math.min(1, Math.max(0, received / ordered))
        : 0;
    return {
        fraction,
        value: Number(item.subtotal ?? 0) * fraction,
        baseQuantity: item.baseQuantity == null ? null : Number(item.baseQuantity) * fraction
    };
}
