import { db, SyncItem } from './db';
import axios from 'axios';

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

class OfflineManager {
    private isOnline: boolean = navigator.onLine;
    private listeners: ((online: boolean) => void)[] = [];

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

    public async enqueueRequest(item: Omit<SyncItem, 'id' | 'timestamp' | 'status' | 'retryCount' | 'lastError' | 'idempotencyKey'>) {
        await db.syncQueue.add({
            ...item,
            timestamp: Date.now(),
            status: item.dependencyKey ? 'blocked' : 'pending',
            retryCount: 0,
            lastError: null,
            idempotencyKey: generateIdempotencyKey(),
        });
    }

    public async isCacheValid(url: string): Promise<boolean> {
        const entry = await db.caches.get(url);
        if (!entry) return false;
        const ttl = getTTL(url);
        return (Date.now() - entry.timestamp) < ttl;
    }

    public async getCachedData(url: string): Promise<unknown | null> {
        const valid = await this.isCacheValid(url);
        if (!valid) return null;
        const entry = await db.caches.get(url);
        return entry?.data ?? null;
    }

    public async purgeExpiredCache(): Promise<number> {
        const all = await db.caches.toArray();
        let purged = 0;
        for (const entry of all) {
            const ttl = getTTL(entry.id);
            if ((Date.now() - entry.timestamp) >= ttl) {
                await db.caches.delete(entry.id);
                purged++;
            }
        }
        return purged;
    }

    public async getPendingCount(): Promise<number> {
        return db.syncQueue.where('status').anyOf('pending', 'blocked', 'processing').count();
    }

    public async getFailedItems(): Promise<SyncItem[]> {
        return db.syncQueue.where('status').equals('failed').toArray();
    }

    public async retryFailed(): Promise<void> {
        await db.syncQueue.where('status').equals('failed').modify({
            status: 'pending',
            retryCount: 0,
            lastError: null,
        });
        await this.processSyncQueue();
    }

    public async clearFailed(): Promise<void> {
        await db.syncQueue.where('status').equals('failed').delete();
    }

    public async processSyncQueue() {
        if (!this.isOnline) return;

        const items = await db.syncQueue
            .where('status')
            .anyOf('pending', 'blocked')
            .sortBy('timestamp');

        if (items.length === 0) return;

        const token = localStorage.getItem('token');
        const api = axios.create({
            baseURL: '/api',
            withCredentials: true,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            }
        });

        const MAX_RETRIES = 5;
        const processedIds = new Set<number>();

        for (const item of items) {
            if (processedIds.has(item.id!)) continue;

            // Check dependency resolution
            if (item.dependencyKey) {
                const dependencyPending = await db.syncQueue
                    .where('entityTempId')
                    .equals(item.dependencyKey)
                    .filter(candidate => candidate.id !== item.id && candidate.status !== 'failed')
                    .count();

                if (dependencyPending > 0) {
                    if (item.status !== 'blocked') {
                        await db.syncQueue.update(item.id!, { status: 'blocked' });
                    }
                    continue;
                }
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
                    await db.syncQueue.update(item.id!, {
                        retryCount,
                        status: 'failed',
                        lastError: isClientError ? `[${httpStatus}] ${lastError}` : lastError,
                    });
                    // Continue processing other items instead of stopping
                    continue;
                }

                await db.syncQueue.update(item.id!, {
                    retryCount,
                    status: 'pending',
                    lastError,
                });

                // Exponential backoff: wait before next retry
                const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
}

export const offlineManager = new OfflineManager();
