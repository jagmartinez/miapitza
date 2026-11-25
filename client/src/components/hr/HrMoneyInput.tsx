import type { InputHTMLAttributes } from 'react';
import './HrControls.css';
import { formatHrDecimalInput, normalizeHrDecimalInput } from './hrMoneyInputFormat';

interface HrMoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: string | number;
  onValueChange: (value: string) => void;
}

export default function HrMoneyInput({ value, onValueChange, className = '', ...props }: HrMoneyInputProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      className={`hr-money-input ${className}`.trim()}
      value={formatHrDecimalInput(value)}
      onChange={(event) => onValueChange(normalizeHrDecimalInput(event.target.value))}
    />
  );
}
