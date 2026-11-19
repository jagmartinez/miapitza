/**
 * App-wide notification bus.
 *
 * Code outside React (axios interceptors, offline sync, websocket, global
 * `window` handlers) and pages that do not hold a toast context publish here;
 * the ToastProvider renders whatever arrives. Notices published before the
 * provider mounts are buffered and flushed on subscribe.
 */
import type { ToastType } from '../components/Toast';
import { describeApiError, isCanceledError, type DescribedError } from '../utils/apiError';

export interface AppNotice {
    message: string;
    type: ToastType;
    /** Milliseconds; omitted → derived from type and message length. */
    duration?: number;
    /** Notices with the same key replace each other instead of stacking. */
    dedupeKey?: string;
}

type NoticeListener = (notice: AppNotice) => void;

const listeners = new Set<NoticeListener>();
const pending: AppNotice[] = [];
const MAX_PENDING = 20;

export function publishNotice(notice: AppNotice): void {
    if (listeners.size === 0) {
        pending.push(notice);
        if (pending.length > MAX_PENDING) pending.shift();
        return;
    }
    listeners.forEach((listener) => {
        try {
            listener(notice);
        } catch {
            // A broken renderer must not break the publisher.
        }
    });
}

export function subscribeNotices(listener: NoticeListener): () => void {
    listeners.add(listener);
    if (pending.length > 0) {
        const queued = pending.splice(0, pending.length);
        queued.forEach((notice) => listener(notice));
    }
    return () => {
        listeners.delete(listener);
    };
}

/** Errors already shown to the user (by notifyError or explicitly marked). */
const handledErrors = new WeakSet<object>();

/** Mark an error as already surfaced so global handlers will not toast it again. */
export function markErrorHandled(error: unknown): void {
    if (typeof error === 'object' && error !== null) handledErrors.add(error);
}

export function isErrorHandled(error: unknown): boolean {
    return typeof error === 'object' && error !== null && handledErrors.has(error);
}

export interface NotifyErrorOptions {
    /** Show as warning instead of error (e.g. optional data that failed to load). */
    type?: Extract<ToastType, 'error' | 'warning'>;
    duration?: number;
    /** Also toast 401s (silenced by default: the interceptor already redirects to login). */
    includeAuth?: boolean;
}

/**
 * Show a Spanish, actionable toast for any thrown value and return the text so
 * pages can also keep it inline. Canceled requests are ignored, and the same
 * error object is never toasted twice.
 *
 * `context` is a lead such as "No se pudo guardar el producto".
 */
export function notifyError(error: unknown, context?: string, options: NotifyErrorOptions = {}): DescribedError {
    const described = describeApiError(error, context);
    const silent = isCanceledError(error)
        || isErrorHandled(error)
        // The 401 interceptor already tears the session down and redirects;
        // the login form reports its own credential errors.
        || (described.kind === 'auth' && !options.includeAuth);
    markErrorHandled(error);
    if (!silent) {
        const type = options.type ?? 'error';
        publishNotice({
            message: described.message,
            type,
            duration: options.duration,
            // Same key shape as ToastProvider uses for showToast(), so a page
            // toast and a global toast with identical text collapse into one.
            dedupeKey: `${type}:${described.message}`,
        });
    }
    if (import.meta.env?.DEV && !silent) {
        console.error(`[notifyError] ${context ?? ''}`, error);
    }
    return described;
}

export const notifySuccess = (message: string) => publishNotice({ message, type: 'success' });
export const notifyInfo = (message: string, dedupeKey?: string) => publishNotice({ message, type: 'info', dedupeKey });
export const notifyWarning = (message: string, dedupeKey?: string) => publishNotice({ message, type: 'warning', dedupeKey });

/** Test helper. */
export function __resetNoticesForTests(): void {
    listeners.clear();
    pending.splice(0, pending.length);
}
