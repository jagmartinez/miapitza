import {
  Children,
  isValidElement,
  type ChangeEvent,
  type ChangeEventHandler,
  type ReactNode,
} from 'react';
import { AppSelect, type Opt } from '@/ui';
import './HrControls.css';

interface HrReactSelectProps {
  children: ReactNode;
  value?: string | number | null;
  onChange?: ChangeEventHandler<HTMLSelectElement>;
  id?: string;
  name?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  isSearchable?: boolean;
  'aria-label'?: string;
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function optionsOf(children: ReactNode): Opt<string>[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) return [];
    if (child.type !== 'option') return optionsOf(child.props.children);
    return [{
      value: String(child.props.value ?? ''),
      label: textOf(child.props.children).trim(),
      isDisabled: Boolean(child.props.disabled),
    }];
  });
}

/** Adaptador de compatibilidad: acepta <option> como hijos y delega en AppSelect del design system. */
export default function HrReactSelect({
  children,
  value,
  onChange,
  id,
  name,
  className = '',
  disabled = false,
  'aria-label': ariaLabel,
}: HrReactSelectProps) {
  const options = optionsOf(children);
  const currentValue = String(value ?? '');
  const selected = options.find((option) => option.value === currentValue) ?? null;

  const emitChange = (nextValue: string) => {
    if (!onChange) return;
    const target = { value: nextValue, name } as HTMLSelectElement;
    onChange({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>);
  };

  return (
    <span className={`hr-react-select ${className}`.trim()}>
      <AppSelect<string>
        inputId={id}
        aria-label={ariaLabel}
        options={options}
        value={selected ? selected.value : null}
        onChange={(next) => emitChange(next ?? '')}
        isDisabled={disabled}
        isClearable={false}
      />
    </span>
  );
}
