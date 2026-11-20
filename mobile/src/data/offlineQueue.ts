import type { AxiosInstance } from 'axios';
import { newIdempotencyKey } from '@web/utils/idempotency';
import type { SessionStore } from '../core/session';
import type { MobileDB } from './cache';
import { isPermanentSyncFailure, ownerKeyOf, type SyncItem } from './types';

export const MAX_RETRIES = 5;
export const backoffMs = (retryCount: number) => Math.min(1000 * Math.pow(2, retryCount), 30_000);

export type EnqueueInput = Pick<SyncItem, 'url' | 'method' | 'data' | 'operationType'> &
    Partial<Pick<SyncItem, 'dependencyKey' | 'entityTempId' | 'idempotencyKey'>>;

export interface QueueDeps {
    db: MobileDB;
    /** The mobile http instance: it carries the current session's token. */
    http: AxiosInstance;
    sessions: SessionStore;
    isOnline: () => boolean;
    now?: () => number;
}

export interface QueueSnapshot {
    pending: number;
    failed: number;
}

export function createOfflineQueue(deps: QueueDeps) {
    const { db, http, sessions, isOnline } = deps;
    const now = deps.now ?? Date.now;

    let lastTs = 0;
    const nextTimestamp = () => (lastTs = Math.max(now(), lastTs + 1));

    let snapshot: QueueSnapshot = { pending: 0, failed: 0 };
    const listeners = new Set<() => void>();
    let running: Promise<void> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let detach: (() => void) | null = null;

    const currentOwner = async () => ownerKeyOf(await sessions.load());

    async function refreshCounts(): Promise<void> {
        const owner = await currentOwner();
        let next: QueueSnapshot = { pending: 0, failed: 0 };
        if (owner) {
            const rows = await db.syncQueue.where('ownerKey').equals(owner).toArray();
            next = {
                pending: rows.filter((r) => r.status !== 'failed').length,
                failed: rows.filter((r) => r.status === 'failed').length,
            };
        }
        if (next.pending !== snapshot.pending || next.failed !== snapshot.failed) {
            snapshot = next;
            for (const fn of [...listeners]) fn();
        }
    }

    async function failDependents(ownerKey: string, dependencyKey: string, cause: string, visited = new Set<string>()): Promise<void> {
        if (visited.has(dependencyKey)) return;
        visited.add(dependencyKey);
        const dependents = await db.syncQueue
            .where('ownerKey')
            .equals(ownerKey)
            .filter((c) => c.dependencyKey === dependencyKey && c.status !== 'failed')
            .toArray();
        for (const dep of dependents) {
            await db.syncQueue.update(dep.id!, {
                status: 'failed',
                nextAttemptAt: null,
                lastError: `Dependencia fallida (${dependencyKey}): ${cause}`,
            });
            if (dep.entityTempId) await failDependents(ownerKey, dep.entityTempId, cause, visited);
        }
    }

    async function schedule(ownerKey: string): Promise<void> {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        if (!isOnline()) return;
        const rows = await db.syncQueue
            .where('ownerKey')
            .equals(ownerKey)
            .filter((r) => r.status === 'pending' && !!r.nextAttemptAt)
            .toArray();
        if (rows.length === 0) return;
        const at = Math.min(...rows.map((r) => r.nextAttemptAt!));
        timer = setTimeout(() => {
            timer = null;
            void process();
        }, Math.max(0, at - now()));
    }

    async function runItems(): Promise<void> {
        if (!isOnline()) return;
        const ownerKey = await currentOwner();
        if (!ownerKey) return;

        // A previous run killed mid-request left items 'processing'; their key makes the resend safe.
        await db.syncQueue.where('ownerKey').equals(ownerKey).filter((r) => r.status === 'processing').modify({ status: 'pending' });

        const items = (await db.syncQueue.where('ownerKey').equals(ownerKey).filter((r) => r.status === 'pending' || r.status === 'blocked').toArray()).sort(
            (a, b) => a.timestamp - b.timestamp || a.id! - b.id!,
        );

        for (const item of items) {
            // PIN switch / sign-out mid-run: never continue one owner's batch under another session.
            if ((await currentOwner()) !== ownerKey) return;

            if (item.dependencyKey) {
                const deps = await db.syncQueue
                    .where('ownerKey')
                    .equals(ownerKey)
                    .filter((c) => c.entityTempId === item.dependencyKey && c.id !== item.id)
                    .toArray();
                const failedDep = deps.find((c) => c.status === 'failed');
                if (failedDep) {
                    const cause = failedDep.lastError || 'La operación previa no pudo sincronizarse';
                    await db.syncQueue.update(item.id!, { status: 'failed', nextAttemptAt: null, lastError: `Dependencia fallida (${item.dependencyKey}): ${cause}` });
                    if (item.entityTempId) await failDependents(ownerKey, item.entityTempId, cause);
                    continue;
                }
                if (deps.length > 0) {
                    if (item.status !== 'blocked') await db.syncQueue.update(item.id!, { status: 'blocked' });
                    continue;
                }
            }

            if (item.nextAttemptAt && item.nextAttemptAt > now()) continue;

            try {
                await db.syncQueue.update(item.id!, { status: 'processing', lastError: null });
                await http.request({
                    url: item.url,
                    method: item.method,
                    data: item.data,
                    headers: { 'X-Idempotency-Key': item.idempotencyKey || newIdempotencyKey() },
                });
                await db.syncQueue.delete(item.id!);
            } catch (error: unknown) {
                const err = error as { response?: { status?: number; data?: { message?: string; code?: unknown } }; message?: string };
                const status = err?.response?.status;
                if (status === 401) {
                    // Session ended (the http layer already emitted session-expired). Not the item's fault:
                    // keep it untouched and let the owner's next session resume it.
                    await db.syncQueue.update(item.id!, { status: 'pending' });
                    return;
                }
                const retryCount = item.retryCount + 1;
                const lastError = err?.response?.data?.message || err?.message || 'Unknown sync error';
                const permanent = isPermanentSyncFailure(status, err?.response?.data?.code);
                if (retryCount >= MAX_RETRIES || permanent) {
                    const terminal = permanent ? `[${status}] ${lastError}` : lastError;
                    await db.syncQueue.update(item.id!, { retryCount, status: 'failed', lastError: terminal, nextAttemptAt: null });
                    if (item.entityTempId) await failDependents(ownerKey, item.entityTempId, terminal);
                } else {
                    await db.syncQueue.update(item.id!, { retryCount, status: 'pending', lastError, nextAttemptAt: now() + backoffMs(retryCount) });
                }
            }
        }
    }

    function process(): Promise<void> {
        if (running) return running;
        const run = (async () => {
            try {
                await runItems();
            } finally {
                await refreshCounts();
                const owner = await currentOwner();
                if (owner) await schedule(owner);
            }
        })();
        running = run;
        void run.then(
            () => {
                if (running === run) running = null;
            },
            () => {
                if (running === run) running = null;
            },
        );
        return run;
    }

    return {
        async enqueue(input: EnqueueInput): Promise<SyncItem> {
            const ownerKey = await currentOwner();
            if (!ownerKey) throw new Error('No hay sesión para encolar la operación');
            const item: SyncItem = {
                url: input.url,
                method: input.method,
                data: input.data,
                operationType: input.operationType,
                dependencyKey: input.dependencyKey ?? null,
                entityTempId: input.entityTempId ?? null,
                idempotencyKey: input.idempotencyKey || newIdempotencyKey(),
                timestamp: nextTimestamp(),
                status: 'pending',
                retryCount: 0,
                lastError: null,
                nextAttemptAt: null,
                ownerKey,
            };
            item.id = await db.syncQueue.add(item);
            await refreshCounts();
            return item;
        },

        process,

        /** Replays the current owner's pending items (call after login / PIN switch). */
        notifySessionChanged(): void {
            void refreshCounts();
            void process();
        },

        /** Counts of the current owner's items still to sync (excludes failed). */
        async pendingCount(): Promise<number> {
            const owner = await currentOwner();
            if (!owner) return 0;
            return db.syncQueue.where('ownerKey').equals(owner).filter((r) => r.status !== 'failed').count();
        },

        async listFailed(): Promise<SyncItem[]> {
            const owner = await currentOwner();
            if (!owner) return [];
            return db.syncQueue.where('ownerKey').equals(owner).filter((r) => r.status === 'failed').toArray();
        },

        /** Manual retry of a failed item and the dependents that failed because of it; keeps idempotency keys. */
        async retry(id: number): Promise<void> {
            const owner = await currentOwner();
            const row = await db.syncQueue.get(id);
            if (!owner || !row || row.ownerKey !== owner || row.status !== 'failed') return;
            const reset = { status: 'pending' as const, retryCount: 0, nextAttemptAt: null, lastError: null };
            await db.syncQueue.update(id, reset);
            if (row.entityTempId) {
                const seen = new Set<string>();
                const walk = async (key: string): Promise<void> => {
                    if (seen.has(key)) return;
                    seen.add(key);
                    const deps = await db.syncQueue.where('ownerKey').equals(owner).filter((c) => c.dependencyKey === key && c.status === 'failed').toArray();
                    for (const d of deps) {
                        await db.syncQueue.update(d.id!, reset);
                        if (d.entityTempId) await walk(d.entityTempId);
                    }
                };
                await walk(row.entityTempId);
            }
            await refreshCounts();
            void process();
        },

        async discard(id: number): Promise<void> {
            const owner = await currentOwner();
            const row = await db.syncQueue.get(id);
            if (!owner || !row || row.ownerKey !== owner) return;
            await db.syncQueue.delete(id);
            await refreshCounts();
        },

        /** useSyncExternalStore contract. */
        subscribe(fn: () => void): () => void {
            listeners.add(fn);
            return () => {
                listeners.delete(fn);
            };
        },
        getSnapshot: (): QueueSnapshot => snapshot,

        /** Replays on connectivity regained; returns a stop function. */
        start(): () => void {
            if (detach) return detach;
            const onOnline = () => void process();
            window.addEventListener('online', onOnline);
            void refreshCounts();
            void process();
            detach = () => {
                window.removeEventListener('online', onOnline);
                if (timer) clearTimeout(timer);
                timer = null;
                detach = null;
            };
            return detach;
        },
    };
}

export type OfflineQueue = ReturnType<typeof createOfflineQueue>;
