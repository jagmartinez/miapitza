import type { Prisma } from '@prisma/client';
import { describe, expect, it } from '@jest/globals';
import {
    CreditNoteService,
    deserializeCreditNoteSnapshot,
} from '../../services/credit-note.service';
import {
    deserializeInvoiceCancellationSnapshot,
    InvoiceCancellationService,
} from '../../services/invoice-cancellation.service';
import { validateConfiguredFiscalTaxId } from '../../services/setting.service';

const originalInvoice = {
    orderId: 41,
    customerName: 'Cliente fiscal',
    customerRuc: '00112233445566',
    customerTaxIdType: 'RUC',
    items: [{ name: 'Producto', quantity: 1, price: 100, subtotal: 100 }],
    grossSubtotal: 100,
    discount: 0,
    subtotal: 100,
    tax: 15,
    tipAmount: 0,
    tipRatePercent: 0,
    total: 115,
    branchName: 'Centro',
    companyName: 'Empresa',
    companyRuc: '12345678901234',
    date: '2026-07-14T15:00:00.000Z',
    invoiceNumber: 'FAC-1-000041',
    taxRatePercent: 15,
    currencySymbol: 'C$',
} as Prisma.JsonObject;

describe('Fiscal counterdocument contracts', () => {
    it('deserializes an immutable credit-note snapshot tied to its original invoice', () => {
        const snapshot = {
            orderId: 41,
            creditNoteNumber: 'NC-00000001',
            series: 'NC',
            sequenceNumber: 1,
            status: 'ISSUED',
            originalInvoiceNumber: 'FAC-1-000041',
            reason: 'Devolucion total de la venta',
            jurisdiction: 'NI',
            issuedAt: '2026-07-14T16:00:00.000Z',
            issuedById: 7,
            issuedByName: 'Administradora',
            inventoryDisposition: 'RETURNED_TO_ORIGINAL_STOCK',
            refunds: [{ paymentId: 9, methodType: 'CASH', amount: 115, reference: 'REV-PAY-9' }],
            originalInvoice,
        } as Prisma.JsonObject;

        const result = deserializeCreditNoteSnapshot(snapshot);

        expect(result.creditNoteNumber).toBe('NC-00000001');
        expect(result.originalInvoice.invoiceNumber).toBe('FAC-1-000041');
        expect(result.issuedAt.toISOString()).toBe('2026-07-14T16:00:00.000Z');
    });

    it('fails closed when a credit note is detached from its original invoice', () => {
        expect(() => deserializeCreditNoteSnapshot({
            orderId: 41,
            creditNoteNumber: 'NC-00000001',
            series: 'NC',
            sequenceNumber: 1,
            status: 'ISSUED',
            originalInvoiceNumber: 'FAC-OTHER',
            reason: 'Devolucion total de la venta',
            jurisdiction: 'NI',
            issuedAt: '2026-07-14T16:00:00.000Z',
            issuedById: 7,
            issuedByName: 'Administradora',
            inventoryDisposition: 'NOT_RETURNED',
            refunds: [],
            originalInvoice,
        } as Prisma.JsonObject)).toThrow('does not match');
    });

    it('deserializes a cancellation while preserving the original invoice number', () => {
        const result = deserializeInvoiceCancellationSnapshot({
            orderId: 41,
            originalInvoiceNumber: 'FAC-1-000041',
            reason: 'Error previo a la entrega',
            jurisdiction: 'NI',
            cancelledAt: '2026-07-14T16:00:00.000Z',
            cancelledById: 7,
            cancelledByName: 'Administradora',
            originalInvoice,
        } as Prisma.JsonObject);

        expect(result.originalInvoiceNumber).toBe(result.originalInvoice.invoiceNumber);
        expect(result.cancelledAt.toISOString()).toBe('2026-07-14T16:00:00.000Z');
    });

    it('fails closed when fiscal identity rules are missing or violated', () => {
        expect(() => validateConfiguredFiscalTaxId('1234', {}, 'RUC')).toThrow('Configure longitud');
        expect(() => validateConfiguredFiscalTaxId('12AB', {
            fiscal_tax_id_length: '4', fiscal_tax_id_charset: 'DIGITS',
        }, 'RUC')).toThrow('no cumple');
        expect(() => validateConfiguredFiscalTaxId('12-AB', {
            fiscal_tax_id_length: '5', fiscal_tax_id_charset: 'ALPHANUMERIC',
        }, 'RUC')).not.toThrow();
    });

    it('rejects malformed mutation inputs before opening a transaction', async () => {
        await expect(CreditNoteService.issue(41, 1, 7, {
            idempotencyKey: 'short', reason: 'Motivo valido', inventoryAction: 'NO_RETURN',
        })).rejects.toThrow('idempotencia');
        await expect(CreditNoteService.issue(41, 1, 7, {
            idempotencyKey: 'credit-41-001', reason: 'Motivo valido', inventoryAction: 'UNKNOWN',
        })).rejects.toThrow('mercader');
        await expect(InvoiceCancellationService.cancel(41, 1, 7, {
            idempotencyKey: 'cancel-41-001', reason: 'x',
        })).rejects.toThrow('motivo');
    });
});
