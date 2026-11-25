import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Normaliza CRLF (checkout en Windows) para que las aserciones multilínea no dependan del sistema.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('shared dialog foundation', () => {
  it('portals every top-level dialog surface outside transformed page containers', () => {
    for (const path of [
      './Modal.tsx',
      '../ui/overlays/FullScreenModal.tsx',
      '../ui/overlays/ConfirmDialog.tsx',
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
    // Select delega en AppSelect: el menú se monta en el diálogo que lo contiene.
    const source = read('../ui/forms/AppSelect.tsx');
    const modal = read('./Modal.tsx');
    const payment = read('./PaymentModal.tsx');
    expect(source).toContain("closest<HTMLElement>('[role=\"dialog\"]')");
    expect(source).toContain('setPortalTarget(dialog ?? document.body)');
    expect(modal).toContain('ref={containerRef}\n            className="modal-overlay"');
    expect(payment).toContain('ref={dialogRef}\n            className="payment-overlay"');
    expect(payment).not.toContain('ref={dialogRef}\n                className={`payment-dialog');
  });

  it('uses the same flat operational surfaces across shared and specialized dialogs', () => {
    const tokens = read('../index.css');
    const sharedModal = read('./Modal.css');
    const payment = read('./PaymentModal.css');
    const sidebar = read('./Sidebar.css');
    const tableOrders = read('./TableOrdersModal.css');

    expect(tokens).toContain('--dialog-panel-bg: var(--ui-surface)');
    expect(tokens).toContain('--dialog-content-bg: var(--ui-surface)');
    expect(tokens).toContain('--dialog-header-bg: var(--ui-surface)');
    expect(tokens).toContain('--dialog-accent: var(--ui-primary)');
    expect(sharedModal).toContain('var(--dialog-panel-bg');
    expect(payment).toContain('var(--dialog-panel-bg');
    for (const stylesheet of [sharedModal, payment, sidebar, tableOrders]) {
      expect(stylesheet).not.toContain('linear-gradient');
      expect(stylesheet).not.toContain('radial-gradient');
    }
  });

  it('routes POS dialogs through the shared accessible modal and react-select contracts', () => {
    const pos = read('../pages/POS.tsx');
    expect(pos).not.toContain('pos-shift-warning-overlay');
    expect(pos).not.toContain('pos-modifier-overlay');
    expect(pos).not.toContain('<select');
    expect(pos).toContain('<AppSelect');
    expect(pos.match(/<Modal/g)).toHaveLength(4);
    expect(pos).toContain("closest('[role=\"dialog\"], [role=\"alertdialog\"]')");
  });
});
