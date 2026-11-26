import { describe, expect, it } from 'vitest';
import { tableTileState } from './tableTileState';

describe('tableTileState', () => {
    it('distingue libre, ocupada y pre-cuenta', () => {
        expect(tableTileState({ status: 'AVAILABLE' }).label).toBe('Libre');
        expect(tableTileState({ status: 'OCCUPIED' }).label).toBe('Ocupada');
        expect(tableTileState({ status: 'OCCUPIED', operationalState: 'INVOICED' }).key).toBe('PENDING_PAYMENT');
    });
    it('conserva reservada y fuera de servicio', () => {
        expect(tableTileState({ status: 'RESERVED' }).key).toBe('RESERVED');
        expect(tableTileState({ status: 'OUT_OF_SERVICE' }).label).toBe('Fuera de servicio');
    });
});
