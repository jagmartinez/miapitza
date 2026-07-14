import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./PaymentModal.tsx', import.meta.url), 'utf8');

describe('PaymentModal contract', () => {
    it('offers single, mixed and diner-split payment flows with themed selects', () => {
        expect(source).toContain("type PaymentMode = 'single' | 'mixed' | 'split'");
        expect(source).toContain('Pago único');
        expect(source).toContain('Pago mixto');
        expect(source).toContain('Dividir cuenta');
        expect(source).toContain('<CustomSelect<MethodOption>');
        expect(source).not.toContain('<select');
    });

    it('keeps each mixed or split leg idempotent and retries only pending legs', () => {
        expect(source).toContain('mixedKeysRef.current[leg.id] ||= newIdempotencyKey()');
        expect(source).toContain('splitKeysRef.current[leg.id] ||= newIdempotencyKey()');
        expect(source).toContain('if (succeeded.includes(leg.id)) continue');
    });

    it('requires exact cent allocation and only renders change for cash legs', () => {
        expect(source).toContain('summarizePaymentAllocation(balance');
        expect(source).toContain('&& mixedAllocation.exact');
        expect(source).toContain("{cash && <div className=\"leg-change\"");
    });
});
