import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { IconButton } from '../primitives/IconButton';
import './overlays.css';

/** Panel lateral solo para filtros y vistas rápidas; los formularios usan FullScreenModal. */
export function Drawer({
  isOpen,
  onClose,
  title,
  width = 'md',
  footer,
  children,
}: {
  isOpen: boolean;
  onClose(): void;
  title: string;
  width?: 'sm' | 'md';
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { titleId } = useDialogA11y(isOpen, onClose, ref);
  if (!isOpen) return null;
  return createPortal(
    <div className="ui-overlay ui-overlay--drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} className={`ui-drawer ui-drawer--${width}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="ui-drawer__header">
          <h2 id={titleId} className="ui-drawer__title">{title}</h2>
          <IconButton icon={X} label="Cerrar" onClick={onClose} />
        </header>
        <div className="ui-drawer__body">{children}</div>
        {footer ? <footer className="ui-drawer__footer">{footer}</footer> : null}
      </aside>
    </div>,
    document.body,
  );
}
