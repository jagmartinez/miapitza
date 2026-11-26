import { ConfirmDialog as UiConfirmDialog } from '@/ui';

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

/** Adaptador heredado sobre `ui/overlays/ConfirmDialog`. */
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
    return (
        <UiConfirmDialog
            isOpen={isOpen}
            title={title}
            message={message}
            confirmLabel={confirmText}
            cancelLabel={cancelText}
            tone={variant === 'danger' ? 'danger' : 'primary'}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    );
}
