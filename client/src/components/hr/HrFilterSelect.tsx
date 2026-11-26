import { AppSelect, type Opt } from '@/ui';

interface HrFilterSelectProps {
  label: string;
  options: Opt<string>[];
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
}

/**
 * Filtro sin caja para TableToolbar (como Menú): el nombre del filtro es la etiqueta accesible y la
 * primera opción ("Todos…") hace de texto visible. Cadena vacía = "sin filtro".
 */
export default function HrFilterSelect({ label, options, value, onChange, disabled }: HrFilterSelectProps) {
  return (
    <AppSelect<string>
      aria-label={label}
      options={options}
      value={options.some((option) => option.value === value) ? value : null}
      placeholder={label}
      onChange={(next) => onChange(next ?? '')}
      isDisabled={disabled}
      isClearable={false}
    />
  );
}
