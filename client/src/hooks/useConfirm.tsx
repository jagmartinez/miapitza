import { useCallback } from 'react';
import { useConfirmDialog } from '../context/ConfirmContext';

export { useConfirmDialog, type ConfirmOptions } from '../context/ConfirmContext';

type ConfirmVariant = 'danger' | 'warning' | 'info';

/** @deprecated Prefer useConfirmDialog from ConfirmContext */
export function useConfirm() {
    const { confirm: confirmDialog } = useConfirmDialog();

    const confirm = useCallback((
        title: string,
        message: string,
        onConfirm: () => void,
        variant: ConfirmVariant = 'danger'
    ) => {
        void confirmDialog(message, { title, variant }).then((ok) => {
            if (ok) onConfirm();
        });
    }, [confirmDialog]);

    const ConfirmDialogComponent = () => null;

    return {
        confirm,
        ConfirmDialog: ConfirmDialogComponent,
    };
}
