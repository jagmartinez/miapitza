import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { Button } from '../primitives/Button';
import './overlays.css';

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'primary',
  loading,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { titleId, descriptionId } = useDialogA11y(isOpen, onCancel, ref);

  // El foco inicial queda en "cancelar" (primer botón) si es peligroso; si no, en confirmar.
  useEffect(() => {
    if (!isOpen) return;
    ref.current?.querySelector<HTMLElement>(tone === 'danger' ? '[data-cancel]' : '[data-confirm]')?.focus();
  }, [isOpen, tone]);

  if (!isOpen) return null;
  return createPortal(
    <div className="ui-overlay ui-overlay--confirm" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={ref}
        className="ui-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <h2 id={titleId} className="ui-confirm__title">{title}</h2>
        <div id={descriptionId} className="ui-confirm__message">{message}</div>
        <div className="ui-confirm__actions">
          <Button data-cancel variant="secondary" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
          <Button data-confirm variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
