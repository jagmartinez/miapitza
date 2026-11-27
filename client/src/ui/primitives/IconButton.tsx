import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip';
import './primitives.css';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: LucideIcon;
  /** Nombre accesible y texto del tooltip. */
  label: string;
  /** Texto corto del tooltip si `label` es largo (p. ej. «Editar» en vez de «Editar Pizza margarita»). */
  tooltip?: string;
  size?: 'sm' | 'md';
  /** `danger` para acciones destructivas (eliminar, anular): rojo al pasar el cursor. */
  tone?: 'default' | 'primary' | 'danger';
};

/** Botón de solo icono: tamaño fijo (32/40 px), icono 16/18 px con trazo uniforme y tooltip propio. */
export function IconButton({ icon: Icon, label, tooltip, size = 'md', tone = 'default', type = 'button', className = '', ...rest }: IconButtonProps) {
  return (
    <Tooltip label={tooltip ?? label}>
      <button
        {...rest}
        type={type}
        aria-label={label}
        className={`ui-icon-button ui-icon-button--${size} ui-icon-button--${tone} ${className}`.trim()}
      >
        <Icon size={size === 'sm' ? 16 : 18} strokeWidth={2} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
