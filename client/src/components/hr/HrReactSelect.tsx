import {
  Children,
  isValidElement,
  type ChangeEvent,
  type ChangeEventHandler,
  type ReactNode,
} from 'react';
import Select from '../Select';
import './HrControls.css';

interface LegacyOption {
  value: string;
  label: string;
  isDisabled?: boolean;
}

interface HrReactSelectProps {
  children: ReactNode;
  value?: string | number | null;
  onChange?: ChangeEventHandler<HTMLSelectElement>;
  id?: string;
  name?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  'aria-label'?: string;
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function optionsOf(children: ReactNode): LegacyOption[] {
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

export default function HrReactSelect({
  children,
  value,
  onChange,
  id,
  name,
  className = '',
  disabled = false,
  required = false,
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
    <Select<LegacyOption>
      variant="modal"
      inputId={id}
      name={name}
      className={`hr-react-select ${className}`.trim()}
      aria-label={ariaLabel}
      options={options}
      value={selected}
      onChange={(option) => emitChange(option?.value ?? '')}
      isDisabled={disabled}
      isSearchable={options.length > 8}
      isOptionDisabled={(option) => Boolean(option.isDisabled)}
      required={required}
    />
  );
}
