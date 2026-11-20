import type { Services } from '../core/services';
import { createCache, MobileDB } from './cache';
import { createDrafts } from './drafts';
import { createOfflineQueue } from './offlineQueue';
import { isOnline } from './useOnline';
import { createWaiterApi } from './waiterApi';

/** Wires the waiter data layer onto the Phase 1 services. One instance per app run. */
export function createWaiterData(services: Pick<Services, 'http' | 'sessions'>) {
    const db = new MobileDB();
    const cache = createCache(db);
    void cache.purgeExpired(); // eviction sweep on start (rows older than 24 h)
    const queue = createOfflineQueue({ db, http: services.http, sessions: services.sessions, isOnline });
    const api = createWaiterApi({ http: services.http, sessions: services.sessions, cache, queue, isOnline });
    return { db, cache, queue, api, drafts: createDrafts(db) };
}

export type WaiterData = ReturnType<typeof createWaiterData>;
