import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import './primitives.css';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: LucideIcon;
  label: string;
  size?: 'sm' | 'md';
};

export function IconButton({ icon: Icon, label, size = 'md', type = 'button', className = '', ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={`ui-icon-button ui-icon-button--${size} ${className}`.trim()}
    >
      <Icon size={size === 'sm' ? 14 : 18} aria-hidden="true" />
    </button>
  );
}
