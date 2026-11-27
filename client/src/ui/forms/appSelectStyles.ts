import type { StylesConfig } from 'react-select';

/** Estilos de react-select; todo el color sale de tokens --ui-*. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const appSelectStyles: StylesConfig<any, boolean, any> = {
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    fontSize: 'var(--ui-text-md)',
    backgroundColor: 'var(--ui-surface)',
    borderColor: state.isFocused ? 'var(--ui-primary)' : 'var(--ui-border)',
    borderRadius: 'var(--ui-radius-md)',
    boxShadow: 'none',
    cursor: 'pointer',
    '&:hover': { borderColor: state.isFocused ? 'var(--ui-primary)' : 'var(--ui-border)' },
  }),
  menuPortal: (base) => ({ ...base, zIndex: 'var(--ui-z-select-menu)' as unknown as number }),
  menu: (base) => ({
    ...base,
    fontSize: 'var(--ui-text-md)',
    backgroundColor: 'var(--ui-surface)',
    border: '1px solid var(--ui-border)',
    borderRadius: 'var(--ui-radius-md)',
    boxShadow: '0 8px 24px var(--ui-overlay)',
    overflow: 'hidden',
    color: 'var(--ui-text)',
  }),
  menuList: (base) => ({ ...base, paddingTop: 4, paddingBottom: 4 }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected
      ? 'var(--ui-primary)'
      : state.isFocused
        ? 'var(--ui-surface-2)'
        : 'transparent',
    color: state.isSelected ? 'var(--ui-primary-fg)' : state.isDisabled ? 'var(--ui-text-muted)' : 'var(--ui-text)',
    cursor: state.isDisabled ? 'not-allowed' : 'pointer',
    '&:active': { backgroundColor: 'var(--ui-primary-soft)' },
  }),
  singleValue: (base) => ({ ...base, color: 'var(--ui-text)' }),
  placeholder: (base) => ({ ...base, color: 'var(--ui-text-muted)' }),
  input: (base) => ({ ...base, color: 'var(--ui-text)' }),
  valueContainer: (base) => ({ ...base, padding: '0 var(--ui-space-1) 0 var(--ui-space-3)' }),
  dropdownIndicator: (base) => ({ ...base, color: 'var(--ui-text-muted)', padding: '0 var(--ui-space-2) 0 var(--ui-space-1)' }),
  clearIndicator: (base) => ({
    ...base,
    color: 'var(--ui-text-muted)',
    padding: '0 var(--ui-space-2)',
    ':hover': { color: 'var(--ui-text)' },
  }),
  indicatorSeparator: () => ({ display: 'none' }),
  noOptionsMessage: (base) => ({ ...base, color: 'var(--ui-text-muted)' }),
  loadingMessage: (base) => ({ ...base, color: 'var(--ui-text-muted)' }),
  multiValue: (base) => ({ ...base, backgroundColor: 'var(--ui-primary-soft)', borderRadius: 'var(--ui-radius-sm)' }),
  multiValueLabel: (base) => ({ ...base, color: 'var(--ui-primary)' }),
  multiValueRemove: (base) => ({
    ...base,
    color: 'var(--ui-primary)',
    ':hover': { backgroundColor: 'var(--ui-danger)', color: 'var(--ui-primary-fg)' },
  }),
};
