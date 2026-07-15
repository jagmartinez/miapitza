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

    it('formats initial money fields and keeps split controls in the panel header', () => {
        expect(source).toContain('formatMoneyInput(amount.toFixed(2))');
        expect(source).toContain('payment-heading-tools');
        expect(source).toContain('Agregar método');
        expect(source).toContain('Recalcular importes');
        expect(source).toContain('compact />');
    });

    it('keeps a stable workspace across modes and omits redundant footer labels', () => {
        const styles = readFileSync(new URL('./PaymentModal.css', import.meta.url), 'utf8');
        expect(source).toContain('payment-workspace');
        expect(source).toContain('payment-context');
        expect(source).toContain('modeHelp');
        expect(styles).toContain('width: min(1180px, 100%)');
        expect(styles).toContain('grid-template-columns: 310px minmax(0, 1fr)');
        expect(styles).toContain('.payment-dialog .select-group.modal .react-select__control');
        expect(styles).toContain('min-height: 46px');
        expect(source).toContain('scrollAreaRef.current?.scrollTo({ top: 0 })');
        expect(source).not.toContain('payment-footer-mode');
    });
});
