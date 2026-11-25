import { useId } from 'react';
import { Input } from '../forms/Input';
import { NumberInput } from '../forms/NumberInput';
import { Switch } from '../forms/Switch';
import { SegmentedControl } from '../forms/SegmentedControl';
import { AppSelect } from '../forms/AppSelect';
import type { SettingDef } from '../../services/settingsScope';
import './settings.css';

export type SettingsScope = 'company' | { branchName: string };

export interface SettingsRowProps {
  def: SettingDef;
  value: string;
  source: 'company' | 'branch' | 'default';
  companyValue: string;
  scope: SettingsScope;
  error?: string;
  dirty: boolean;
  onChange(v: string): void;
  onReset(): void;
}

function readOnlyText(def: SettingDef, value: string): string {
  if (def.type === 'boolean') return value === 'true' ? 'Sí' : 'No';
  if (def.type === 'enum') return def.options?.find((o) => o.value === value)?.label ?? value;
  return `${def.prefix ? `${def.prefix} ` : ''}${value}${def.suffix ? ` ${def.suffix}` : ''}`.trim() || '—';
}

export function SettingsRow({ def, value, source, scope, error, dirty, onChange, onReset }: SettingsRowProps) {
  const uid = useId();
  const inputId = `${uid}-control`;
  const hintId = `${uid}-hint`;
  const inBranch = scope !== 'company';
  const readOnly = Boolean(def.readOnly) || (inBranch && !def.branchable);

  let control;
  if (readOnly) {
    control = <span className="ui-settings-row__static">{readOnlyText(def, value)}</span>;
  } else if (def.type === 'number' || def.type === 'integer') {
    const n = value.trim() === '' || Number.isNaN(Number(value)) ? null : Number(value);
    control = (
      <NumberInput
        id={inputId}
        aria-label={def.label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? hintId : undefined}
        value={n}
        decimals={def.type === 'integer' ? 0 : 2}
        prefix={def.prefix}
        suffix={def.suffix}
        min={def.min}
        onChange={(v) => onChange(v === null ? '' : String(v))}
      />
    );
  } else if (def.type === 'boolean') {
    control = <Switch id={inputId} label={def.label} checked={value === 'true'} onChange={(c) => onChange(c ? 'true' : 'false')} />;
  } else if (def.type === 'enum' && def.options) {
    control = def.options.length <= 4 ? (
      <SegmentedControl ariaLabel={def.label} options={def.options} value={value} onChange={onChange} />
    ) : (
      <AppSelect
        inputId={inputId}
        aria-label={def.label}
        options={def.options}
        value={value}
        onChange={(v) => onChange(v ?? '')}
      />
    );
  } else {
    control = (
      <Input
        id={inputId}
        aria-label={def.label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? hintId : undefined}
        value={value}
        prefix={def.prefix}
        suffix={def.suffix}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  let provenance: React.ReactNode = null;
  if (inBranch) {
    if (!def.branchable) provenance = 'Solo se define a nivel empresa';
    else if (source === 'branch') {
      provenance = (
        <>
          Personalizado en {scope.branchName} ·{' '}
          <button type="button" className="ui-settings-row__reset" onClick={onReset}>Restablecer</button>
        </>
      );
    } else provenance = 'Heredado de empresa';
  }

  return (
    <div className={`ui-settings-row ${dirty ? 'is-dirty' : ''}`.trim()} data-setting-key={def.key}>
      <div className="ui-settings-row__text">
        <label className="ui-settings-row__label" htmlFor={def.type === 'boolean' || readOnly ? undefined : inputId}>
          {def.label}
        </label>
        <p className="ui-settings-row__desc">{def.description}</p>
        {provenance ? <p className="ui-settings-row__source">{provenance}</p> : null}
      </div>
      <div className="ui-settings-row__control">
        {control}
        {error ? <p id={hintId} className="ui-settings-row__error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}
