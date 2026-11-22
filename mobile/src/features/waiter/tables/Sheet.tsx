import type { ReactNode } from 'react';
import { IconX } from '../../../ui/Icon';

/** Bottom sheet over the plan: drag handle, title + grey subtitle, optional right-hand block, close icon; tap outside to close. */
export function Sheet({
  label,
  title,
  subtitle,
  aside,
  onClose,
  children,
}: {
  label: string;
  title?: string;
  subtitle?: string;
  aside?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        {title && (
          <div className="sheet-head">
            <div className="sheet-head-text">
              <h2 className="sheet-title">{title}</h2>
              {subtitle && <p className="sheet-sub muted">{subtitle}</p>}
            </div>
            {aside}
            <button type="button" className="sheet-close" aria-label="Cerrar" onClick={onClose}>
              <IconX size={18} stroke={1.5} aria-hidden />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
