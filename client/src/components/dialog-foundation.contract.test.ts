import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('shared dialog foundation', () => {
  it('portals every top-level dialog surface outside transformed page containers', () => {
    for (const path of [
      './Modal.tsx',
      './Sidebar.tsx',
      './ConfirmDialog.tsx',
      './PaymentModal.tsx',
      './NumericKeypad.tsx',
      './TableOrdersModal.tsx',
    ]) {
      const source = read(path);
      expect(source, path).toContain('createPortal');
      expect(source, path).toContain('document.body');
    }
  });

  it('keeps body scroll locked until the last stacked dialog closes', () => {
    const source = read('../hooks/useDialogA11y.ts');
    expect(source).toContain('let bodyScrollLockCount = 0');
    expect(source).toContain('bodyScrollLockCount += 1');
    expect(source).toContain('bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1)');
    expect(source).toContain('document.body.style.overflow = bodyOverflowBeforeLock');
    expect(source).not.toContain("document.body.style.overflow = 'unset'");
    expect(source).toContain('const dialogStack: symbol[] = []');
    expect(source).toContain('if (!isTopmostDialog(dialogIdRef.current)) return');
    expect(source).toContain('event.stopPropagation()');
  });

  it('keeps modal react-select menus inside the active dialog and clear of its footer', () => {
    const source = read('./Select.tsx');
    const modal = read('./Modal.tsx');
    const payment = read('./PaymentModal.tsx');
    expect(source).toContain("closest<HTMLElement>('[role=\"dialog\"]')");
    expect(source).toContain("closest('[role=\"dialog\"]')");
    expect(source).toContain('.sidebar-actions, .modal-actions, .payment-dialog-footer, .modal-footer');
    expect(modal).toContain('ref={containerRef}\n            className={`modal-overlay');
    expect(payment).toContain('ref={dialogRef}\n            className="payment-overlay"');
    expect(payment).not.toContain('ref={dialogRef}\n                className={`payment-dialog');
  });

  it('uses the same dark panel and blue accent tokens across shared and specialized dialogs', () => {
    const tokens = read('../index.css');
    const sharedModal = read('./Modal.css');
    const payment = read('./PaymentModal.css');

    expect(tokens).toContain('--dialog-panel-bg: #111c30');
    expect(tokens).toContain('--dialog-content-bg: #0d1728');
    expect(tokens).toContain('--dialog-accent: #3b82f6');
    expect(sharedModal).toContain('var(--dialog-panel-bg');
    expect(payment).toContain('var(--dialog-panel-bg');
  });

  it('routes POS dialogs through the shared accessible modal and react-select contracts', () => {
    const pos = read('../pages/POS.tsx');
    expect(pos).not.toContain('pos-shift-warning-overlay');
    expect(pos).not.toContain('pos-modifier-overlay');
    expect(pos).not.toContain('<select');
    expect(pos).toContain('<Select<WarehouseOption>');
    expect(pos.match(/<Modal/g)).toHaveLength(4);
    expect(pos).toContain("closest('[role=\"dialog\"], [role=\"alertdialog\"]')");
  });
});
