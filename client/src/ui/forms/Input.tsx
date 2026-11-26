import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import './forms.css';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & {
  prefix?: ReactNode;
  suffix?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { prefix, suffix, className = '', ...rest },
  ref,
) {
  return (
    <span className={`ui-input ${rest['aria-invalid'] ? 'ui-input--invalid' : ''} ${className}`.trim()}>
      {prefix != null && <span className="ui-input__affix">{prefix}</span>}
      <input ref={ref} className="ui-input__control" {...rest} />
      {suffix != null && <span className="ui-input__affix">{suffix}</span>}
    </span>
  );
});
