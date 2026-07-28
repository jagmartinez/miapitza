import { db, SyncItem } from './db';
import axios from 'axios';
import { normalizeApiBaseUrl } from './api';

const CACHE_TTL: Record<string, number> = {
    '/products': 5 * 60 * 1000,
    '/menu-items': 5 * 60 * 1000,
    '/categories': 10 * 60 * 1000,
    '/warehouses': 10 * 60 * 1000,
    '/branches': 10 * 60 * 1000,
    '/suppliers': 10 * 60 * 1000,
    '/reports/': 2 * 60 * 1000,
    '/orders': 60 * 1000,
    '/inventory-movements': 60 * 1000,
    DEFAULT: 3 * 60 * 1000,
};

function getTTL(url: string): number {
    for (const [pattern, ttl] of Object.entries(CACHE_TTL)) {
        if (pattern !== 'DEFAULT' && url.includes(pattern)) return ttl;
    }
    return CACHE_TTL.DEFAULT;
}

function generateIdempotencyKey(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function getCurrentOfflineOwnerKey(): string | null {
    try {
        const user = JSON.parse(localStorage.getItem('user') || 'null') as { id?: number; companyId?: number } | null;
        return user?.id && user?.companyId ? `${user.companyId}:${user.id}` : null;
    } catch {
        return null;
    }
}

class OfflineManager {
    private isOnline: boolean = navigator.onLine;
    private listeners: ((online: boolean) => void)[] = [];
    private syncInFlight: Promise<void> | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private retryScheduledAt: number | null = null;

    constructor() {
        window.addEventListener('online', () => this.handleStatusChange(true));
        window.addEventListener('offline', () => this.handleStatusChange(false));

        if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data?.type === 'SYNC_REQUESTED') {
                    this.processSyncQueue();
                }
            });
        }
    }

    private handleStatusChange(status: boolean) {
        this.isOnline = status;
        this.listeners.forEach(l => l(status));
        if (status) {
            this.processSyncQueue();
        }
    }

    public onStatusChange(callback: (online: boolean) => void) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    public getStatus() {
        return this.isOnline;
    }

    public async enqueueRequest(item: Omit<SyncItem, 'id' | 'timestamp' | 'status' | 'retryCount' | 'lastError' | 'idempotencyKey' | 'ownerKey'>) {
        const ownerKey = getCurrentOfflineOwnerKey();
        if (!ownerKey) throw new Error('No authenticated offline owner');
        await db.syncQueue.add({
            ...item,
            ownerKey,
            timestamp: Date.now(),
            status: item.dependencyKey ? 'blocked' : 'pending',
            retryCount: 0,
            lastError: null,
            idempotencyKey: generateIdempotencyKey(),
            nextAttemptAt: null,
        });
    }

    public async isCacheValid(url: string): Promise<boolean> {
        const ownerKey = getCurrentOfflineOwnerKey();
        if (!ownerKey) return false;
        const entry = await db.caches.get(`${ownerKey}|${url}`);
        if (!entry) return false;
        const ttl = getTTL(url);
        return (Date.now() - entry.timestamp) < ttl;
    }

    public async getCachedData(url: string): Promise<unknown | null> {
        const valid = await this.isCacheValid(url);
        if (!valid) return null;
        const ownerKey = getCurrentOfflineOwnerKey();
        if (!ownerKey) return null;
        const entry = await db.caches.get(`${ownerKey}|${url}`);
        return entry?.data ?? null;
    }

    public async putCachedData(url: string, data: unknown): Promise<void> {
        const ownerKey = getCurrentOfflineOwnerKey();
        if (!ownerKey) return;
        await db.caches.put({ id: `${ownerKey}|${url}`, url, ownerKey, data, timestamp: Date.now() });
    }

    public async purgeExpiredCache(): Promise<number> {
        const all = await db.caches.toArray();
        let purged = 0;
        for (const entry of all) {
            const ttl = getTTL(entry.url || entry.id);
            if ((Date.now() - entry.timestamp) >= ttl) {
                await db.caches.delete(entry.id);
                purged++;
            }
        }
        return purged;
    }

    public async getPendingCount(): Promise<number> {
        const ownerKey = getCurrentOfflineOwnerKey();
        if (!ownerKey) return 0;
        return db.syncQueue.where('ownerKey').equals(ownerKey)
            .filter((item) => ['pending', 'blocked', 'processing'].includes(item.status)).count();
    }

    public async getFailedItems(): Promise<SyncItem[]> {
        const ownerKey = getCurrentOfflineOwnerKey();
        if (!ownerKey) return [];
        return db.syncQueue.where('ownerKey').equals(ownerKey).filter((item) => item.status === 'failed').toArray();
    }

    public async retryFailed(): Promise<void> {
        const ownerKey = getCurrentOfflineOwnerKey();
        if (!ownerKey) return;
        await db.syncQueue.where('ownerKey').equals(ownerKey).filter((item) => item.status === 'failed').modify({
            status: 'pending',
            retryCount: 0,
            lastError: null,
            nextAttemptAt: null,
        });
        await this.processSyncQueue();
    }

    public async clearFailed(): Promise<void> {
        const ownerKey = getCurrentOfflineOwnerKey();
        if (!ownerKey) return;
        await db.syncQueue.where('ownerKey').equals(ownerKey).filter((item) => item.status === 'failed').delete();
    }

    public async clearSessionData(): Promise<void> {
        // Session switching preserves owner-partitioned data. Legacy unowned rows
        // remain fail-closed and can only be removed explicitly.
    }

    public async purgeOwnerData(ownerKey: string): Promise<void> {
        await db.transaction('rw', db.caches, db.syncQueue, async () => {
            await db.caches.where('ownerKey').equals(ownerKey).delete();
            await db.syncQueue.where('ownerKey').equals(ownerKey).delete();
        });
    }

    public processSyncQueue(): Promise<void> {
        if (this.syncInFlight) return this.syncInFlight;
        const run = this.runSyncQueue();
        this.syncInFlight = run;
        void run.finally(() => {
            if (this.syncInFlight === run) this.syncInFlight = null;
        });
        return run;
    }

    private scheduleRetry(ownerKey: string, nextAttemptAt: number) {
        if (!this.isOnline) return;
        if (this.retryTimer && this.retryScheduledAt !== null && this.retryScheduledAt <= nextAttemptAt) {
            return;
        }
        if (this.retryTimer) clearTimeout(this.retryTimer);

        this.retryScheduledAt = nextAttemptAt;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.retryScheduledAt = null;
            if (getCurrentOfflineOwnerKey() === ownerKey && this.isOnline) {
                void this.processSyncQueue();
            }
        }, Math.max(0, nextAttemptAt - Date.now()));
    }

    private async failDependents(
        ownerKey: string,
        dependencyKey: string,
        cause: string,
        visited = new Set<string>(),
    ): Promise<void> {
        if (visited.has(dependencyKey)) return;
        visited.add(dependencyKey);
        const dependents = await db.syncQueue
            .where('ownerKey').equals(ownerKey)
            .filter((candidate) => candidate.dependencyKey === dependencyKey && candidate.status !== 'failed')
            .toArray();

        for (const dependent of dependents) {
            await db.syncQueue.update(dependent.id!, {
                status: 'failed',
                nextAttemptAt: null,
                lastError: `Dependencia fallida (${dependencyKey}): ${cause}`,
            });
            if (dependent.entityTempId) {
                await this.failDependents(ownerKey, dependent.entityTempId, cause, visited);
            }
        }
    }

    private async runSyncQueue() {
        if (!this.isOnline) return;

        const ownerKey = getCurrentOfflineOwnerKey();
        if (!ownerKey) return;

        const items = await db.syncQueue
            .where('ownerKey').equals(ownerKey)
            .filter((item) => item.status === 'pending' || item.status === 'blocked')
            .sortBy('timestamp');

        if (items.length === 0) return;

        const token = localStorage.getItem('token');
        const csrfToken = (() => {
            try {
                return sessionStorage.getItem('csrf_token');
            } catch {
                return null;
            }
        })();
        const api = axios.create({
            baseURL: normalizeApiBaseUrl(),
            withCredentials: true,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
            }
        });

        const MAX_RETRIES = 5;
        const processedIds = new Set<number>();

        for (const item of items) {
            // A logout/login can happen while an earlier request is in flight.
            // Never continue the captured owner's batch under a different
            // browser session; leave the remaining entries pending for that
            // owner to resume on their next authenticated session.
            if (
                getCurrentOfflineOwnerKey() !== ownerKey
                || localStorage.getItem('token') !== token
            ) return;
            if (processedIds.has(item.id!)) continue;

            // Check dependency resolution
            if (item.dependencyKey) {
                const dependencies = await db.syncQueue
                    .where('ownerKey').equals(ownerKey)
                    .filter(candidate => candidate.entityTempId === item.dependencyKey && candidate.id !== item.id)
                    .toArray();

                const failedDependency = dependencies.find((candidate) => candidate.status === 'failed');
                if (failedDependency) {
                    const cause = failedDependency.lastError || 'La operación previa no pudo sincronizarse';
                    await db.syncQueue.update(item.id!, {
                        status: 'failed',
                        nextAttemptAt: null,
                        lastError: `Dependencia fallida (${item.dependencyKey}): ${cause}`,
                    });
                    if (item.entityTempId) {
                        await this.failDependents(ownerKey, item.entityTempId, cause);
                    }
                    continue;
                }

                if (dependencies.length > 0) {
                    if (item.status !== 'blocked') {
                        await db.syncQueue.update(item.id!, { status: 'blocked' });
                    }
                    continue;
                }
            }

            if (item.nextAttemptAt && item.nextAttemptAt > Date.now()) {
                this.scheduleRetry(ownerKey, item.nextAttemptAt);
                continue;
            }

            if (item.status === 'blocked') {
                await db.syncQueue.update(item.id!, { status: 'pending' });
            }

            try {
                await db.syncQueue.update(item.id!, { status: 'processing', lastError: null });

                await api.request({
                    url: item.url,
                    method: item.method,
                    data: item.data,
                    headers: {
                        'X-Idempotency-Key': item.idempotencyKey || generateIdempotencyKey(),
                    }
                });

                await db.syncQueue.delete(item.id!);
                processedIds.add(item.id!);
            } catch (error: unknown) {
                const retryCount = item.retryCount + 1;
                const axiosErr = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
                const lastError = axiosErr?.response?.data?.message || axiosErr?.message || 'Unknown sync error';
                const httpStatus = axiosErr?.response?.status;

                // Don't retry client errors (4xx) except 408, 429
                const isClientError = httpStatus && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429;

                if (retryCount >= MAX_RETRIES || isClientError) {
                    const terminalError = isClientError ? `[${httpStatus}] ${lastError}` : lastError;
                    await db.syncQueue.update(item.id!, {
                        retryCount,
                        status: 'failed',
                        lastError: terminalError,
                        nextAttemptAt: null,
                    });
                    if (item.entityTempId) {
                        await this.failDependents(ownerKey, item.entityTempId, terminalError);
                    }
                    // Continue processing other items instead of stopping
                    continue;
                }

                const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
                const nextAttemptAt = Date.now() + delay;
                await db.syncQueue.update(item.id!, {
                    retryCount,
                    status: 'pending',
                    lastError,
                    nextAttemptAt,
                });

                this.scheduleRetry(ownerKey, nextAttemptAt);
            }
        }
    }
}

export const offlineManager = new OfflineManager();
