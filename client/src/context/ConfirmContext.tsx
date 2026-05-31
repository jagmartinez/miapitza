import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

type ConfirmVariant = 'danger' | 'warning' | 'info';

export type ConfirmOptions = {
    title?: string;
    confirmText?: string;
    cancelText?: string;
    variant?: ConfirmVariant;
};

type ConfirmContextValue = {
    confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [dialog, setDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        variant: ConfirmVariant;
        confirmText: string;
        cancelText: string;
        resolve: (value: boolean) => void;
    } | null>(null);

    const confirm = useCallback((message: string, options: ConfirmOptions = {}) => {
        return new Promise<boolean>((resolve) => {
            setDialog({
                isOpen: true,
                title: options.title ?? 'Confirmar',
                message,
                variant: options.variant ?? 'danger',
                confirmText: options.confirmText ?? 'Confirmar',
                cancelText: options.cancelText ?? 'Cancelar',
                resolve,
            });
        });
    }, []);

    const close = (value: boolean) => {
        dialog?.resolve(value);
        setDialog(null);
    };

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            {dialog && (
                <ConfirmDialog
                    isOpen={dialog.isOpen}
                    title={dialog.title}
                    message={dialog.message}
                    variant={dialog.variant}
                    confirmText={dialog.confirmText}
                    cancelText={dialog.cancelText}
                    onConfirm={() => close(true)}
                    onCancel={() => close(false)}
                />
            )}
        </ConfirmContext.Provider>
    );
}

export function useConfirmDialog() {
    const ctx = useContext(ConfirmContext);
    if (!ctx) {
        throw new Error('useConfirmDialog must be used within ConfirmProvider');
    }
    return ctx;
}
