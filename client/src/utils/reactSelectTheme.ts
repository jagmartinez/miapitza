import type { CSSObjectWithLabel, GroupBase, StylesConfig } from 'react-select';

type SelectVariant = 'standard' | 'modal';

export function getReactSelectThemeStyles<
    Option,
    IsMulti extends boolean = false,
    Group extends GroupBase<Option> = GroupBase<Option>
>(variant: SelectVariant = 'standard'): StylesConfig<Option, IsMulti, Group> {
    const controlBg = variant === 'modal' ? 'var(--dialog-field-bg, var(--ui-bg))' : 'var(--ui-surface)';
    const accent = variant === 'modal' ? 'var(--dialog-accent)' : 'var(--ui-primary)';
    const focusRing = variant === 'modal' ? 'var(--dialog-focus-ring)' : 'rgba(37, 99, 235, 0.1)';

    return {
        control: (base, state) => ({
            ...base,
            backgroundColor: state.isDisabled
                ? 'color-mix(in srgb, var(--ui-bg) 82%, var(--ui-surface))'
                : state.isFocused ? 'var(--ui-surface)' : controlBg,
            borderColor: state.isFocused ? accent : 'var(--ui-border)',
            boxShadow: state.isFocused ? `0 0 0 3px ${focusRing}` : 'none',
            minHeight: variant === 'modal' ? 42 : 38,
            cursor: state.isDisabled ? 'not-allowed' : 'pointer',
            opacity: state.isDisabled ? 0.62 : 1,
            '&:hover': {
                borderColor: state.isFocused ? accent : 'var(--ui-border)',
            },
        }),
        menu: (base) => ({
            ...base,
            backgroundColor: variant === 'modal' ? 'var(--dialog-panel-bg, var(--ui-surface))' : 'var(--ui-surface)',
            border: `1px solid ${variant === 'modal' ? 'var(--dialog-panel-border, var(--ui-border))' : 'var(--ui-border)'}`,
            borderRadius: 8,
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
            color: 'var(--ui-text)',
        }),
        menuList: (base) => ({
            ...base,
            paddingTop: 0,
            paddingBottom: 0,
        }),
        option: (base, state) => ({
            ...base,
            backgroundColor: state.isSelected
                ? accent
                : state.isFocused
                    ? 'var(--ui-surface-2)'
                    : 'transparent',
            color: state.isSelected ? '#ffffff' : 'var(--ui-text)',
            cursor: 'pointer',
        }),
        singleValue: (base) => ({
            ...base,
            color: 'var(--ui-text)',
        }),
        placeholder: (base) => ({
            ...base,
            color: 'var(--ui-text-muted)',
        }),
        input: (base) => ({
            ...base,
            color: 'var(--ui-text)',
            margin: 0,
            padding: 0,
        }),
        valueContainer: (base) => ({
            ...base,
            padding: '0 16px',
        }),
        dropdownIndicator: (base) => ({
            ...base,
            color: 'var(--ui-text-muted)',
            padding: '8px 12px',
        }),
        clearIndicator: (base) => ({
            ...base,
            color: 'var(--ui-text-muted)',
            padding: '8px 12px',
            ':hover': {
                color: 'var(--ui-text)',
            },
        }),
        indicatorSeparator: () => ({
            display: 'none',
        }),
        noOptionsMessage: (base) => ({
            ...base,
            color: 'var(--ui-text-muted)',
        }),
        loadingMessage: (base) => ({
            ...base,
            color: 'var(--ui-text-muted)',
        }),
        multiValue: (base) => ({
            ...base,
            backgroundColor: 'var(--ui-bg)',
        }),
        multiValueLabel: (base) => ({
            ...base,
            color: 'var(--ui-text)',
        }),
        multiValueRemove: (base) => ({
            ...base,
            color: 'var(--ui-text-muted)',
            ':hover': {
                backgroundColor: 'var(--ui-danger)',
                color: '#ffffff',
            },
        }),
    };
}

export function mergeReactSelectStyles<
    Option,
    IsMulti extends boolean = false,
    Group extends GroupBase<Option> = GroupBase<Option>
>(
    themeStyles: StylesConfig<Option, IsMulti, Group>,
    userStyles?: StylesConfig<Option, IsMulti, Group>
): StylesConfig<Option, IsMulti, Group> {
    if (!userStyles) return themeStyles;

    const merged: Record<string, unknown> = { ...themeStyles };

    for (const [key, userFn] of Object.entries(userStyles)) {
        const themeFn = themeStyles[key as keyof StylesConfig<Option, IsMulti, Group>];
        if (typeof themeFn === 'function' && typeof userFn === 'function') {
            merged[key] = (base: CSSObjectWithLabel, state: unknown) =>
                (userFn as (b: CSSObjectWithLabel, s: unknown) => CSSObjectWithLabel)(
                    (themeFn as (b: CSSObjectWithLabel, s: unknown) => CSSObjectWithLabel)(base, state),
                    state
                );
        } else {
            merged[key] = userFn;
        }
    }

    return merged as StylesConfig<Option, IsMulti, Group>;
}

export { appSelectStyles } from '../ui/forms/appSelectStyles';
