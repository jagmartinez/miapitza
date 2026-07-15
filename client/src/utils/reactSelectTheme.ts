import type { CSSObjectWithLabel, GroupBase, StylesConfig } from 'react-select';

type SelectVariant = 'standard' | 'modal';

export function getReactSelectThemeStyles<
    Option,
    IsMulti extends boolean = false,
    Group extends GroupBase<Option> = GroupBase<Option>
>(variant: SelectVariant = 'standard'): StylesConfig<Option, IsMulti, Group> {
    const controlBg = variant === 'modal' ? 'var(--color-background)' : 'var(--color-surface)';
    const accent = variant === 'modal' ? 'var(--dialog-accent)' : 'var(--color-primary)';
    const focusRing = variant === 'modal' ? 'var(--dialog-focus-ring)' : 'rgba(37, 99, 235, 0.1)';

    return {
        control: (base, state) => ({
            ...base,
            backgroundColor: state.isDisabled
                ? 'color-mix(in srgb, var(--color-background) 82%, var(--color-surface))'
                : state.isFocused ? 'var(--color-surface)' : controlBg,
            borderColor: state.isFocused ? accent : 'var(--color-border)',
            boxShadow: state.isFocused ? `0 0 0 3px ${focusRing}` : 'none',
            minHeight: 38,
            cursor: state.isDisabled ? 'not-allowed' : 'pointer',
            opacity: state.isDisabled ? 0.62 : 1,
            '&:hover': {
                borderColor: state.isFocused ? accent : 'var(--color-border)',
            },
        }),
        menu: (base) => ({
            ...base,
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
            color: 'var(--color-text)',
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
                    ? 'var(--color-surface-hover)'
                    : 'transparent',
            color: state.isSelected ? '#ffffff' : 'var(--color-text)',
            cursor: 'pointer',
        }),
        singleValue: (base) => ({
            ...base,
            color: 'var(--color-text)',
        }),
        placeholder: (base) => ({
            ...base,
            color: 'var(--color-text-tertiary)',
        }),
        input: (base) => ({
            ...base,
            color: 'var(--color-text)',
            margin: 0,
            padding: 0,
        }),
        valueContainer: (base) => ({
            ...base,
            padding: '0 16px',
        }),
        dropdownIndicator: (base) => ({
            ...base,
            color: 'var(--color-neutral-500)',
            padding: '8px 12px',
        }),
        clearIndicator: (base) => ({
            ...base,
            color: 'var(--color-neutral-500)',
            padding: '8px 12px',
            ':hover': {
                color: 'var(--color-text)',
            },
        }),
        indicatorSeparator: () => ({
            display: 'none',
        }),
        noOptionsMessage: (base) => ({
            ...base,
            color: 'var(--color-text-secondary)',
        }),
        loadingMessage: (base) => ({
            ...base,
            color: 'var(--color-text-secondary)',
        }),
        multiValue: (base) => ({
            ...base,
            backgroundColor: 'var(--color-background)',
        }),
        multiValueLabel: (base) => ({
            ...base,
            color: 'var(--color-text)',
        }),
        multiValueRemove: (base) => ({
            ...base,
            color: 'var(--color-text-secondary)',
            ':hover': {
                backgroundColor: 'var(--color-danger)',
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
