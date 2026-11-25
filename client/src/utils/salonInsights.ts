import type { Order, Table } from '../types';

export interface UpcomingReservation {
    id: number;
    customerName: string;
    date: string;
    peopleCount: number;
    status: string;
    table?: { id: number; number: string } | null;
}

const toNumber = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

/** Órdenes de mesa con consumo abierto (sin cobrar y no canceladas). */
export function openTableOrders(orders: Order[]): Order[] {
    return orders.filter((o) => o.tableId != null && o.status !== 'CANCELLED' && o.financialStatus !== 'PAID');
}

export interface OpenConsumption {
    /** Suma de órdenes de mesa sin ningún pago; los pagos parciales se excluyen porque el saldo no viene en la orden. */
    amount: number;
    orderCount: number;
    /** Facturadas (pre-cuenta emitida) y todavía sin cobrar. */
    invoicedUnpaid: number;
    partialCount: number;
}

export function computeOpenConsumption(orders: Order[]): OpenConsumption {
    const open = openTableOrders(orders);
    const unpaid = open.filter((o) => o.financialStatus === 'UNPAID');
    return {
        amount: unpaid.reduce((sum, o) => sum + toNumber(o.total), 0),
        orderCount: unpaid.length,
        invoicedUnpaid: unpaid.filter((o) => !!o.invoiceNumber).length,
        partialCount: open.length - unpaid.length,
    };
}

export interface LongestOpen {
    minutes: number;
    tableNumber: string;
    orderId: number;
}

export function longestOpenTable(orders: Order[], now: number): LongestOpen | null {
    let best: LongestOpen | null = null;
    for (const order of openTableOrders(orders)) {
        const started = new Date(order.createdAt).getTime();
        if (!Number.isFinite(started)) continue;
        const minutes = Math.max(0, Math.floor((now - started) / 60000));
        if (!best || minutes > best.minutes) {
            best = { minutes, tableNumber: order.table?.number ?? String(order.tableId), orderId: order.id };
        }
    }
    return best;
}

/** Minutos abiertos por mesa (la orden más antigua sin cobrar de cada mesa). */
export function openMinutesByTable(orders: Order[], now: number): Map<number, number> {
    const result = new Map<number, number>();
    for (const order of openTableOrders(orders)) {
        const started = new Date(order.createdAt).getTime();
        if (!Number.isFinite(started) || order.tableId == null) continue;
        const minutes = Math.max(0, Math.floor((now - started) / 60000));
        result.set(order.tableId, Math.max(result.get(order.tableId) ?? 0, minutes));
    }
    return result;
}

export function openAmountByTable(orders: Order[]): Map<number, number> {
    const result = new Map<number, number>();
    for (const order of openTableOrders(orders)) {
        if (order.tableId == null || order.financialStatus !== 'UNPAID') continue;
        result.set(order.tableId, (result.get(order.tableId) ?? 0) + toNumber(order.total));
    }
    return result;
}

export interface NextReservationInfo {
    reservation: UpcomingReservation;
    /** La mesa asignada sigue ocupada: debe liberarse antes de la hora. */
    mustRelease: boolean;
}

export function nextReservation(reservations: UpcomingReservation[], tables: Table[], now: number): NextReservationInfo | null {
    const upcoming = reservations
        .filter((r) => ['PENDING', 'CONFIRMED'].includes(r.status) && new Date(r.date).getTime() >= now)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const reservation = upcoming[0];
    if (!reservation) return null;
    const tableId = reservation.table?.id;
    const table = tableId != null ? tables.find((t) => t.id === tableId) : undefined;
    return { reservation, mustRelease: table?.status === 'OCCUPIED' };
}
