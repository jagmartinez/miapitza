import { useSyncExternalStore } from 'react';
import type { OfflineQueue, QueueSnapshot } from './offlineQueue';

/** Connectivity as the WebView reports it (same signal the web client's offline policy uses). */
export function isOnline(): boolean {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function subscribeOnline(fn: () => void): () => void {
    window.addEventListener('online', fn);
    window.addEventListener('offline', fn);
    return () => {
        window.removeEventListener('online', fn);
        window.removeEventListener('offline', fn);
    };
}

export function useOnline(): boolean {
    return useSyncExternalStore(subscribeOnline, isOnline, () => true);
}

const EMPTY: QueueSnapshot = { pending: 0, failed: 0 };

export function usePendingSync(queue: OfflineQueue | null): QueueSnapshot {
    return useSyncExternalStore(
        (fn) => (queue ? queue.subscribe(fn) : () => undefined),
        () => (queue ? queue.getSnapshot() : EMPTY),
        () => EMPTY,
    );
}

/** Text for the status chip, or null when there is nothing to tell. */
export function offlineLabel(online: boolean, pending: number, failed = 0): string | null {
    if (!online) return pending > 0 ? `Sin conexión · ${pending} pendientes` : 'Sin conexión';
    if (failed > 0) return `${failed} sin sincronizar`;
    if (pending > 0) return `Sincronizando · ${pending} pendientes`;
    return null;
}
