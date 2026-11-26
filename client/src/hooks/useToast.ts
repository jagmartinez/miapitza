import { useCallback } from 'react';
import type { ToastItemData, ToastType } from '../components/Toast';
import { markErrorHandled, notifyError, publishNotice } from '../services/notify';

const NO_TOASTS: ToastItemData[] = [];

/**
 * Legacy page-local toast hook. It now forwards to the app-wide toast stack
 * (ToastProvider) so every notice gets the same placement, accessibility,
 * dedupe and durations. `toasts` stays empty, so a page-local
 * `<ToastContainer toasts={toasts} />` renders nothing and can be removed.
 */
export function useToast() {
    /** `cause` marks the reported error as handled so a rethrow is not toasted twice. */
    const showToast = useCallback((message: string, type: ToastType = 'info', cause?: unknown) => {
        if (cause !== undefined) markErrorHandled(cause);
        publishNotice({ message, type });
    }, []);

    const removeToast = useCallback((_id: string) => undefined, []);

    const success = useCallback((message: string) => showToast(message, 'success'), [showToast]);
    const error = useCallback((message: string, cause?: unknown) => showToast(message, 'error', cause), [showToast]);
    const warning = useCallback((message: string) => showToast(message, 'warning'), [showToast]);
    const info = useCallback((message: string) => showToast(message, 'info'), [showToast]);

    return {
        toasts: NO_TOASTS,
        showToast,
        removeToast,
        success,
        error,
        warning,
        info,
        notifyError,
    };
}
