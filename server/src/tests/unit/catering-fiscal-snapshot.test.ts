import { describe, expect, it } from '@jest/globals';
import type { Prisma } from '@prisma/client';
import {
    deserializeCateringCreditNoteSnapshot,
    deserializeCateringInvoiceSnapshot,
} from '../../services/catering-fiscal.service';

const invoiceSnapshot = {
    eventId: 41,
    invoiceNumber: 'FAC-2-000041',
    status: 'ISSUED',
    eventTitle: 'Boda',
    eventDate: '2026-07-20T18:00:00.000Z',
    customerName: 'Cliente Fiscal',
    companyName: 'La Mia Pitza',
    branchName: 'Principal',
    currencySymbol: 'C$',
    lines: [{ kind: 'MENU_ITEM', sourceId: 7, name: 'Paquete', quantity: 2, unitPrice: 57.5, subtotal: 115 }],
    subtotal: 100,
    tax: 15,
    taxRatePercent: 15,
    total: 115,
    payments: [{ paymentId: 90, methodType: 'CARD', amount: 115, reference: 'AUTH-90' }],
    issuedAt: '2026-07-16T12:00:00.000Z',
    issuedById: 5,
    issuedByName: 'Admin'
} as const;

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;

describe('Catering fiscal immutable snapshots', () => {
    it('restores a reconciled invoice without consulting mutable master data', () => {
        const invoice = deserializeCateringInvoiceSnapshot(asJson(invoiceSnapshot));
        expect(invoice.invoiceNumber).toBe('FAC-2-000041');
        expect(invoice.eventDate).toBeInstanceOf(Date);
        expect(invoice.total).toBe(115);
    });

    it('fails closed when line, tax, total or payments no longer reconcile', () => {
        expect(() => deserializeCateringInvoiceSnapshot(asJson({ ...invoiceSnapshot, tax: 14 }))).toThrow(/do not reconcile/);
        expect(() => deserializeCateringInvoiceSnapshot(asJson({ ...invoiceSnapshot, total: 114 }))).toThrow(/do not reconcile/);
        expect(() => deserializeCateringInvoiceSnapshot(asJson({
            ...invoiceSnapshot,
            payments: [{ ...invoiceSnapshot.payments[0], amount: 114 }]
        }))).toThrow(/do not reconcile/);
    });

    it('requires a full credit note refund equal to the original immutable invoice', () => {
        const credit = {
            eventId: 41,
            creditNoteNumber: 'NC-00000001',
            originalInvoiceNumber: 'FAC-2-000041',
            status: 'ISSUED',
            reason: 'Cancelacion total',
            jurisdiction: 'NI',
            inventoryDisposition: 'NOT_CONSUMED',
            refunds: [{ paymentId: 90, methodType: 'CARD', amount: 115, reference: 'REF-90' }],
            issuedAt: '2026-07-16T13:00:00.000Z',
            issuedById: 5,
            issuedByName: 'Admin',
            originalInvoice: invoiceSnapshot
        } as const;
        expect(deserializeCateringCreditNoteSnapshot(asJson(credit)).refunds).toHaveLength(1);
        expect(() => deserializeCateringCreditNoteSnapshot(asJson({
            ...credit,
            refunds: [{ ...credit.refunds[0], amount: 100 }]
        }))).toThrow(/refunds do not reconcile/);
    });
});
