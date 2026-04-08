import { db, SyncItem } from './db';
import axios from 'axios';

class OfflineManager {
    private isOnline: boolean = navigator.onLine;
    private listeners: ((online: boolean) => void)[] = [];

    constructor() {
        window.addEventListener('online', () => this.handleStatusChange(true));
        window.addEventListener('offline', () => this.handleStatusChange(false));
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

    public async enqueueRequest(item: Omit<SyncItem, 'id' | 'timestamp' | 'status' | 'retryCount' | 'lastError'>) {
        await db.syncQueue.add({
            ...item,
            timestamp: Date.now(),
            status: item.dependencyKey ? 'blocked' : 'pending',
            retryCount: 0,
            lastError: null
        });
    }

    public async processSyncQueue() {
        const items = await db.syncQueue.orderBy('timestamp').toArray();
        if (items.length === 0) return;


        const api = axios.create({
            baseURL: '/api',
            withCredentials: true,
            headers: {
                'Content-Type': 'application/json',
                'X-Idempotency-Key': '' // Will be set per-request
            }
        });

        const MAX_RETRIES = 5;

        for (const item of items) {
            const dependencyPending = item.dependencyKey
                ? await db.syncQueue
                    .where('entityTempId')
                    .equals(item.dependencyKey)
                    .filter(candidate => candidate.id !== item.id)
                    .count()
                : 0;

            if (item.dependencyKey && dependencyPending > 0) {
                if (item.status !== 'blocked') {
                    await db.syncQueue.update(item.id!, { status: 'blocked' });
                }
                continue;
            }

            if (item.status === 'blocked') {
                await db.syncQueue.update(item.id!, { status: 'pending' });
            }

            try {
                await db.syncQueue.update(item.id!, {
                    status: 'processing',
                    lastError: null
                });

                await api.request({
                    url: item.url,
                    method: item.method,
                    data: item.data
                });
                await db.syncQueue.delete(item.id!);
            } catch (error: unknown) {
                const retryCount = item.retryCount + 1;
                const axiosErr = error as { response?: { data?: { message?: string } }; message?: string };
                const lastError = axiosErr?.response?.data?.message || axiosErr?.message || 'Unknown sync error';

                if (retryCount >= MAX_RETRIES) {
                    await db.syncQueue.update(item.id!, {
                        retryCount,
                        status: 'failed',
                        lastError
                    });
                } else {
                    await db.syncQueue.update(item.id!, {
                        retryCount,
                        status: 'pending',
                        lastError
                    });
                    break;
                }
            }
        }
    }
}

export const offlineManager = new OfflineManager();
