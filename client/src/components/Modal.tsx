import { ReactNode, useRef } from 'react';
import { X } from 'lucide-react';
import { useDialogA11y } from '../hooks/useDialogA11y';
import './Modal.css';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'center' | 'sidebar';
    closeOnBackdrop?: boolean;
}

export default function Modal({
    isOpen,
    onClose,
    title,
    children,
    size = 'md',
    variant = 'center',
    closeOnBackdrop = true,
}: ModalProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { titleId } = useDialogA11y(isOpen, onClose, containerRef);

    if (!isOpen) return null;

    const containerClass = variant === 'sidebar'
        ? `modal-sidebar modal-${size}`
        : `modal-container modal-${size}`;

    return (
        <div
            className={`modal-overlay ${variant === 'sidebar' ? 'modal-overlay-sidebar' : ''}`}
            onClick={closeOnBackdrop ? onClose : undefined}
        >
            <div
                ref={containerRef}
                className={containerClass}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h2 id={titleId}>{title}</h2>
                    <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
                        <X size={24} aria-hidden="true" />
                    </button>
                </div>
                <div className="modal-body">
                    {children}
                </div>
            </div>
        </div>
    );
}
