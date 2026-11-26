import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { IconButton } from '../primitives/IconButton';
import { ConfirmDialog } from './ConfirmDialog';
import './overlays.css';

export interface ModalTab {
  id: string;
  label: string;
  badge?: string | number;
  disabled?: boolean;
}
export interface FullScreenModalProps {
  isOpen: boolean;
  onClose(): void;
  title: string;
  subtitle?: ReactNode;
  breadcrumb?: string[];
  status?: ReactNode;
  tabs?: ModalTab[];
  activeTab?: string;
  onTabChange?(id: string): void;
  aside?: ReactNode;
  /** Si es función recibe requestClose: un 'Cancelar' del pie debe usarlo para respetar `dirty`. */
  footer?: ReactNode | ((api: { requestClose(): void }) => ReactNode);
  footerStart?: ReactNode | ((api: { requestClose(): void }) => ReactNode);
  dirty?: boolean;
  dirtyMessage?: string;
  headerActions?: ReactNode;
  /** 'compact' muestra un diálogo centrado para avisos y confirmaciones cortas. */
  size?: 'full' | 'compact';
  children: ReactNode;
}

export function FullScreenModal({
  isOpen,
  onClose,
  title,
  subtitle,
  breadcrumb,
  status,
  tabs,
  activeTab,
  onTabChange,
  aside,
  footer,
  footerStart,
  dirty,
  dirtyMessage = 'Hay cambios sin guardar. Si cierras ahora se perderán.',
  headerActions,
  children,
  size = 'full',
}: FullScreenModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);

  const requestClose = () => {
    if (dirty) setConfirming(true);
    else onClose();
  };
  // Con la confirmación abierta, Esc le pertenece a ella.
  const { titleId } = useDialogA11y(isOpen, requestClose, ref, { closeOnEscape: !confirming });

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!tabs || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    const enabled = tabs.filter((t) => !t.disabled);
    const idx = enabled.findIndex((t) => t.id === activeTab);
    if (enabled.length === 0) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = enabled[(idx + step + enabled.length) % enabled.length];
    onTabChange?.(next.id);
    requestAnimationFrame(() => document.getElementById(`${titleId}-tab-${next.id}`)?.focus());
  };

  if (!isOpen) return null;
  return createPortal(
    <>
      <div ref={ref} className={`ui-fsm${size === 'compact' ? ' ui-fsm--compact' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="ui-fsm__header">
          <div className="ui-fsm__heading">
            {breadcrumb?.length ? <p className="ui-fsm__breadcrumb">{breadcrumb.join(' / ')}</p> : null}
            <div className="ui-fsm__titlerow">
              <h2 id={titleId} className="ui-fsm__title">{title}</h2>
              {status}
            </div>
            {subtitle ? <p className="ui-fsm__subtitle">{subtitle}</p> : null}
          </div>
          <div className="ui-fsm__actions">
            {headerActions}
            <IconButton icon={X} label="Cerrar" onClick={requestClose} />
          </div>
        </header>
        {tabs?.length ? (
          <div className="ui-fsm__tabs" role="tablist" aria-label={title} onKeyDown={onTabKey}>
            {tabs.map((t) => (
              <button
                key={t.id}
                id={`${titleId}-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={t.id === activeTab}
                tabIndex={t.id === activeTab ? 0 : -1}
                disabled={t.disabled}
                className={`ui-fsm__tab ${t.id === activeTab ? 'is-active' : ''}`}
                onClick={() => onTabChange?.(t.id)}
              >
                {t.label}
                {t.badge !== undefined ? <span className="ui-fsm__tabbadge">{t.badge}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        <div className={`ui-fsm__body ${aside ? 'has-aside' : ''}`}>
          <div className="ui-fsm__main">{children}</div>
          {aside ? <aside className="ui-fsm__aside">{aside}</aside> : null}
        </div>
        {footer || footerStart ? (
          <footer className="ui-fsm__footer">
            <div className="ui-fsm__footer-start">{typeof footerStart === 'function' ? footerStart({ requestClose }) : footerStart}</div>
            <div className="ui-fsm__footer-end">{typeof footer === 'function' ? footer({ requestClose }) : footer}</div>
          </footer>
        ) : null}
      </div>
      <ConfirmDialog
        isOpen={confirming}
        title="¿Descartar cambios?"
        message={dirtyMessage}
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        tone="danger"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onClose();
        }}
      />
    </>,
    document.body,
  );
}
