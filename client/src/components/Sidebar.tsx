import { ReactNode, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PanelRightOpen, X } from 'lucide-react';
import { useDialogA11y } from '../hooks/useDialogA11y';
import './Sidebar.css';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    width?: 'normal' | 'medium' | 'large' | 'wide' | 'full';
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
    description?: ReactNode;
    footer?: ReactNode;
}

export default function Sidebar({ isOpen, onClose, title, children, width = 'normal', closeOnBackdrop = true, closeOnEscape = true, description, footer }: SidebarProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const { titleId, descriptionId } = useDialogA11y(isOpen, onClose, panelRef, { closeOnEscape });

    // React 18's DOM types do not expose `inert` yet. Layout timing removes it
    // before the shared focus-management effect runs when the panel opens.
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        if (isOpen) panel.removeAttribute('inert');
        else panel.setAttribute('inert', '');
    }, [isOpen]);

    return createPortal(
        <>
            {isOpen && <div className="sidebar-overlay" onClick={closeOnBackdrop ? onClose : undefined} aria-hidden="true" />}

            <div
                ref={panelRef}
                className={`sidebar-panel sidebar-${width} ${isOpen ? 'sidebar-open' : ''}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descriptionId : undefined}
                aria-hidden={!isOpen}
                tabIndex={-1}
            >
                <div className="sidebar-header">
                    <div className="sidebar-heading">
                        <span className="sidebar-heading-icon" aria-hidden="true"><PanelRightOpen size={20} /></span>
                        <h2 id={titleId}>{title}</h2>
                    </div>
                    <button type="button" className="sidebar-close" onClick={onClose} aria-label={`Cerrar ${title}`}>
                        <X size={24} aria-hidden="true" />
                    </button>
                </div>
                <div className="sidebar-body">
                    {description && <div id={descriptionId} className="sidebar-description">{description}</div>}
                    {children}
                </div>
                {footer && <div className="sidebar-actions">{footer}</div>}
            </div>
        </>,
        document.body,
    );
}
