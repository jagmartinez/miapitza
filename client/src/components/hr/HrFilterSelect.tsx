import { useId } from 'react';
import { AppSelect, Field, type Opt } from '@/ui';
import './HrControls.css';

interface HrFilterSelectProps {
  label: string;
  options: Opt<string>[];
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}

/** Filtro con etiqueta sobre AppSelect: cadena vacía = "sin filtro". Conserva un ancho mínimo legible. */
export default function HrFilterSelect({ label, options, value, onChange, disabled }: HrFilterSelectProps) {
  const id = useId();
  return (
    <div className="hr-filter-select">
      <Field label={label} htmlFor={id}>
        <AppSelect<string>
          inputId={id}
          options={options}
          value={options.some((option) => option.value === value) ? value : null}
          onChange={(next) => onChange(next ?? '')}
          isDisabled={disabled}
          isClearable={false}
        />
      </Field>
    </div>
  );
}
