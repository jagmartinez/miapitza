import type { InputHTMLAttributes, ReactNode } from 'react';
import './forms.css';

export function Checkbox({
  label,
  className = '',
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label className={`ui-check ${className}`.trim()}>
      <input type="checkbox" className="ui-check__box" {...rest} />
      <span>{label}</span>
    </label>
  );
}
