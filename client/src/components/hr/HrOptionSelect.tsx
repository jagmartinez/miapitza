import { useId, type ReactNode } from 'react';
import { AppSelect, Field } from '@/ui';
import './HrControls.css';

export type HrOption = { value: string; label: string };
/** Misma forma que el SingleValue de react-select, sin depender de él. */
export type SingleValue<T> = T | null;

interface HrOptionSelectProps<T extends HrOption> {
  label?: ReactNode;
  inputId?: string;
  options: T[];
  value?: T | null;
  onChange(option: SingleValue<T>): void;
  placeholder?: string;
  isClearable?: boolean;
  isDisabled?: boolean;
  /** Se acepta por compatibilidad: AppSelect siempre permite buscar. */
  isSearchable?: boolean;
  /** Se acepta por compatibilidad: el estilo lo da el design system. */
  variant?: 'standard' | 'modal';
}

/** Select por objeto-opción sobre AppSelect; con `label` incluye su Field. */
export default function HrOptionSelect<T extends HrOption = HrOption>({
  label,
  inputId,
  options,
  value,
  onChange,
  placeholder,
  isClearable = false,
  isDisabled,
}: HrOptionSelectProps<T>) {
  const generated = useId();
  const id = inputId ?? generated;
  const select = (
    <AppSelect<string>
      inputId={id}
      options={options}
      value={value && options.some((option) => option.value === value.value) ? value.value : null}
      onChange={(next) => onChange(options.find((option) => option.value === next) ?? null)}
      placeholder={placeholder}
      isClearable={isClearable}
      isDisabled={isDisabled}
    />
  );
  if (label === undefined || label === null) return select;
  return (
    <Field label={String(label)} htmlFor={id}>
      {select}
    </Field>
  );
}
