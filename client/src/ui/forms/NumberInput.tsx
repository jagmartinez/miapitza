import { useState } from 'react';
import { formatNumber, parseNumber } from '../format/number';
import { Input } from './Input';

type Props = {
  value: number | null;
  onChange: (v: number | null) => void;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

export function NumberInput({ value, onChange, decimals = 2, prefix, suffix, min, id, disabled, ...aria }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft !== null ? draft : value === null ? '' : formatNumber(value, decimals);

  return (
    <Input
      {...aria}
      id={id}
      disabled={disabled}
      inputMode="decimal"
      className="ui-input--number"
      prefix={prefix}
      suffix={suffix}
      value={display}
      onFocus={() => setDraft(value === null ? '' : String(value))}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = parseNumber(text);
        onChange(n);
      }}
      onBlur={() => {
        setDraft(null);
        if (min !== undefined && value !== null && value < min) onChange(min);
      }}
    />
  );
}
