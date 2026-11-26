import { useSyncExternalStore } from 'react';
import {
    getOfflineCacheStatus,
    subscribeOfflineCacheStatus,
    type OfflineCacheStatus,
} from '../services/cacheStatus';

/** True while screens are rendering GET data from the offline cache fallback. */
export function useOfflineCacheStatus(): OfflineCacheStatus {
    return useSyncExternalStore(subscribeOfflineCacheStatus, getOfflineCacheStatus, getOfflineCacheStatus);
}
