import { notifyError } from './notify';

/**
 * Last line of defence: promise rejections nobody handled and runtime errors
 * thrown outside React render (event handlers, timers) become a visible toast
 * instead of only a console line. Browser console output is kept as-is.
 */

const IGNORED_ERROR_MESSAGES = [
    /ResizeObserver loop/i,
    /^Script error\.?$/i, // opaque cross-origin errors (extensions, third-party scripts)
    /Non-Error promise rejection captured/i,
];

function isIgnoredMessage(message: string | undefined): boolean {
    return Boolean(message && IGNORED_ERROR_MESSAGES.some((pattern) => pattern.test(message)));
}

function isForeignScript(filename: string | undefined): boolean {
    if (!filename || typeof window === 'undefined') return false;
    try {
        return new URL(filename, window.location.href).origin !== window.location.origin;
    } catch {
        return false;
    }
}

export function handleUnhandledRejection(event: PromiseRejectionEvent | { reason: unknown }): void {
    const reason = event.reason;
    const message = typeof reason === 'object' && reason !== null && 'message' in reason
        ? String((reason as { message?: unknown }).message)
        : typeof reason === 'string' ? reason : undefined;
    if (isIgnoredMessage(message)) return;
    notifyError(reason);
}

export function handleWindowError(event: ErrorEvent | { message?: string; filename?: string; error?: unknown }): void {
    if (isIgnoredMessage(event.message) || isForeignScript(event.filename)) return;
    notifyError(event.error ?? event.message);
}

let installed = false;

export function installGlobalErrorHandlers(target: Window = window): () => void {
    if (installed) return () => undefined;
    installed = true;
    const onRejection = (event: PromiseRejectionEvent) => handleUnhandledRejection(event);
    const onError = (event: ErrorEvent) => handleWindowError(event);
    target.addEventListener('unhandledrejection', onRejection);
    target.addEventListener('error', onError);
    return () => {
        installed = false;
        target.removeEventListener('unhandledrejection', onRejection);
        target.removeEventListener('error', onError);
    };
}
