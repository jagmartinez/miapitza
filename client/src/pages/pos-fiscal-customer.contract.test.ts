import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('POS fiscal customer contract', () => {
  const pos = read('./POS.tsx');
  const tableStyles = read('./Tables.css');

  it('keeps the fiscal dialog above the embedded table workspace', () => {
    expect(tableStyles).toMatch(/\.table-pos-workspace\s*\{[\s\S]*?z-index:\s*1400/);
    // Design-system dialogs raise their layer above the embedded workspace while it is open.
    expect(tableStyles).toMatch(/body:has\(\.table-pos-workspace\)\s*\{[\s\S]*?--ui-z-modal:\s*1600/);
    expect(pos).toContain('<FullScreenModal');
    expect(pos).toContain('onClose={closeFiscalCustomerModal}');
  });

  it('opens a semantic dialog with an isolated draft and explicit save/cancel actions', () => {
    // Tolerante a la indentación y a CRLF: el botón vive ahora en la cabecera del ticket.
    expect(pos).toMatch(/type="button"\s+className="header-action-btn secondary"\s+onClick=\{openFiscalCustomerModal\}/);
    expect(pos).toContain('onClick={openFiscalCustomerModal}');
    expect(pos).toContain('aria-haspopup="dialog"');
    expect(pos).toMatch(/setFiscalCustomerDraft\(\{\s+customerName,\s+\.\.\.fiscalCustomer,/);
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

  it('freezes the fiscal snapshot before prefactura issuance at checkout', () => {
    const paymentStart = pos.indexOf('const handlePayment = async () =>');
    const paymentEnd = pos.indexOf('handlePaymentRef.current = handlePayment');
    const paymentFlow = pos.slice(paymentStart, paymentEnd);

    const fiscalUpdate = paymentFlow.indexOf('ordersAPI.updateFiscalCustomer(orderId');
    const invoiceIssue = paymentFlow.indexOf('invoicesAPI.issuePreInvoice(orderId)');
    expect(fiscalUpdate).toBeGreaterThan(-1);
    expect(invoiceIssue).toBeGreaterThan(fiscalUpdate);
  });
});
