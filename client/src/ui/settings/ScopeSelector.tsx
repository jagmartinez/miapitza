import { AppSelect } from '../forms/AppSelect';
import './settings.css';

export function ScopeSelector({ branches, value, onChange }: {
  branches: { id: number; name: string }[];
  value: number | null;
  onChange(id: number | null): void;
}) {
  const options = [
    { value: 0, label: 'Toda la empresa' },
    ...branches.map((b) => ({ value: b.id, label: b.name })),
  ];
  return (
    <div className="ui-scope-selector">
      <span className="ui-scope-selector__label">Alcance</span>
      <AppSelect
        aria-label="Alcance de la configuración"
        size="sm"
        options={options}
        value={value ?? 0}
        onChange={(v) => onChange(!v ? null : v)}
      />
    </div>
  );
}
