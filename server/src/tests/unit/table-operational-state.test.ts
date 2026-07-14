import { describe, expect, it } from '@jest/globals';
import { deriveTableOperationalState } from '../../services/table.service';

const order = (overrides: Partial<Parameters<typeof deriveTableOperationalState>[1][number]> = {}) => ({
    status: 'OPEN' as const,
    financialStatus: 'UNPAID' as const,
    invoiceNumber: null,
    items: [{ status: 'PENDING' as const }],
    ...overrides
});

describe('table operational map state', () => {
    it('does not depend on color-only physical occupancy', () => {
        expect(deriveTableOperationalState('OCCUPIED', [])).toBe('ATTENTION');
        expect(deriveTableOperationalState('OUT_OF_SERVICE', [])).toBe('DISABLED');
        expect(deriveTableOperationalState('RESERVED', [])).toBe('RESERVED');
    });

    it('distinguishes kitchen progression including partial readiness', () => {
        expect(deriveTableOperationalState('OCCUPIED', [order({ status: 'SENT_TO_KITCHEN' })])).toBe('WAITING_KITCHEN');
        expect(deriveTableOperationalState('OCCUPIED', [order({
            status: 'IN_PREPARATION',
            items: [{ status: 'DONE' }, { status: 'IN_PROGRESS' }]
        })])).toBe('PARTIALLY_READY');
        expect(deriveTableOperationalState('OCCUPIED', [order({ status: 'READY' })])).toBe('READY');
    });

    it('prioritizes invoice and payment state over kitchen state', () => {
        expect(deriveTableOperationalState('OCCUPIED', [order({ invoiceNumber: 'F-1' })])).toBe('INVOICED');
        expect(deriveTableOperationalState('OCCUPIED', [order({ financialStatus: 'PARTIAL' })])).toBe('PARTIAL_PAYMENT');
        expect(deriveTableOperationalState('OCCUPIED', [order({ financialStatus: 'PAID' })])).toBe('PAID');
    });
});
