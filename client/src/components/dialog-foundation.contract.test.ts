import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Normaliza CRLF (checkout en Windows) para que las aserciones multilínea no dependan del sistema.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('shared dialog foundation', () => {
  it('portals every top-level dialog surface outside transformed page containers', () => {
    for (const path of [
      '../ui/overlays/FullScreenModal.tsx',
      '../ui/overlays/ConfirmDialog.tsx',
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
    // AppSelect: el menú se monta en el diálogo que lo contiene.
    const source = read('../ui/forms/AppSelect.tsx');
    const payment = read('./PaymentModal.tsx');
    expect(source).toContain("closest<HTMLElement>('[role=\"dialog\"]')");
    expect(source).toContain('setPortalTarget(dialog ?? document.body)');
    // El cobro se monta en FullScreenModal: sin portal ni diálogo propio.
    expect(payment).toContain('<FullScreenModal');
    expect(payment).not.toContain('createPortal');
  });

  it('associates select validation errors with the accessible combobox', () => {
    // components/Select se reemplazó por AppSelect + Field de @/ui: Field publica el error con role="alert"
    // y lo enlaza por aria-describedby; AppSelect lo marca inválido y lo asocia con aria-errormessage.
    const source = read('../ui/forms/AppSelect.tsx');
    const field = read('../ui/forms/Field.tsx');
    expect(source).toContain("const errorId = invalid ? props['aria-describedby']?.split(' ')[0] : undefined");
    expect(source).toContain("'aria-invalid': invalid || undefined");
    expect(source).toContain("'aria-errormessage': errorId");
    expect(field).toContain('<p className="ui-field__error" id={errorId} role="alert">');
  });

  it('uses the same flat operational surfaces across shared and specialized dialogs', () => {
    const tokens = read('../index.css');
    const payment = read('./PaymentModal.css');

    expect(tokens).toContain('--dialog-panel-bg: var(--ui-surface)');
    expect(tokens).toContain('--dialog-content-bg: var(--ui-surface)');
    expect(tokens).toContain('--dialog-header-bg: var(--ui-surface)');
    expect(tokens).toContain('--dialog-accent: var(--ui-primary)');
    expect(payment).not.toContain('var(--dialog-');
    for (const stylesheet of [payment]) {
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
    expect(pos.match(/<FullScreenModal/g)).toHaveLength(4);
    expect(pos).toContain("closest('[role=\"dialog\"], [role=\"alertdialog\"]')");
  });
});
