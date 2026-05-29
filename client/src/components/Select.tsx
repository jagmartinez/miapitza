import { ReactNode } from 'react';
import Select, { CSSObjectWithLabel, GroupBase, Props as SelectProps } from 'react-select';
import './Select.css';

interface CustomSelectProps<
    Option = { value: string | number; label: string },
    IsMulti extends boolean = false,
    Group extends GroupBase<Option> = GroupBase<Option>
> extends SelectProps<Option, IsMulti, Group> {
    label?: ReactNode;
    error?: string;
    variant?: 'standard' | 'modal';
}

export default function CustomSelect<
    Option = { value: string | number; label: string },
    IsMulti extends boolean = false,
    Group extends GroupBase<Option> = GroupBase<Option>
>({
    label,
    error,
    variant = 'standard',
    className = '',
    classNamePrefix = 'react-select',
    menuPlacement,
    menuPosition,
    menuPortalTarget,
    styles,
    ...props
}: CustomSelectProps<Option, IsMulti, Group>) {
    const combinedClassName = `select-group ${variant} ${className}`;
    const isModal = variant === 'modal';
    const resolvedMenuPlacement = isModal ? (menuPlacement ?? 'auto') : menuPlacement;
    const resolvedMenuPosition = isModal ? (menuPosition ?? 'fixed') : menuPosition;
    const resolvedMenuPortalTarget = isModal
        ? (menuPortalTarget ?? (typeof document !== 'undefined' ? document.body : undefined))
        : menuPortalTarget;
    const resolvedStyles = isModal
        ? {
            ...styles,
            menuPortal: (base: CSSObjectWithLabel, state: unknown) => ({
                ...base,
                zIndex: 9999,
                ...(styles?.menuPortal ? styles.menuPortal(base, state as never) : {})
            })
        }
        : styles;

    return (
        <div className={combinedClassName}>
            {label && <label className="select-label">{label}</label>}
            <Select
                classNamePrefix={classNamePrefix}
                {...props}
                menuPlacement={resolvedMenuPlacement}
                menuPosition={resolvedMenuPosition}
                menuPortalTarget={resolvedMenuPortalTarget}
                styles={resolvedStyles}
            />
            {error && <span className="select-error-message">{error}</span>}
        </div>
    );
}
