import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./InvoiceHistory.tsx', import.meta.url)), 'utf8');

describe('partial fiscal credit-note UI contract', () => {
    it('offers full remaining balance or explicit integer quantities per invoice line', () => {
        expect(source).toContain("setCreditMode(event.target.value as 'FULL' | 'PARTIAL')");
        expect(source).toContain('Cantidades parciales por línea');
        expect(source).toContain('orderItemId: item.id');
        expect(source).toContain("...(creditMode === 'PARTIAL' ? { lines: partialLines } : {})");
    });

    it('keeps partially credited invoices eligible for the next counterdocument', () => {
        expect(source).toContain("['ISSUED', 'PARTIALLY_CREDITED'].includes(invoice.fiscalStatus)");
        expect(source).toContain("['PAID', 'PARTIAL'].includes(invoice.status)");
        expect(source).toContain('Acreditada parcialmente');
    });
});
