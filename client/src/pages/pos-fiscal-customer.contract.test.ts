import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('POS fiscal customer contract', () => {
  const pos = read('./POS.tsx');
  const posStyles = read('./POS.css');
  const tableStyles = read('./Tables.css');
  const modal = read('../components/Modal.tsx');

  it('keeps the fiscal dialog above the embedded table workspace', () => {
    expect(tableStyles).toMatch(/\.table-pos-workspace\s*\{[\s\S]*?z-index:\s*1400/);
    expect(pos).toContain('overlayClassName="pos-fiscal-modal-overlay"');
    expect(posStyles).toMatch(
      /\.modal-overlay\.pos-fiscal-modal-overlay\s*\{[\s\S]*?z-index:\s*1600/,
    );
    expect(modal).toContain('overlayClassName?: string');
    expect(modal).toContain('${overlayClassName}`.trim()');
  });

  it('opens a semantic dialog with an isolated draft and explicit save/cancel actions', () => {
    expect(pos).toContain('type="button"\n                        className="header-action-btn secondary"');
    expect(pos).toContain('onClick={openFiscalCustomerModal}');
    expect(pos).toContain('aria-haspopup="dialog"');
    expect(pos).toContain('setFiscalCustomerDraft({\n            customerName,\n            ...fiscalCustomer,');
    expect(pos).toContain('onClick={closeFiscalCustomerModal}');
    expect(pos).toContain('Cancelar');
    expect(pos).toContain("'Guardar'");
    expect(pos).toContain('placeholder="Consumidor final"');
    expect(pos).toContain('role="alert"');
  });

  it('persists an existing order without issuing an invoice from the editor', () => {
    const saveStart = pos.indexOf('const saveFiscalCustomer = async () =>');
    const paymentStart = pos.indexOf('const handlePayment = async () =>');
    const saveFlow = pos.slice(saveStart, paymentStart);

    expect(saveStart).toBeGreaterThan(-1);
    expect(paymentStart).toBeGreaterThan(saveStart);
    expect(saveFlow).toContain('ordersAPI.updateFiscalCustomer(currentOrderId');
    expect(saveFlow).not.toContain('invoicesAPI.issue');
    expect(saveFlow).not.toContain('persistCartToOrder');
    expect(saveFlow).toContain('setFiscalCustomerError(message)');
  });

  it('still freezes the fiscal snapshot before invoice issuance at checkout', () => {
    const paymentStart = pos.indexOf('const handlePayment = async () =>');
    const paymentEnd = pos.indexOf('handlePaymentRef.current = handlePayment');
    const paymentFlow = pos.slice(paymentStart, paymentEnd);

    const fiscalUpdate = paymentFlow.indexOf('ordersAPI.updateFiscalCustomer(orderId');
    const invoiceIssue = paymentFlow.indexOf('invoicesAPI.issue(orderId)');
    expect(fiscalUpdate).toBeGreaterThan(-1);
    expect(invoiceIssue).toBeGreaterThan(fiscalUpdate);
  });
});
