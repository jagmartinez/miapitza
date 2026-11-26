import { describe, expect, it, vi } from 'vitest';
import {
    getOfflineCacheStatus,
    isCachedResponse,
    markLiveResponse,
    markServedFromCache,
    subscribeOfflineCacheStatus,
} from './cacheStatus';

describe('offline cache status', () => {
    it('flags cached fallbacks until the next live response and notifies subscribers', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeOfflineCacheStatus(listener);

        markServedFromCache('/tables?branchId=1');
        const first = getOfflineCacheStatus();
        expect(first.servingCache).toBe(true);
        expect(first.lastUrl).toBe('/tables?branchId=1');

        markServedFromCache('/orders/kitchen/queue');
        expect(getOfflineCacheStatus().since).toBe(first.since);

        markLiveResponse();
        expect(getOfflineCacheStatus().servingCache).toBe(false);
        expect(listener).toHaveBeenCalledTimes(3);

        // Live responses while already live do not spam subscribers.
        markLiveResponse();
        expect(listener).toHaveBeenCalledTimes(3);
        unsubscribe();
    });

    it('recognizes the _fromCache marker on responses', () => {
        expect(isCachedResponse({ data: {}, _fromCache: true })).toBe(true);
        expect(isCachedResponse({ data: {} })).toBe(false);
        expect(isCachedResponse(null)).toBe(false);
    });
});
