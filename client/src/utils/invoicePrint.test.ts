import { describe, expect, it } from 'vitest';
import { renderInvoiceHtml } from './invoicePrint';

const snapshot = {
    orderId: 17,
    customerName: '<Cliente>',
    customerRuc: 'J001',
    items: [{ orderItemId: 91, name: 'Pizza <script>', quantity: 1, price: 100, subtotal: 100 }],
    grossSubtotal: 100,
    discount: 0,
    subtotal: 100,
    tax: 15,
    tipAmount: 0,
    tipRatePercent: 0,
    total: 115,
    branchName: 'Centro',
    companyName: 'Empresa',
    companyRuc: 'RUC-1',
    date: '2026-07-29T12:00:00.000Z',
    invoiceNumber: 'FAC-2-000017',
    taxRatePercent: 15,
    currencySymbol: 'C$',
};

describe('fiscal invoice print document', () => {
    it('renders the persisted snapshot and escapes fiscal/customer text', () => {
        const html = renderInvoiceHtml(snapshot);

        expect(html).toContain('FACTURA FAC-2-000017');
        expect(html).toContain('C$ 115.00');
        expect(html).toContain('Pizza &lt;script&gt;');
        expect(html).not.toContain('Pizza <script>');
        expect(html).toContain('&lt;Cliente&gt;');
    });

    it('fails closed when issuance did not return an integral printable snapshot', () => {
        expect(() => renderInvoiceHtml({ ...snapshot, invoiceNumber: '' }))
            .toThrow(/documento imprimible íntegro/i);
        expect(() => renderInvoiceHtml({ ...snapshot, items: [] }))
            .toThrow(/documento imprimible íntegro/i);
        expect(() => renderInvoiceHtml({ ...snapshot, total: Number.NaN }))
            .toThrow(/documento imprimible íntegro/i);
        expect(() => renderInvoiceHtml({
            ...snapshot,
            items: [{ ...snapshot.items[0], quantity: 0 }],
        })).toThrow(/documento imprimible íntegro/i);
    });
});
