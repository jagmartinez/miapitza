import { forwardRef, type InputHTMLAttributes } from 'react';
import { formatLocalDateInput } from '../../utils/dateInput';
import { Input } from './Input';

export type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'prefix'>;

/** Envoltorio de input[type=date]; el color-scheme del tema lo define base.css. */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { className = '', ...rest },
  ref,
) {
  return <Input ref={ref} type="date" className={`ui-input--date ${className}`.trim()} {...rest} />;
});

export { formatLocalDateInput };
