import { describe, expect, it } from 'vitest';
import { orderWhereLabel } from './orderWhere';

describe('orderWhereLabel', () => {
    it('usa la mesa cuando existe', () => {
        expect(orderWhereLabel({ table: { id: 1, number: 'S3' }, orderType: 'DINE_IN' })).toBe('Mesa S3');
    });
    it('una orden sin mesa es para llevar, con el nombre para llamar', () => {
        expect(orderWhereLabel({ orderType: 'TAKEOUT', customerName: 'Ana' })).toBe('Para llevar · Ana');
        expect(orderWhereLabel({})).toBe('Para llevar');
    });
    it('delivery muestra el canal', () => {
        expect(orderWhereLabel({ orderType: 'DELIVERY', salesChannel: 'PEDIDOSYA' })).toBe('Delivery · PedidosYa');
        expect(orderWhereLabel({ salesChannel: 'RESTAURANT', orderType: 'DELIVERY' })).toBe('Delivery');
    });
});
