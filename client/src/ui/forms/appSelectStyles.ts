import type { StylesConfig, Theme } from 'react-select';

/** Tema de react-select mapeado a tokens: cubre los colores base que los estilos no sobrescriben (hover, grupos, cargando). */
export const appSelectTheme = (theme: Theme): Theme => ({
  ...theme,
  borderRadius: 8,
  colors: {
    ...theme.colors,
    primary: 'var(--ui-primary)',
    primary75: 'var(--ui-primary)',
    primary50: 'var(--ui-primary-soft)',
    primary25: 'var(--ui-surface-2)',
    danger: 'var(--ui-danger)',
    dangerLight: 'var(--ui-danger-soft)',
    neutral0: 'var(--ui-surface)',
    neutral5: 'var(--ui-surface-2)',
    neutral10: 'var(--ui-surface-2)',
    neutral20: 'var(--ui-border)',
    neutral30: 'var(--ui-border)',
    neutral40: 'var(--ui-text-muted)',
    neutral50: 'var(--ui-text-muted)',
    neutral60: 'var(--ui-text-muted)',
    neutral70: 'var(--ui-text)',
    neutral80: 'var(--ui-text)',
    neutral90: 'var(--ui-text)',
  },
});

/** Estilos de react-select; todo el color sale de tokens --ui-*. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const appSelectStyles: StylesConfig<any, boolean, any> = {
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    fontSize: 'var(--ui-text-md)',
    backgroundColor: state.isDisabled ? 'var(--ui-surface-2)' : 'var(--ui-surface)',
    opacity: state.isDisabled ? 0.55 : 1,
    borderColor: state.isFocused ? 'var(--ui-primary)' : 'var(--ui-border)',
    borderRadius: 'var(--ui-radius-md)',
    boxShadow: state.isFocused ? 'var(--ui-focus-ring)' : 'none',
    cursor: state.isDisabled ? 'not-allowed' : 'pointer',
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
  dropdownIndicator: (base) => ({
    ...base,
    color: 'var(--ui-text-muted)',
    padding: '0 var(--ui-space-2) 0 var(--ui-space-1)',
    ':hover': { color: 'var(--ui-text)' },
  }),
  loadingIndicator: (base) => ({ ...base, color: 'var(--ui-text-muted)' }),
  groupHeading: (base) => ({ ...base, color: 'var(--ui-text-muted)', fontSize: 'var(--ui-text-xs)', fontWeight: 600 }),
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
