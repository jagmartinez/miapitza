/** Helpers for partial purchase-order receipts (quantities in the purchase unit). */

const round6 = (value: number) => Math.round((value + Number.EPSILON) * 1e6) / 1e6;

export function remainingQuantity(item: { quantity: number | string; receivedQuantity?: number | string | null }): number {
    const remaining = Number(item.quantity) - Number(item.receivedQuantity ?? 0);
    return remaining > 1e-9 ? round6(remaining) : 0;
}

export function formatQty(value: number): string {
    return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 6, useGrouping: false });
}

export const PURCHASE_ORDER_STATUS_LABELS: Record<string, string> = {
    DRAFT: 'Borrador',
    ISSUED: 'Emitida',
    PARTIALLY_RECEIVED: 'Recibida parcial',
    RECEIVED: 'Recibida',
    CANCELLED: 'Cancelada',
};

/**
 * What is owed for the order: a partially received order owes only the value
 * received so far; a received (complete or closed short) order owes its total.
 */
export function purchaseOrderPayable(order: { status: string; total: number | string; receivedTotal?: number | string | null }): number {
    return order.status === 'PARTIALLY_RECEIVED' ? Number(order.receivedTotal ?? 0) : Number(order.total);
}

export function apiErrorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'response' in error) {
        const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (message) return message;
    }
    return fallback;
}

/** Local YYYY-MM-DD of an order date, or null when it cannot be parsed. */
function localDateKey(value: string | Date | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Date-range visibility for the purchase-order list. A PARTIALLY_RECEIVED order
 * still owes goods, so it stays visible outside the range (flagged `outOfRange`)
 * unless the user explicitly filters by a different status.
 */
export function purchaseOrderDateVisibility(
    order: { status: string; date?: string | Date | null },
    range: { startDate?: string; endDate?: string; statusFilter: string },
): { visible: boolean; outOfRange: boolean } {
    const key = localDateKey(order.date);
    // No range, or an unparseable date: never hide the order silently.
    if ((!range.startDate && !range.endDate) || key === null) return { visible: true, outOfRange: false };
    const inRange = !(range.startDate && key < range.startDate) && !(range.endDate && key > range.endDate);
    if (inRange) return { visible: true, outOfRange: false };
    const keepPendingBalance = order.status === 'PARTIALLY_RECEIVED'
        && (range.statusFilter === 'all' || range.statusFilter === 'PARTIALLY_RECEIVED');
    return { visible: keepPendingBalance, outOfRange: keepPendingBalance };
}
