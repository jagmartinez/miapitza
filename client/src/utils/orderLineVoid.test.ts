import { describe, expect, it } from 'vitest';
import type { Order, OrderItem } from '../types';
import {
    billableOrderLines,
    isVoidableOrderLine,
    isVoidedOrderLine,
    orderLineVoidBlocker,
    validateOrderLineVoid,
    voidableOrderLines,
} from './orderLineVoid';

const line = (overrides: Partial<OrderItem>): OrderItem => ({
    id: 1,
    orderId: 41,
    menuItemId: 3,
    menuItem: { id: 3, name: 'Hamburguesa' } as OrderItem['menuItem'],
    quantity: 3,
    price: 12.5,
    subtotal: 37.5,
    status: 'IN_PROGRESS',
    sentAt: '2026-11-18T12:00:00Z',
    ...overrides,
});

const order = (overrides: Partial<Order> = {}) => ({
    status: 'IN_PREPARATION',
    financialStatus: 'UNPAID',
    invoiceNumber: undefined,
    preInvoicedAt: undefined,
    payments: [],
    items: [],
    ...overrides,
}) as unknown as Order;

describe('order line void helpers', () => {
    it('recognises voided rows and keeps them out of billable lines', () => {
        const voided = line({ id: 2, quantity: 0, subtotal: 0, voidedQuantity: 2, voidedAt: '2026-11-18T12:05:00Z' });
        const live = line({ id: 1 });
        const draft = line({ id: 3, sentAt: undefined, status: 'PENDING' });
        expect(isVoidedOrderLine(voided)).toBe(true);
        expect(isVoidedOrderLine(live)).toBe(false);
        expect(billableOrderLines([live, voided, draft]).map((item) => item.id)).toEqual([1, 3]);
        expect(isVoidableOrderLine(draft)).toBe(false);
        expect(voidableOrderLines(order({ items: [live, voided, draft] })).map((item) => item.id)).toEqual([1]);
    });

    it('mirrors the backend refusals for pre-invoiced, invoiced, paid and closed orders', () => {
        expect(orderLineVoidBlocker(order())).toBeNull();
        expect(orderLineVoidBlocker(order({ preInvoicedAt: '2026-11-18T12:00:00Z' }))).toMatch(/revierta la prefactura/i);
        expect(orderLineVoidBlocker(order({ invoiceNumber: 'FAC-1' }))).toMatch(/nota de crédito/i);
        expect(orderLineVoidBlocker(order({ financialStatus: 'PARTIAL' }))).toMatch(/revierta los pagos/i);
        expect(orderLineVoidBlocker(order({ status: 'DELIVERED' }))).toMatch(/entregada/i);
        expect(orderLineVoidBlocker(order({ status: 'CANCELLED' }))).toMatch(/cancelada/i);
        expect(orderLineVoidBlocker(order({ salesChannel: 'PEDIDOSYA' }))).toMatch(/canal/i);
        expect(orderLineVoidBlocker(order({ salesChannel: 'RESTAURANT' }))).toBeNull();
    });

    it('validates quantity and a required reason', () => {
        const live = line({ quantity: 3 });
        expect(validateOrderLineVoid(live, { quantity: 2, reason: 'Plato devuelto' })).toBeNull();
        expect(validateOrderLineVoid(live, { quantity: 4, reason: 'Plato devuelto' })).toMatch(/Solo hay 3/);
        expect(validateOrderLineVoid(live, { quantity: 0, reason: 'Plato devuelto' })).toMatch(/al menos 1/);
        expect(validateOrderLineVoid(live, { quantity: 1, reason: '  ' })).toMatch(/motivo/i);
        expect(validateOrderLineVoid(undefined, { quantity: 1, reason: 'Error' })).toMatch(/Seleccione/);
    });
});
