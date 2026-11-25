import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('fiscal counterflow UI contracts', () => {
    it('keeps mutations explicit and document reads pure', () => {
        const api = read('../services/api.ts');

        expect(api).toContain('api.post(`/invoices/${orderId}/cancel`, data)');
        expect(api).toContain('api.post(`/invoices/${orderId}/credit-note`, data)');
        expect(api).toContain('api.get(`/invoices/${orderId}/cancellation`)');
        expect(api).toContain('api.get(`/invoices/${orderId}/credit-note`)');
        expect(api).toContain("api.get('/invoices/credit-notes', { params })");
        expect(api).toContain("api.get('/invoices/cancellations', { params })");
    });

    it('captures fiscal customer data before immutable invoice issuance', () => {
        const pos = read('./POS.tsx');
        const updateIndex = pos.indexOf('await ordersAPI.updateFiscalCustomer(orderId');
        const issueIndex = pos.indexOf('await invoicesAPI.issue(orderId)', updateIndex);

        expect(updateIndex).toBeGreaterThan(-1);
        expect(issueIndex).toBeGreaterThan(updateIndex);
        expect(pos).toContain('customerTaxIdType');
        expect(pos).toContain('customerFiscalAddress');
        expect(pos).toContain('customerEmail');
        expect(pos).toContain('customerPhone');
    });

    it('requires an explicit physical-return decision and external refund evidence', () => {
        const history = read('./InvoiceHistory.tsx');

        expect(history).toContain("useState<'NO_RETURN' | 'RETURN_TO_STOCK'>('NO_RETURN')");
        expect(history).toContain('externalRefundReferences[payment.id].trim()');
        expect(history).toContain("fiscalAction === 'CANCEL'");
        expect(history).toContain("fiscalAction === 'CREDIT_NOTE'");
        expect(history).toContain('canCancelInvoice(user)');
        expect(history).toContain('canIssueCreditNote(user)');
        expect(history).toContain("fiscalInvoice.orderStatus !== 'OPEN' && !fiscalWasteWarehouseId");
    });

    it('exposes fail-closed fiscal configuration instead of jurisdiction constants', () => {
        const settings = read('./Settings.tsx');
        const authz = read('../utils/authz.ts');

        expect(settings).toContain('fiscal_jurisdiction');
        expect(settings).toContain('credit_note_series');
        expect(settings).toContain('fiscal_tax_id_length');
        expect(settings).toContain('fiscal_tax_id_charset');
        expect(authz).toContain("'invoices.cancel'");
        expect(authz).toContain("'invoices.credit'");
    });

    it('surfaces the fiscal state and blocks the ordinary cancel path for invoiced orders', () => {
        const orders = read('./Orders.tsx');

        expect(orders).toContain("selectedOrder.invoiceFiscalStatus === 'CREDITED'");
        expect(orders).toContain("selectedOrder.invoiceFiscalStatus === 'CANCELLED'");
        expect(orders).toContain('downloadCreditNotePdf(order.id)');
        expect(orders).toContain('downloadCancellationPdf(order.id)');
        expect(orders).toContain('!order.invoiceNumber && canCancel');
    });
});
