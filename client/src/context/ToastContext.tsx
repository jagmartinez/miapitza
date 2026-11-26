import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastContainer, type ToastItemData } from '../components/Toast';
import type { ToastType } from '../components/Toast';
import { useOfflineCacheStatus } from '../hooks/useOfflineCacheStatus';
import { markErrorHandled, notifyError, subscribeNotices, type AppNotice, type NotifyErrorOptions } from '../services/notify';
import { offlineManager } from '../services/offlineManager';
import type { DescribedError } from '../utils/apiError';
import { addOrBumpToast } from './toastQueue';

export const OFFLINE_CACHE_NOTICE = 'Sin conexión — mostrando datos guardados';
export const OFFLINE_NOTICE = 'Sin conexión a internet. Los datos pueden no estar actualizados y algunas acciones no se podrán guardar hasta que vuelva la red.';
export const ONLINE_NOTICE = 'Conexión restablecida.';

/**
 * App-shell notice for stale data: api.ts answers failed GETs from the offline
 * cache, so without this the operator would read cached tables/KDS/cash data as live.
 * Fixed and pointer-transparent so it never blocks the screen underneath.
 */
function OfflineCacheNotice() {
    const { servingCache } = useOfflineCacheStatus();
    if (!servingCache) return null;
    return (
        <div
            role="status"
            aria-live="polite"
            data-testid="offline-cache-notice"
            className="offline-cache-notice"
            style={{
                position: 'fixed',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 9998,
                pointerEvents: 'none',
                background: 'var(--ui-surface)',
                borderRadius: 9999,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            }}
        >
            <span className="status-pill status-warning" style={{ fontSize: 12, padding: '6px 14px' }}>
                {OFFLINE_CACHE_NOTICE}
            </span>
        </div>
    );
}

type ToastContextValue = {
    /**
     * `cause`: the error this toast reports. It is marked as handled so a
     * show-then-rethrow does not get toasted again by notifyError or the
     * global unhandled-rejection handler.
     */
    showToast: (message: string, type?: ToastType, duration?: number, cause?: unknown) => void;
    success: (message: string) => void;
    error: (message: string, cause?: unknown) => void;
    warning: (message: string) => void;
    info: (message: string) => void;
    /** Normalize any thrown value into a Spanish message, toast it and return it. */
    notifyError: (error: unknown, context?: string, options?: NotifyErrorOptions) => DescribedError;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastItemData[]>([]);
    const lastOnline = useRef(offlineManager.getStatus());

    const push = useCallback((notice: AppNotice) => {
        if (!notice.message) return;
        setToasts((prev) => addOrBumpToast(prev, notice));
    }, []);

    const showToast = useCallback((message: string, type: ToastType = 'info', duration?: number, cause?: unknown) => {
        if (cause !== undefined) markErrorHandled(cause);
        push({ message, type, duration });
    }, [push]);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // Notices from outside React: api errors, offline sync, websocket, window handlers.
    useEffect(() => subscribeNotices(push), [push]);

    // Connectivity changes are announced once per transition.
    useEffect(() => offlineManager.onStatusChange((online) => {
        if (online === lastOnline.current) return;
        lastOnline.current = online;
        push(online
            ? { message: ONLINE_NOTICE, type: 'success', dedupeKey: 'connectivity' }
            : { message: OFFLINE_NOTICE, type: 'warning', dedupeKey: 'connectivity', duration: 10000 });
    }), [push]);

    const success = useCallback((message: string) => showToast(message, 'success'), [showToast]);
    const error = useCallback((message: string, cause?: unknown) => showToast(message, 'error', undefined, cause), [showToast]);
    const warning = useCallback((message: string) => showToast(message, 'warning'), [showToast]);
    const info = useCallback((message: string) => showToast(message, 'info'), [showToast]);

    const value = useMemo(
        () => ({ showToast, success, error, warning, info, notifyError }),
        [showToast, success, error, warning, info],
    );

    return (
        <ToastContext.Provider value={value}>
            {children}
            <OfflineCacheNotice />
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </ToastContext.Provider>
    );
}

export function useAppToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) {
        throw new Error('useAppToast must be used within ToastProvider');
    }
    return ctx;
}
