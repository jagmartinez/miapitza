import { ReactNode, useRef } from 'react';
import { X } from 'lucide-react';
import { useDialogA11y } from '../hooks/useDialogA11y';
import './Sidebar.css';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    width?: 'normal' | 'large' | 'wide' | 'full';
}

export default function Sidebar({ isOpen, onClose, title, children, width = 'normal' }: SidebarProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const { titleId } = useDialogA11y(isOpen, onClose, panelRef);

    return (
        <>
            {isOpen && <div className="sidebar-overlay" onClick={onClose} aria-hidden="true" />}

            <div
                ref={panelRef}
                className={`sidebar-panel sidebar-${width} ${isOpen ? 'sidebar-open' : ''}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-hidden={!isOpen}
                tabIndex={-1}
            >
                <div className="sidebar-header">
                    <h2 id={titleId}>{title}</h2>
                    <button type="button" className="sidebar-close" onClick={onClose} aria-label="Cerrar">
                        <X size={24} aria-hidden="true" />
                    </button>
                </div>
                <div className="sidebar-body">
                    {children}
                </div>
            </div>
        </>
    );
}
