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
    closeOnEscape?: boolean;
    description?: ReactNode;
    footer?: ReactNode;
}

export default function Modal({
    isOpen,
    onClose,
    title,
    children,
    size = 'md',
    variant = 'center',
    closeOnBackdrop = true,
    closeOnEscape = true,
    description,
    footer,
}: ModalProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { titleId, descriptionId } = useDialogA11y(isOpen, onClose, containerRef, { closeOnEscape });

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
                aria-describedby={description ? descriptionId : undefined}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h2 id={titleId}>{title}</h2>
                    <button type="button" className="modal-close" onClick={onClose} aria-label={`Cerrar ${title}`}>
                        <X size={24} aria-hidden="true" />
                    </button>
                </div>
                <div className="modal-body">
                    {description && <div id={descriptionId} className="modal-description">{description}</div>}
                    {children}
                </div>
                {footer && <div className="modal-actions">{footer}</div>}
            </div>
        </div>
    );
}
