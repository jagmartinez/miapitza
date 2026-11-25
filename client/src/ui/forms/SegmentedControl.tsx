import './forms.css';

type Props<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
};

export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel, size = 'md' }: Props<T>) {
  return (
    <div className={`ui-segmented ui-segmented--${size}`} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          className={`ui-segmented__btn ${o.value === value ? 'is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
