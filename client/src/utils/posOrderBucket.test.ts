import { describe, expect, it } from 'vitest';
import {
    buildInvoiceStatusMessage,
    findTableAccountForTable,
    isEligibleForPosOrderBucket,
} from './posOrderBucket';

const baseOrder = {
    id: 36,
    tableId: 9,
    table: { id: 9, number: 'ABANICO' },
    invoiceNumber: undefined,
    invoicedAt: undefined,
    invoiceFiscalStatus: 'NOT_ISSUED' as const,
};

describe('POS order bucket lifecycle', () => {
    it('never adopts a fiscally issued order as the editable table bucket', () => {
        expect(isEligibleForPosOrderBucket(baseOrder)).toBe(true);
        expect(isEligibleForPosOrderBucket({
            ...baseOrder,
            invoiceNumber: 'FAC-1-000009',
            invoiceFiscalStatus: 'ISSUED',
        })).toBe(false);
        expect(isEligibleForPosOrderBucket({
            ...baseOrder,
            invoicedAt: '2026-07-24T12:00:00.000Z',
        })).toBe(false);
        expect(isEligibleForPosOrderBucket({
            ...baseOrder,
            invoiceFiscalStatus: 'PARTIALLY_CREDITED',
        })).toBe(false);
    });

    it('keeps an invoiced unpaid account attached to its table while treating it as non-editable', () => {
        const fiscalResidue = {
            ...baseOrder,
            invoiceNumber: 'FAC-1-000009',
            invoiceFiscalStatus: 'ISSUED' as const,
        };
        const openOrder = {
            ...baseOrder,
            id: 41,
            invoiceFiscalStatus: 'NOT_ISSUED' as const,
        };

        expect(findTableAccountForTable([fiscalResidue], 9)).toBe(fiscalResidue);
        expect(isEligibleForPosOrderBucket(fiscalResidue)).toBe(false);
        expect(findTableAccountForTable([openOrder], 9)).toBe(openOrder);
        expect(findTableAccountForTable([fiscalResidue, openOrder], 9)).toBe(fiscalResidue);
    });

    it('communicates table occupancy, payment and delivery without claiming settlement prematurely', () => {
        expect(buildInvoiceStatusMessage({
            invoiceNumber: 'FAC-1-000009',
            orderId: 36,
            tableNumber: 'ABANICO',
            financialStatus: 'UNPAID',
        })).toBe(
            'Factura FAC-1-000009 emitida. Mesa ABANICO permanece ocupada hasta confirmar el pago total. '
            + 'La orden #36 queda pendiente de pago y luego de entrega en Pedidos; '
            + 'el inventario se descontará al entregar.',
        );
        expect(buildInvoiceStatusMessage({
            invoiceNumber: 'FAC-1-000010',
            orderId: 37,
            tableNumber: '2',
            financialStatus: 'PAID',
        })).toContain('Mesa 2 liberada por pago total.');
    });
});
