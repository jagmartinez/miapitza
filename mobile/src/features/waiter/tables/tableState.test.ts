import { tableState } from './tableState';

describe('tableState', () => {
    it('maps operationalState to the four border states', () => {
        const state = (operationalState: string) => tableState({ operationalState }, undefined);
        expect(state('AVAILABLE')).toBe('free');
        expect(state('OPEN_ORDER')).toBe('occupied');
        expect(state('WAITING_KITCHEN')).toBe('occupied');
        expect(state('PREPARING')).toBe('occupied');
        expect(state('READY')).toBe('ready');
        expect(state('PARTIALLY_READY')).toBe('ready');
        expect(state('INVOICED')).toBe('due');
        expect(state('PARTIAL_PAYMENT')).toBe('due');
    });

    it('falls back to the table status and the order when the plan has no operationalState', () => {
        expect(tableState({ status: 'AVAILABLE' }, undefined)).toBe('free');
        expect(tableState({ status: 'OCCUPIED' }, undefined)).toBe('occupied');
        expect(tableState({}, { status: 'READY' })).toBe('ready');
    });
});
