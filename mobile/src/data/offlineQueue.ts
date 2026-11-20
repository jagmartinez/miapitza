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
    let stopped = false;

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
        if (stopped || !isOnline()) return;
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

    async function loadTempMap(ownerKey: string): Promise<Map<string, number | string>> {
        const rows = await db.tempIds.where('ownerKey').equals(ownerKey).toArray();
        return new Map(rows.map((r) => [r.tempId, r.realId]));
    }

    /** Replaces known temp ids, matching whole path segments and exact values only (never substrings). */
    function applyTempMap(map: Map<string, number | string>, url: string, data: unknown, dependencyKey: string | null | undefined) {
        if (map.size === 0) return { url, data, dependencyKey: dependencyKey ?? null };
        const swap = (v: unknown): unknown => {
            if (typeof v === 'string') return map.has(v) ? map.get(v) : v;
            if (Array.isArray(v)) return v.map(swap);
            if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
            return v;
        };
        const [path, ...query] = url.split('?');
        const newPath = path
            .split('/')
            .map((seg) => (map.has(seg) ? String(map.get(seg)) : seg))
            .join('/');
        return {
            url: [newPath, ...query].join('?'),
            data: swap(data),
            dependencyKey: dependencyKey && map.has(dependencyKey) ? null : dependencyKey ?? null,
        };
    }

    /**
     * Atomically: remove the applied item and, for a create, persist temp->real and rewrite every
     * queued dependent. A crash can never leave dependents pointing at a deleted parent.
     */
    async function applySynced(item: SyncItem, ownerKey: string, realId: number | string | undefined): Promise<void> {
        await db.transaction('rw', db.syncQueue, db.tempIds, async () => {
            await db.syncQueue.delete(item.id!);
            if (item.operationType !== 'CREATE_ORDER' || !item.entityTempId || realId === undefined) return;
            await db.tempIds.put({ id: `${ownerKey}|${item.entityTempId}`, ownerKey, tempId: item.entityTempId, realId, timestamp: now() });
            const map = new Map<string, number | string>([[item.entityTempId, realId]]);
            const rows = await db.syncQueue.where('ownerKey').equals(ownerKey).filter((r) => r.status !== 'failed').toArray();
            for (const r of rows) {
                const next = applyTempMap(map, r.url, r.data, r.dependencyKey);
                if (next.url !== r.url || next.dependencyKey !== (r.dependencyKey ?? null) || JSON.stringify(next.data) !== JSON.stringify(r.data)) {
                    await db.syncQueue.update(r.id!, { url: next.url, data: next.data, dependencyKey: next.dependencyKey });
                }
            }
        });
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
            let res: { data?: { data?: { id?: number | string }; id?: number | string } };
            try {
                res = await http.request({
                    url: item.url,
                    method: item.method,
                    data: item.data,
                    headers: { Authorization: `Bearer ${session.token}`, 'X-Idempotency-Key': item.idempotencyKey || newIdempotencyKey() },
                });
            } catch (error: unknown) {
                const err = error as { response?: { status?: number; data?: { message?: string; code?: unknown } }; message?: string };
                const status = err?.response?.status;
                if (status === 401) {
                    // Session ended. Not the item's fault: keep it untouched for the owner's next session.
                    await db.syncQueue.update(item.id!, { status: 'pending' });
                    const cur = await sessions.load();
                    if (cur && cur.token !== session.token) {
                        dirty = true; // re-login of the same owner mid-request: resume with the new token
                    } else if (cur && !/\/discount\//.test(item.url)) {
                        // The request carried an explicit token, so the http layer did not track it: expire here.
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
                continue;
            }
            // The server applied it. Bookkeeping failures are storage problems, not network errors:
            // the item stays queued and its idempotency key makes the resend safe.
            try {
                await applySynced(item, ownerKey, res.data?.data?.id ?? res.data?.id);
            } catch (cause) {
                reportStorage(toStorageError('queue', 'apply', cause));
                await db.syncQueue.update(item.id!, { status: 'pending' }).catch(() => undefined);
                return ownerKey;
            }
            for (const fn of [...syncedListeners]) {
                try {
                    fn(item);
                } catch {
                    // A listener must not break replay.
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
        const self: { run?: Promise<void> } = {};
        const run: Promise<void> = (async () => {
            try {
                for (;;) {
                    let again = true;
                    while (again) {
                        dirty = false;
                        const started = await runItems();
                        again = dirty || (started !== null && (await currentOwner()) !== started);
                    }
                    await refreshCounts();
                    const owner = await currentOwner();
                    if (owner) await schedule(owner);
                    // Anything requested during the bookkeeping above runs now. No await between this
                    // check and clearing `running`, so a later process() always starts a fresh run.
                    if (!dirty) {
                        running = null;
                        return;
                    }
                }
            } catch (cause) {
                reportStorage(toStorageError('queue', 'run', cause)); // never an unhandled rejection
            } finally {
                if (running === self.run) running = null;
            }
        })();
        self.run = run;
        running = run;
        return run;
    }

    return {
        async enqueue(input: EnqueueInput): Promise<SyncItem> {
            const ownerKey = await currentOwner();
            if (!ownerKey) throw new Error('No hay sesión para encolar la operación');
            // A create that already synced: use the real id straight away.
            const known = await guarded('queue', 'enqueue', () => loadTempMap(ownerKey));
            const resolved = applyTempMap(known, input.url, input.data, input.dependencyKey);
            const item: SyncItem = {
                url: resolved.url,
                method: input.method,
                data: resolved.data,
                operationType: input.operationType,
                dependencyKey: resolved.dependencyKey,
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

        /** Real id of an offline-created order whose create already synced (null while unknown). */
        async resolveTemp(tempId: string): Promise<number | string | null> {
            const owner = await currentOwner();
            if (!owner) return null;
            return (await db.tempIds.get(`${owner}|${tempId}`))?.realId ?? null;
        },

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
            stopped = false;
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
                stopped = true;
                if (timer) clearTimeout(timer);
                timer = null;
                detach = null;
            };
            return detach;
        },
    };
}

export type OfflineQueue = ReturnType<typeof createOfflineQueue>;
