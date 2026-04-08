import { X } from 'lucide-react';
import Button from './Button';
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
    onCancel
}: ConfirmDialogProps) {
    if (!isOpen) return null;

    return (
        <div className="confirm-dialog-overlay" onClick={onCancel}>
            <div className="confirm-dialog" onClick={event => event.stopPropagation()}>
                <div className="confirm-dialog-header">
                    <h3 className="confirm-dialog-title">{title}</h3>
                    <button className="confirm-dialog-close" onClick={onCancel}>
                        <X size={20} />
                    </button>
                </div>
                <div className="confirm-dialog-body">
                    <p className="confirm-dialog-message">{message}</p>
                </div>
                <div className="confirm-dialog-footer">
                    <Button variant="secondary" onClick={onCancel}>
                        {cancelText}
                    </Button>
                    <Button
                        variant={variant === 'danger' ? 'danger' : 'primary'}
                        onClick={() => {
                            onConfirm();
                            onCancel();
                        }}
                        className={`confirm-btn-${variant}`}
                    >
                        {confirmText}
                    </Button>
                </div>
            </div>
        </div>
    );
}
