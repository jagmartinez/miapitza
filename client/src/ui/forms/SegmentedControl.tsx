import type { LucideIcon } from 'lucide-react';
import { Tooltip } from '../primitives/Tooltip';
import './forms.css';

type Option<T extends string> = {
  value: T;
  /** Texto visible; en modo solo-icono es el nombre accesible y el tooltip. */
  label: string;
  icon?: LucideIcon;
  /** Muestra solo el icono (requiere `icon`); `label` pasa a aria-label + Tooltip. */
  iconOnly?: boolean;
};

type Props<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  /** Todas las opciones con icono se muestran solo con el icono (alto 40 px, tooltip con su label). */
  iconOnly?: boolean;
};

export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel, size = 'md', iconOnly = false }: Props<T>) {
  const isIconOnly = (o: Option<T>) => !!o.icon && (o.iconOnly ?? iconOnly);
  const allIconOnly = options.length > 0 && options.every(isIconOnly);
  return (
    <div
      className={`ui-segmented ui-segmented--${size}${allIconOnly ? ' ui-segmented--icononly' : ''}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((o) => {
        const Icon = o.icon;
        const active = o.value === value;
        const onlyIcon = isIconOnly(o);
        const cls = [
          'ui-segmented__btn',
          Icon ? 'ui-segmented__btn--icon' : '',
          onlyIcon ? 'ui-segmented__btn--icononly' : '',
          active ? 'is-active' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const iconNode = Icon ? <Icon className="ui-segmented__icon" size={onlyIcon ? 18 : size === 'sm' ? 14 : 16} aria-hidden="true" /> : null;
        if (onlyIcon) {
          return (
            <Tooltip key={o.value} label={o.label}>
              <button type="button" aria-pressed={active} aria-label={o.label} className={cls} onClick={() => onChange(o.value)}>
                {iconNode}
              </button>
            </Tooltip>
          );
        }
        return (
          <button key={o.value} type="button" aria-pressed={active} className={cls} onClick={() => onChange(o.value)}>
            {iconNode}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
