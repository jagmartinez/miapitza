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
        expect(source).toContain("filter((leg) => !succeeded.includes(leg.id))");
    });

    it('requires exact cent allocation and only renders change for cash legs', () => {
        expect(source).toContain('summarizePaymentAllocation(balance');
        expect(source).toContain('&& mixedAllocation.exact');
        expect(source).toContain('!previewAllocation.exact');
        expect(source).toContain("{cash && <div className=\"leg-change\"");
    });

    it('includes usable cash in mixed payment and simplifies item division around exact payer totals', () => {
        expect(source).toContain('canUsePaymentMethodInMixed(type, hasUsableCashShift)');
        expect(source).toContain("splitStrategy !== 'by-items' && <div className=\"payment-leg-list\"");
        expect(source).toContain('¿Quién paga cada plato?');
        expect(source).toContain('className="split-payer-totals"');
        expect(source).toContain('Totales exactos por comensal');
        expect(source).toContain("itemPreviewReady ? displayMoney(amount) : 'Pendiente'");
        expect(source).toContain('lastItemPreviewSignatureRef');
        expect(source).toContain('personName: normalizePayerName(leg.payerName)');
        expect(source).toContain('hasUniqueNormalizedPayerNames');
        expect(source).toContain('Cada comensal necesita un nombre único.');
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

    it('settles a ready table only on the last confirmed payment leg with an explicit warehouse', () => {
        expect(source).toContain("order?.tableId && order.status === 'READY'");
        expect(source).toContain("warehousesAPI.getAll({ branchId: order.branchId, type: 'BRANCH' })");
        expect(source).toContain('warehouseId: settlementWarehouseId');
        expect(source).toContain('index === pendingLegs.length - 1');
        expect(source).toContain('El último pago entregará la orden, registrará el consumo y liberará la mesa');
        expect(source).toContain('if (!validateSettlementPrecondition()) return');
        expect(source).toContain('busy || settlementUnavailable || queuedPayment');
        expect(source).toContain('Boolean(methodsError)');
    });
});
