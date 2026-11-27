import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Spinner } from './Spinner';
import './primitives.css';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  type = 'button',
  className = '',
  disabled,
  children,
  ...rest
}, ref) {
  const cls = `ui-button ui-button--${variant} ui-button--${size} ${className}`.trim();
  return (
    <button {...rest} ref={ref} type={type} className={cls} disabled={disabled || loading} aria-busy={loading ? 'true' : undefined}>
      {loading ? <span aria-hidden="true" className="ui-button__spinner"><Spinner size={14} label="Procesando" /></span> : Icon ? <Icon size={16} aria-hidden="true" /> : null}
      {children}
    </button>
  );
});
