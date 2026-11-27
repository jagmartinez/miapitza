import type { LucideIcon } from 'lucide-react';
import './forms.css';

type Option<T extends string> = { value: T; label: string; icon?: LucideIcon };

type Props<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
};

export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel, size = 'md' }: Props<T>) {
  return (
    <div className={`ui-segmented ui-segmented--${size}`} role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            className={`ui-segmented__btn ${Icon ? 'ui-segmented__btn--icon' : ''} ${o.value === value ? 'is-active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {Icon && <Icon className="ui-segmented__icon" size={size === 'sm' ? 14 : 16} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
