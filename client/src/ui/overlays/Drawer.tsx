import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { IconButton } from '../primitives/IconButton';
import './overlays.css';

type FooterSlot = ReactNode | ((api: { requestClose(): void }) => ReactNode);

/** Panel lateral solo para filtros y vistas rápidas; los formularios usan FullScreenModal. */
export function Drawer({
  isOpen,
  onClose,
  title,
  width = 'md',
  footer,
  footerStart,
  children,
}: {
  isOpen: boolean;
  onClose(): void;
  title: string;
  width?: 'sm' | 'md' | 'lg';
  /** Acciones del pie, alineadas a la derecha (Cancelar, Aplicar/Guardar). Como función recibe requestClose. */
  footer?: FooterSlot;
  /** Acciones secundarias del pie, a la izquierda (p. ej. «Limpiar filtros»). */
  footerStart?: FooterSlot;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { titleId } = useDialogA11y(isOpen, onClose, ref);
  if (!isOpen) return null;
  const api = { requestClose: onClose };
  const slot = (s: FooterSlot) => (typeof s === 'function' ? s(api) : s);
  return createPortal(
    <div className="ui-overlay ui-overlay--drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} className={`ui-drawer ui-drawer--${width}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="ui-drawer__header">
          <h2 id={titleId} className="ui-drawer__title">{title}</h2>
          <IconButton icon={X} label="Cerrar" onClick={onClose} />
        </header>
        <div className="ui-drawer__body">{children}</div>
        {footer || footerStart ? (
          <footer className="ui-drawer__footer">
            {footerStart ? <div className="ui-drawer__footer-start">{slot(footerStart)}</div> : null}
            <div className="ui-drawer__footer-end">{slot(footer)}</div>
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
