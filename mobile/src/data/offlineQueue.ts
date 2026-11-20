import type { AxiosInstance } from 'axios';
import { newIdempotencyKey } from '@web/utils/idempotency';
import { appEvents } from '../core/events';
import type { SessionStore } from '../core/session';
import type { MobileDB } from './cache';
import { guarded, reportStorage, toStorageError } from './storage';
import { isPermanentSyncFailure, ownerKeyOf, type SyncItem } from './types';

export const MAX_RETRIES = 5;
export const backoffMs = (retryCount: number) => Math.min(1000 * Math.pow(2, retryCount), 30_000);

export type EnqueueInput = Pick<SyncItem, 'url' | 'method' | 'data' | 'operationType'> &
    Partial<Pick<SyncItem, 'dependencyKey' | 'entityTempId' | 'idempotencyKey'>>;

export interface QueueDeps {
    db: MobileDB;
    /** The mobile http instance. */
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
    const syncedListeners = new Set<(item: SyncItem) => void>();
    let running: Promise<void> | null = null;
    /** Something changed (enqueue, session switch, connectivity) while a run was in flight: run again after it. */
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let detach: (() => void) | null = null;

    const currentOwner = async () => ownerKeyOf(await sessions.load());

    async function refreshCounts(): Promise<void> {
        const owner = await currentOwner();
        let next: QueueSnapshot = { pending: 0, failed: 0 };
        if (owner) {
            try {
                const rows = await db.syncQueue.where('ownerKey').equals(owner).toArray();
                next = {
                    pending: rows.filter((r) => r.status !== 'failed').length,
                    failed: rows.filter((r) => r.status === 'failed').length,
                };
            } catch (cause) {
                reportStorage(toStorageError('queue', 'count', cause)); // indicator keeps its last value; the UI is told
                return;
            }
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

    /** After a create is synced, queued dependents learn the real id (URL, body and dependencyKey). */
    async function resolveTempId(ownerKey: string, tempId: string, realId: number | string): Promise<void> {
        const swap = (v: unknown): unknown => {
            if (v === tempId) return realId;
            if (Array.isArray(v)) return v.map(swap);
            if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
            return v;
        };
        const rows = await db.syncQueue
            .where('ownerKey')
            .equals(ownerKey)
            .filter((r) => r.status !== 'failed')
            .toArray();
        for (const r of rows) {
            const url = r.url.split(`/orders/${tempId}`).join(`/orders/${realId}`);
            const data = swap(r.data);
            const clearDep = r.dependencyKey === tempId;
            if (url !== r.url || JSON.stringify(data) !== JSON.stringify(r.data) || clearDep) {
                await db.syncQueue.update(r.id!, { url, data, ...(clearDep ? { dependencyKey: null } : {}) });
            }
        }
    }

    /** Returns the owner the run started with (null when nothing could run). */
    async function runItems(): Promise<string | null> {
        if (!isOnline()) return null;
        const ownerKey = await currentOwner();
        if (!ownerKey) return null;

        // A previous run killed mid-request left items 'processing'; their key makes the resend safe.
        await db.syncQueue
            .where('ownerKey')
            .equals(ownerKey)
            .filter((r) => r.status === 'processing')
            .modify({ status: 'pending' });

        const items = (
            await db.syncQueue
                .where('ownerKey')
                .equals(ownerKey)
                .filter((r) => r.status === 'pending' || r.status === 'blocked')
                .toArray()
        ).sort((a, b) => a.timestamp - b.timestamp || a.id! - b.id!);

        for (const snapshotItem of items) {
            // PIN switch / sign-out mid-run: never continue one owner's batch under another session.
            if ((await currentOwner()) !== ownerKey) return ownerKey;
            // Fresh row: earlier items of this pass may have rewritten its url/body/dependency.
            const item = await db.syncQueue.get(snapshotItem.id!);
            if (!item || item.status === 'failed') continue;

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

            await db.syncQueue.update(item.id!, { status: 'processing', lastError: null });
            // Last check before sending, and the request is bound to THIS owner's token: a switch that
            // happened during the update above must not send this item under another user's session.
            const session = await sessions.load();
            if (!session || ownerKeyOf(session) !== ownerKey) {
                await db.syncQueue.update(item.id!, { status: 'pending' });
                return ownerKey;
            }
            try {
                const res = await http.request({
                    url: item.url,
                    method: item.method,
                    data: item.data,
                    headers: { Authorization: `Bearer ${session.token}`, 'X-Idempotency-Key': item.idempotencyKey || newIdempotencyKey() },
                });
                await db.syncQueue.delete(item.id!);
                if (item.operationType === 'CREATE_ORDER' && item.entityTempId) {
                    const realId = res.data?.data?.id ?? res.data?.id;
                    if (realId !== undefined && realId !== null) await resolveTempId(ownerKey, item.entityTempId, realId);
                }
                for (const fn of [...syncedListeners]) fn(item);
            } catch (error: unknown) {
                const err = error as { response?: { status?: number; data?: { message?: string; code?: unknown } }; message?: string };
                const status = err?.response?.status;
                if (status === 401) {
                    // Session ended. Not the item's fault: keep it untouched for the owner's next session.
                    await db.syncQueue.update(item.id!, { status: 'pending' });
                    // The request carried an explicit token, so the http layer did not track it: expire here.
                    const cur = await sessions.load();
                    if (cur?.token === session.token) {
                        try {
                            await sessions.clear();
                        } finally {
                            appEvents.emit('session-expired');
                        }
                    }
                    return ownerKey;
                }
                const lastError = err?.response?.data?.message || err?.message || 'Unknown sync error';
                if (!err?.response) {
                    // No connectivity (or timeout): back off and pause the run; this never burns a retry.
                    const networkFailures = (item.networkFailures ?? 0) + 1;
                    await db.syncQueue.update(item.id!, { status: 'pending', lastError, networkFailures, nextAttemptAt: now() + backoffMs(networkFailures) });
                    return ownerKey;
                }
                const retryCount = item.retryCount + 1;
                const permanent = isPermanentSyncFailure(status, err.response.data?.code);
                if (retryCount >= MAX_RETRIES || permanent) {
                    const terminal = permanent ? `[${status}] ${lastError}` : lastError;
                    await db.syncQueue.update(item.id!, { retryCount, status: 'failed', lastError: terminal, nextAttemptAt: null });
                    if (item.entityTempId) await failDependents(ownerKey, item.entityTempId, terminal);
                } else {
                    await db.syncQueue.update(item.id!, { retryCount, status: 'pending', lastError, nextAttemptAt: now() + backoffMs(retryCount) });
                }
            }
        }
        return ownerKey;
    }

    function process(): Promise<void> {
        if (running) {
            dirty = true; // picked up by the loop below once the current pass ends
            return running;
        }
        const run = (async () => {
            try {
                let again = true;
                while (again) {
                    dirty = false;
                    const started = await runItems();
                    again = dirty || (started !== null && (await currentOwner()) !== started);
                }
            } finally {
                await refreshCounts();
                const owner = await currentOwner();
                if (owner) await schedule(owner);
            }
        })();
        running = run;
        const clear = () => {
            if (running === run) running = null;
        };
        void run.then(clear, clear);
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
            item.id = await guarded('queue', 'enqueue', () => db.syncQueue.add(item));
            if (running) dirty = true; // a run in flight took its snapshot before this row existed
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
            const reset = { status: 'pending' as const, retryCount: 0, networkFailures: 0, nextAttemptAt: null, lastError: null };
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
            // Same rule as a permanent failure: what depended on it can no longer run.
            if (row.entityTempId) await failDependents(owner, row.entityTempId, 'operación descartada');
            await refreshCounts();
        },

        /** Notified after each item is applied by replay (e.g. to invalidate cached lists). */
        onSynced(fn: (item: SyncItem) => void): () => void {
            syncedListeners.add(fn);
            return () => {
                syncedListeners.delete(fn);
            };
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
            const onOnline = () => {
                // Connectivity is back: items paused by a network error need not wait for their backoff.
                void db.syncQueue
                    .filter((r) => r.status === 'pending' && (r.networkFailures ?? 0) > 0)
                    .modify({ nextAttemptAt: null })
                    .catch((cause) => reportStorage(toStorageError('queue', 'resume', cause)))
                    .finally(() => void process());
            };
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
