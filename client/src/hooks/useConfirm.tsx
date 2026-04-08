import { useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

type ConfirmVariant = 'danger' | 'warning' | 'info';

export function useConfirm() {
    const [dialog, setDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        variant: ConfirmVariant;
        onConfirm: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        variant: 'danger',
        onConfirm: () => {}
    });

    const confirm = (
        title: string,
        message: string,
        onConfirm: () => void,
        variant: ConfirmVariant = 'danger'
    ) => {
        setDialog({
            isOpen: true,
            title,
            message,
            variant,
            onConfirm
        });
    };

    const closeDialog = () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
    };

    const ConfirmDialogComponent = () => (
        <ConfirmDialog
            isOpen={dialog.isOpen}
            title={dialog.title}
            message={dialog.message}
            variant={dialog.variant}
            onConfirm={dialog.onConfirm}
            onCancel={closeDialog}
        />
    );

    return {
        confirm,
        ConfirmDialog: ConfirmDialogComponent
    };
}
