import { useRef } from 'react';
import { X } from 'lucide-react';
import Button from './Button';
import { useDialogA11y } from '../hooks/useDialogA11y';
import './ConfirmDialog.css';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'warning' | 'info';
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    variant = 'danger',
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const { titleId, descriptionId } = useDialogA11y(isOpen, onCancel, dialogRef);

    if (!isOpen) return null;

    return (
        <div className="confirm-dialog-overlay" onClick={onCancel}>
            <div
                ref={dialogRef}
                className="confirm-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                tabIndex={-1}
                onClick={event => event.stopPropagation()}
            >
                <div className="confirm-dialog-header">
                    <h3 id={titleId} className="confirm-dialog-title">{title}</h3>
                    <button type="button" className="confirm-dialog-close" onClick={onCancel} aria-label="Cerrar">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>
                <div className="confirm-dialog-body">
                    <p id={descriptionId} className="confirm-dialog-message">{message}</p>
                </div>
                <div className="confirm-dialog-footer">
                    <Button variant="ghost" onClick={onCancel}>
                        {cancelText}
                    </Button>
                    <Button
                        variant={variant === 'danger' ? 'danger' : 'primary'}
                        onClick={onConfirm}
                        className={`confirm-btn-${variant}`}
                    >
                        {confirmText}
                    </Button>
                </div>
            </div>
        </div>
    );
}
