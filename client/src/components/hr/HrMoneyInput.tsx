import type { InputHTMLAttributes } from 'react';
import { Input } from '@/ui';
import './HrControls.css';
import { formatHrDecimalInput, normalizeHrDecimalInput } from './hrMoneyInputFormat';

interface HrMoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'prefix'> {
  value: string | number;
  onValueChange: (value: string) => void;
}

/** Input de montos de @/ui: muestra separadores de miles, alinea a la derecha y emite el decimal canónico. */
export default function HrMoneyInput({ value, onValueChange, className = '', ...props }: HrMoneyInputProps) {
  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      className={`hr-money-input ui-input--number ${className}`.trim()}
      value={formatHrDecimalInput(value)}
      onChange={(event) => onValueChange(normalizeHrDecimalInput(event.target.value))}
    />
  );
}
