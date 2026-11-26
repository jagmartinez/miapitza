/**
 * Tracks whether the UI is currently rendering GET data served from the offline
 * cache (network failure fallback in api.ts) instead of a live server response.
 * Kept free of React so the axios interceptors can drive it directly.
 */
export interface OfflineCacheStatus {
    servingCache: boolean;
    /** Epoch ms of the first cached fallback in the current offline episode. */
    since: number | null;
    /** Last request path answered from cache (diagnostics only). */
    lastUrl: string | null;
}

type Listener = (status: OfflineCacheStatus) => void;

const LIVE_STATUS: OfflineCacheStatus = { servingCache: false, since: null, lastUrl: null };

let status: OfflineCacheStatus = LIVE_STATUS;
const listeners = new Set<Listener>();

const emit = () => {
    listeners.forEach((listener) => {
        try {
            listener(status);
        } catch (error) {
            console.error('[cacheStatus] listener failed:', error);
        }
    });
};

export function markServedFromCache(url: string): void {
    status = {
        servingCache: true,
        since: status.servingCache ? status.since : Date.now(),
        lastUrl: url,
    };
    emit();
}

/** Any successful server round-trip proves connectivity; the stale notice can clear. */
export function markLiveResponse(): void {
    if (!status.servingCache) return;
    status = LIVE_STATUS;
    emit();
}

export function getOfflineCacheStatus(): OfflineCacheStatus {
    return status;
}

export function subscribeOfflineCacheStatus(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Typed check for the `_fromCache` marker the api.ts fallback attaches to responses. */
export function isCachedResponse(response: unknown): boolean {
    return Boolean(
        response
        && typeof response === 'object'
        && (response as { _fromCache?: unknown })._fromCache === true,
    );
}
