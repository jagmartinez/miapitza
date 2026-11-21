import { describe, expect, it } from 'vitest';
import { kitchenLabel } from './kitchenLabel';

describe('kitchenLabel', () => {
    it('uses the table number', () => expect(kitchenLabel({ id: 9, table: { number: 5 }, customerName: 'Ana' })).toBe('M5'));
    it('falls back to the customer name', () => expect(kitchenLabel({ id: 9, table: null, customerName: ' Ana ' })).toBe('Ana'));
    it('falls back to takeaway number', () => expect(kitchenLabel({ id: 9, table: null, customerName: '' })).toBe('Llevar #9'));
});
