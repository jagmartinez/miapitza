import './forms.css';

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
};

export function Switch({ checked, onChange, label, id, disabled }: Props) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`ui-switch ${checked ? 'ui-switch--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch__track" aria-hidden="true">
        <span className="ui-switch__thumb" />
      </span>
      <span className="ui-switch__label">{label}</span>
    </button>
  );
}
