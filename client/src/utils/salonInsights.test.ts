import { describe, expect, it } from 'vitest';
import type { Order, Table } from '../types';
import {
    computeOpenConsumption,
    longestOpenTable,
    nextReservation,
    openAmountByTable,
    openMinutesByTable,
} from './salonInsights';

const NOW = new Date('2026-11-25T20:00:00Z').getTime();
const mk = (id: number, extra: Partial<Order> = {}): Order => ({
    id,
    branchId: 1,
    tableId: id,
    table: { id, number: String(id) },
    total: 100,
    status: 'OPEN',
    financialStatus: 'UNPAID',
    createdAt: new Date(NOW - 30 * 60000).toISOString(),
    items: [],
    ...extra,
} as unknown as Order);

describe('salonInsights', () => {
    it('consumo abierto suma solo mesas sin pago y cuenta facturadas sin cobrar', () => {
        const orders = [
            mk(1, { total: 100.5, invoiceNumber: 'F-1' }),
            mk(2, { total: 50 }),
            mk(3, { total: 999, financialStatus: 'PAID' }),
            mk(4, { total: 70, financialStatus: 'PARTIAL' }),
            mk(5, { total: 20, status: 'CANCELLED' }),
            mk(6, { tableId: undefined, total: 40 }),
        ];
        expect(computeOpenConsumption(orders)).toEqual({ amount: 150.5, orderCount: 2, invoicedUnpaid: 1, partialCount: 1 });
    });

    it('mesa abierta más tiempo y minutos por mesa', () => {
        const orders = [
            mk(1, { createdAt: new Date(NOW - 95 * 60000).toISOString() }),
            mk(2, { createdAt: new Date(NOW - 10 * 60000).toISOString() }),
        ];
        expect(longestOpenTable(orders, NOW)).toEqual({ minutes: 95, tableNumber: '1', orderId: 1 });
        expect(openMinutesByTable(orders, NOW).get(2)).toBe(10);
        expect(openAmountByTable(orders).get(1)).toBe(100);
        expect(longestOpenTable([], NOW)).toBeNull();
    });

    it('próxima reserva avisa si su mesa sigue ocupada', () => {
        const tables = [{ id: 9, status: 'OCCUPIED' }] as Table[];
        const res = [
            { id: 1, customerName: 'Tarde', date: new Date(NOW + 3 * 3600000).toISOString(), peopleCount: 2, status: 'CONFIRMED', table: null },
            { id: 2, customerName: 'Pronto', date: new Date(NOW + 3600000).toISOString(), peopleCount: 4, status: 'PENDING', table: { id: 9, number: '9' } },
            { id: 3, customerName: 'Cancelada', date: new Date(NOW + 60000).toISOString(), peopleCount: 1, status: 'CANCELLED', table: null },
        ];
        const next = nextReservation(res, tables, NOW);
        expect(next?.reservation.customerName).toBe('Pronto');
        expect(next?.mustRelease).toBe(true);
        expect(nextReservation([], tables, NOW)).toBeNull();
    });
});
