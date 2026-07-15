import { ReactNode, useCallback, useId, useRef, useState } from 'react';
import Select, { CSSObjectWithLabel, GroupBase, Props as SelectProps } from 'react-select';
import { getReactSelectThemeStyles, mergeReactSelectStyles } from '../utils/reactSelectTheme';
import './Select.css';

const MENU_ESTIMATED_HEIGHT = 240;
const MODAL_MENU_Z_INDEX = 10100;

type MenuPlacement = 'auto' | 'top' | 'bottom';

function computeModalMenuPlacement(
    anchorEl: HTMLElement,
    preferred?: MenuPlacement
): MenuPlacement {
    if (preferred === 'top' || preferred === 'bottom') return preferred;

    const rect = anchorEl.getBoundingClientRect();
    let obstructionBottom = window.innerHeight;

    document.querySelectorAll('.sidebar-panel').forEach((sidebar) => {
        const sidebarRect = sidebar.getBoundingClientRect();
        if (rect.left < sidebarRect.left || rect.right > sidebarRect.right) return;

        const footer = sidebar.querySelector('.modal-footer');
        if (footer) {
            const footerRect = footer.getBoundingClientRect();
            if (footerRect.top > rect.top) {
                obstructionBottom = Math.min(obstructionBottom, footerRect.top);
            }
            return;
        }

        obstructionBottom = Math.min(obstructionBottom, sidebarRect.bottom);
    });

    document.querySelectorAll('.modal-container .modal-footer, .modal-form-new > .modal-footer').forEach((footer) => {
        const footerRect = footer.getBoundingClientRect();
        if (footerRect.top > rect.top) {
            obstructionBottom = Math.min(obstructionBottom, footerRect.top);
        }
    });

    const spaceBelow = obstructionBottom - rect.bottom - 8;
    const spaceAbove = rect.top - 8;

    if (spaceBelow < MENU_ESTIMATED_HEIGHT && spaceAbove >= spaceBelow) {
        return 'top';
    }

    return 'auto';
}

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
    inputId,
    onMenuOpen,
    ...props
}: CustomSelectProps<Option, IsMulti, Group>) {
    const generatedId = useId();
    const resolvedInputId = inputId ?? generatedId;
    const combinedClassName = `select-group ${variant} ${className}`;
    const isModal = variant === 'modal';
    const anchorRef = useRef<HTMLDivElement>(null);
    const [dynamicMenuPlacement, setDynamicMenuPlacement] = useState<MenuPlacement>('auto');

    const resolvedMenuPosition = isModal ? (menuPosition ?? 'fixed') : menuPosition;
    const resolvedMenuPortalTarget = isModal
        ? (menuPortalTarget ?? (typeof document !== 'undefined' ? document.body : undefined))
        : menuPortalTarget;

    const themeStyles = getReactSelectThemeStyles<Option, IsMulti, Group>(variant);
    const mergedStyles = mergeReactSelectStyles(themeStyles, styles);

    const resolvedStyles = isModal
        ? {
            ...mergedStyles,
            menuPortal: (base: CSSObjectWithLabel, state: unknown) => ({
                ...base,
                '--select-accent': 'var(--dialog-accent)',
                zIndex: MODAL_MENU_Z_INDEX,
                ...(mergedStyles?.menuPortal ? mergedStyles.menuPortal(base, state as never) : {})
            }),
            menu: (base: CSSObjectWithLabel, state: unknown) => ({
                ...(mergedStyles.menu ? mergedStyles.menu(base, state as never) : base),
                zIndex: MODAL_MENU_Z_INDEX,
            }),
        }
        : mergedStyles;

    const effectiveMenuPlacement: MenuPlacement | undefined = isModal
        ? (menuPlacement === 'top' || menuPlacement === 'bottom'
            ? menuPlacement
            : dynamicMenuPlacement)
        : menuPlacement;

    const handleMenuOpen = useCallback(() => {
        if (isModal && anchorRef.current) {
            setDynamicMenuPlacement(
                computeModalMenuPlacement(anchorRef.current, menuPlacement ?? 'auto')
            );
        }
        onMenuOpen?.();
    }, [isModal, menuPlacement, onMenuOpen]);

    return (
        <div className={combinedClassName} ref={anchorRef}>
            {label && <label className="select-label" htmlFor={resolvedInputId}>{label}</label>}
            <Select
                inputId={resolvedInputId}
                classNamePrefix={classNamePrefix}
                {...props}
                menuPlacement={effectiveMenuPlacement}
                menuPosition={resolvedMenuPosition}
                menuPortalTarget={resolvedMenuPortalTarget}
                menuShouldScrollIntoView={isModal ? true : props.menuShouldScrollIntoView}
                styles={resolvedStyles}
                onMenuOpen={handleMenuOpen}
            />
            {error && <span className="select-error-message">{error}</span>}
        </div>
    );
}
