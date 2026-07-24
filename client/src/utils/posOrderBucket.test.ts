import { describe, expect, it, vi } from 'vitest';
import {
    buildInvoiceReleaseMessage,
    findPosOrderBucketForTable,
    isEligibleForPosOrderBucket,
    PosBucketReleaseTracker,
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

    it('selects only the non-invoiced order when an active list contains a fiscal residue', () => {
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

        expect(findPosOrderBucketForTable([fiscalResidue], 9)).toBeNull();
        expect(findPosOrderBucketForTable([fiscalResidue, openOrder], 9)).toBe(openOrder);
    });

    it('releases exactly once after confirmed invoicing, but not on failure, offline preparation, or retry', () => {
        const tracker = new PosBucketReleaseTracker();
        const clearBucket = vi.fn();

        expect(tracker.releaseAfterConfirmedInvoice(36, undefined, clearBucket)).toBe(false);
        expect(tracker.releaseAfterConfirmedInvoice(36, '', clearBucket)).toBe(false);
        expect(clearBucket).not.toHaveBeenCalled();

        expect(tracker.releaseAfterConfirmedInvoice(36, 'FAC-1-000009', clearBucket)).toBe(true);
        expect(tracker.releaseAfterConfirmedInvoice(36, 'FAC-1-000009', clearBucket)).toBe(false);
        expect(clearBucket).toHaveBeenCalledTimes(1);
    });

    it('communicates payment and delivery handoff without claiming payment prematurely', () => {
        expect(buildInvoiceReleaseMessage({
            invoiceNumber: 'FAC-1-000009',
            orderId: 36,
            tableNumber: 'ABANICO',
            financialStatus: 'UNPAID',
        })).toBe(
            'Factura FAC-1-000009 emitida. Mesa ABANICO liberada. '
            + 'La orden #36 queda pendiente de pago y luego de entrega en Pedidos; '
            + 'el inventario se descontará al entregar.',
        );
        expect(buildInvoiceReleaseMessage({
            invoiceNumber: 'FAC-1-000010',
            orderId: 37,
            tableNumber: '2',
            financialStatus: 'PAID',
        })).toContain('queda pendiente de entrega en Pedidos');
    });
});
