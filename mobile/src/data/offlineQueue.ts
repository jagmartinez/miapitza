import type { AxiosInstance } from 'axios';
import { newIdempotencyKey } from '@web/utils/idempotency';
import { appEvents } from '../core/events';
import type { SessionStore } from '../core/session';
import type { MobileDB } from './cache';
import { isDefinitiveCountRejection, isDefinitiveSurveyRejection, isInventoryCountItem, isSurveyItem } from './queueLabels';
import { guarded, reportStorage, toStorageError } from './storage';
import { isPermanentSyncFailure, ownerKeyOf, SessionChangedError, type SyncItem } from './types';

export const MAX_RETRIES = 5;
/** Queued work older than this is not replayed on its own: it becomes failed, for its owner to review. */
export const STALE_AFTER_MS = 12 * 60 * 60_000;
const STALE_MESSAGE = 'Quedó pendiente más de 12 h: revísalo antes de reenviarlo';
export const backoffMs = (retryCount: number) => Math.min(1000 * Math.pow(2, retryCount), 30_000);

export type EnqueueInput = Pick<SyncItem, 'url' | 'method' | 'data' | 'operationType'> &
    Partial<Pick<SyncItem, 'dependencyKey' | 'entityTempId' | 'idempotencyKey' | 'meta'>> & {
        /** The owner the action started under: refused (SessionChangedError) when the session is no longer theirs. */
        ownerKey?: string;
    };

export interface QueueDeps {
    db: MobileDB;
    /** The mobile http instance. */
    http: AxiosInstance;
    sessions: SessionStore;
    isOnline: () => boolean;
    now?: () => number;
}

/** An order created offline whose create has not synced yet. */
export interface PendingCreate {
    tempId: string;
    tableId: number | null;
    guests: number | null;
    timestamp: number;
}

/** A product line queued offline for an order: it is not on the server yet but the ticket must show it. */
export interface QueuedLine {
    id: number;
    menuItemId: number;
    quantity: number;
    notes: string;
    name: string;
    unitPrice: number;
    modifierNames: string[];
    status: SyncItem['status'];
    lastError: string | null;
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
    let starters = 0;
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

    // A row left 'processing' by a kill is as expired as any other: it must not be reset to pending and replayed.
    const isStale = (r: SyncItem) => r.status !== 'failed' && !r.approvedStale && !isSurveyItem(r) && !isInventoryCountItem(r) && now() - r.timestamp > STALE_AFTER_MS;

    /** Marks the owner's items that waited past the service window as failed (never replayed by itself). */
    async function sweepStale(ownerKey: string): Promise<void> {
        const rows = await db.syncQueue.where('ownerKey').equals(ownerKey).filter(isStale).toArray();
        for (const r of rows) {
            await db.syncQueue.update(r.id!, { status: 'failed', nextAttemptAt: null, lastError: STALE_MESSAGE });
            if (r.entityTempId) await failDependents(ownerKey, r.entityTempId, STALE_MESSAGE);
        }
        if (rows.length > 0) await refreshCounts();
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
        await db.transaction('rw', db.syncQueue, db.tempIds, db.drafts, async () => {
            await db.syncQueue.delete(item.id!);
            if (item.operationType !== 'CREATE_ORDER' || !item.entityTempId || realId === undefined) return;
            await moveDraftToOrder(item, ownerKey, realId);
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

    /**
     * The unsent lines a waiter wrote on the table while its order only lived in the queue follow it to the real order, so
     * leaving the screen before the sync never loses them. Only a draft written after the temp order was created is its own.
     */
    async function moveDraftToOrder(item: SyncItem, ownerKey: string, realId: number | string): Promise<void> {
        const tableId = Number((item.data as { tableId?: unknown } | null)?.tableId);
        if (!Number.isFinite(tableId) || !/^\d+$/.test(String(realId))) return;
        const from = `${ownerKey}:t:${tableId}`;
        const row = await db.drafts.get(from);
        const createdAt = Number(/^order-(\d+)-/.exec(item.entityTempId ?? '')?.[1]);
        if (!row || (Number.isFinite(createdAt) && row.updatedAt < createdAt)) return;
        const to = `${ownerKey}:o:${realId}`;
        if (!(await db.drafts.get(to))) await db.drafts.put({ ...row, id: to, tableId, orderId: Number(realId) });
        await db.drafts.delete(from);
    }

    /** Returns the owner the run started with (null when nothing could run). */
    async function runItems(): Promise<string | null> {
        const ownerKey = await currentOwner();
        if (!ownerKey) return null;
        await sweepStale(ownerKey); // also offline: the list and the counters must not call a stale item pending
        if (!isOnline()) return null;

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
                const survey = isSurveyItem(item);
                const count = isInventoryCountItem(item);
                if (count) {
                    // A count line is never left failed (nobody may discard it and the sheet could not be sent): a definitive 4xx verdict (or a plain 404 after MAX_RETRIES) drops it.
                    // A 404 without its own code is a missing route (deploy): it retries first, capped by MAX_RETRIES. 5xx, 408, 429 and the like are outages: the row keeps retrying with capped backoff and is never dropped.
                    const verdict = isDefinitiveCountRejection(status, err.response.data?.code) || (status !== 404 && isPermanentSyncFailure(status, err.response.data?.code));
                    if (verdict || (status === 404 && retryCount >= MAX_RETRIES)) {
                        await db.syncQueue.delete(item.id!);
                        const [, sheetId, productId] = /^\/v1\/inventory-counts\/(\d+)\/lines\/(\d+)/.exec(item.url) ?? [];
                        appEvents.emit('inventory-line-dropped', { sheetId: Number(sheetId), productId: Number(productId) });
                        await refreshCounts();
                        continue;
                    }
                    await db.syncQueue.update(item.id!, { retryCount, status: 'pending', lastError, nextAttemptAt: now() + backoffMs(retryCount) });
                    continue;
                }
                if (survey && isDefinitiveSurveyRejection(status, err.response.data?.code)) {
                    // Nobody can fix it and nobody may discard it: it must not sit as an error on the PIN screen forever.
                    await db.syncQueue.delete(item.id!);
                    continue;
                }
                // A survey 404 without its own code is a missing route (deploy), not a verdict: it keeps retrying, capped by MAX_RETRIES.
                const permanent = !(survey && status === 404) && isPermanentSyncFailure(status, err.response.data?.code);
                if (retryCount >= MAX_RETRIES || permanent) {
                    const terminal = permanent ? `[${status}] ${lastError}` : lastError;
                    await db.syncQueue.update(item.id!, { retryCount, status: 'failed', lastError: terminal, nextAttemptAt: null });
                    if (item.entityTempId) await failDependents(ownerKey, item.entityTempId, terminal);
                } else {
                    await db.syncQueue.update(item.id!, { retryCount, status: 'pending', lastError, nextAttemptAt: now() + backoffMs(retryCount) });
                }
                continue;
            }
            const realId = res.data?.data?.id ?? res.data?.id;
            if (item.operationType === 'CREATE_ORDER' && item.entityTempId && (realId === undefined || realId === null || realId === '')) {
                // Applied server-side but we cannot link what depends on it: fail loudly, never map to undefined.
                const message = 'La respuesta del servidor no incluyó el id del pedido';
                await db.syncQueue.update(item.id!, { status: 'failed', lastError: message, nextAttemptAt: null });
                await failDependents(ownerKey, item.entityTempId, message);
                continue;
            }
            // The server applied it. Bookkeeping failures are storage problems, not network errors:
            // the item stays queued and its idempotency key makes the resend safe.
            try {
                await applySynced(item, ownerKey, realId);
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
                    try {
                        let again = true;
                        while (again) {
                            dirty = false;
                            const started = await runItems();
                            again = dirty || (started !== null && (await currentOwner()) !== started);
                        }
                        await refreshCounts();
                        const owner = await currentOwner();
                        if (owner) await schedule(owner);
                    } catch (cause) {
                        reportStorage(toStorageError('queue', 'run', cause)); // never an unhandled rejection
                    }
                    // Anything requested meanwhile (even while the pass above failed) runs now. No await
                    // between this check and clearing `running`, so a later process() starts a fresh run.
                    if (!dirty) {
                        running = null;
                        return;
                    }
                }
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
            if (input.ownerKey !== undefined && input.ownerKey !== ownerKey) throw new SessionChangedError();
            // One transaction over both tables (the same ones applySynced locks): a create that syncs
            // concurrently either finished before we read the id map or rewrites our row after we insert.
            const item = await guarded('queue', 'enqueue', () =>
                db.transaction('rw', db.tempIds, db.syncQueue, async () => {
                    const rows = await db.tempIds.where('ownerKey').equals(ownerKey).toArray();
                    const known = new Map<string, number | string>(rows.filter((r) => !r.discarded).map((r) => [r.tempId, r.realId]));
                    const dead = new Set(rows.filter((r) => r.discarded).map((r) => r.tempId));
                    const resolved = applyTempMap(known, input.url, input.data, input.dependencyKey);
                    const dep = resolved.dependencyKey;
                    // A parent that was discarded or already failed can never run: neither can this.
                    const deadParent =
                        (dep && dead.has(dep)) ||
                        resolved.url.split('?')[0].split('/').some((seg) => dead.has(seg)) ||
                        (dep
                            ? (await db.syncQueue.where('ownerKey').equals(ownerKey).filter((c) => c.entityTempId === dep && c.status === 'failed').count()) > 0
                            : false);
                    const row: SyncItem = {
                        url: resolved.url,
                        method: input.method,
                        data: resolved.data,
                        operationType: input.operationType,
                        dependencyKey: dep,
                        entityTempId: input.entityTempId ?? null,
                        idempotencyKey: input.idempotencyKey || newIdempotencyKey(),
                        timestamp: nextTimestamp(),
                        meta: input.meta,
                        status: deadParent ? 'failed' : 'pending',
                        retryCount: 0,
                        lastError: deadParent ? `Dependencia fallida (${dep ?? 'pedido'}): la operación previa fue descartada o falló` : null,
                        nextAttemptAt: null,
                        ownerKey,
                    };
                    row.id = await db.syncQueue.add(row);
                    return row;
                }),
            );
            if (running) dirty = true; // a run in flight took its snapshot before this row existed
            await refreshCounts();
            return item;
        },

        process,

        /** Real id of an offline-created order whose create already synced (null while unknown). */
        async resolveTemp(tempId: string): Promise<number | string | null> {
            const owner = await currentOwner();
            if (!owner) return null;
            const row = await db.tempIds.get(`${owner}|${tempId}`);
            return row && !row.discarded ? row.realId : null;
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

        /** The owner's items still on this device (pending, blocked, failed), oldest first: what the offline indicator lists. */
        async listItems(): Promise<SyncItem[]> {
            const owner = await currentOwner();
            if (!owner) return [];
            await sweepStale(owner);
            const rows = await db.syncQueue.where('ownerKey').equals(owner).toArray();
            return rows.sort((a, b) => a.timestamp - b.timestamp || a.id! - b.id!);
        },

        /** Every user's queued work by user id (for the PIN screen: "Ana · 3 pendientes"). Stale items count as failed. */
        async pendingByUser(): Promise<Record<number, { pending: number; failed: number }>> {
            const out: Record<number, { pending: number; failed: number }> = {};
            for (const r of await db.syncQueue.toArray()) {
                const userId = Number(r.ownerKey.split(':')[1]);
                if (!Number.isFinite(userId)) continue;
                const slot = (out[userId] ??= { pending: 0, failed: 0 });
                if (r.status === 'failed' || isStale(r)) slot.failed += 1;
                else slot.pending += 1;
            }
            return out;
        },

        /** The owner's creates still waiting to sync: the floor plan shows those tables as occupied by the temp order. */
        async pendingCreates(): Promise<PendingCreate[]> {
            const owner = await currentOwner();
            if (!owner) return [];
            const rows = await db.syncQueue
                .where('ownerKey')
                .equals(owner)
                .filter((r) => r.operationType === 'CREATE_ORDER' && r.status !== 'failed' && !!r.entityTempId)
                .toArray();
            return rows
                .sort((a, b) => a.timestamp - b.timestamp)
                .map((r) => {
                    const data = (r.data ?? {}) as { tableId?: unknown; guests?: unknown };
                    return { tempId: r.entityTempId!, tableId: Number.isFinite(Number(data.tableId)) && data.tableId != null ? Number(data.tableId) : null, guests: Number(data.guests) > 0 ? Number(data.guests) : null, timestamp: r.timestamp };
                });
        },

        /** The owner's product lines queued for this order (its temp id, or its real id once the create synced). */
        async queuedLines(orderRef: string | number): Promise<QueuedLine[]> {
            const owner = await currentOwner();
            if (!owner) return [];
            const url = `/orders/${orderRef}/items`;
            const rows = await db.syncQueue
                .where('ownerKey')
                .equals(owner)
                .filter((r) => r.operationType === 'ADD_ORDER_ITEM' && r.url.split('?')[0] === url)
                .toArray();
            return rows
                .sort((a, b) => a.timestamp - b.timestamp || a.id! - b.id!)
                .map((r) => {
                    const d = (r.data ?? {}) as { menuItemId?: unknown; quantity?: unknown; notes?: unknown };
                    return {
                        id: r.id!,
                        menuItemId: Number(d.menuItemId) || 0,
                        quantity: Number(d.quantity) || 1,
                        notes: typeof d.notes === 'string' ? d.notes : '',
                        name: r.meta?.name ?? 'Producto',
                        unitPrice: r.meta?.unitPrice ?? 0,
                        modifierNames: r.meta?.modifierNames ?? [],
                        status: r.status,
                        lastError: r.lastError ?? null,
                    };
                });
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
            if (!owner || !row || row.ownerKey !== owner || row.status === 'processing') return;
            if (row.status !== 'failed') {
                // Waiting (backoff or behind its parent): try now instead of when the timer says.
                await db.syncQueue.update(id, { nextAttemptAt: null, networkFailures: 0 });
                void process();
                return;
            }
            // The owner looked at it and chose to send it: that review also lifts the 12 h rule for it and its dependents.
            const reset = { status: 'pending' as const, retryCount: 0, networkFailures: 0, nextAttemptAt: null, lastError: null, approvedStale: true };
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
            if (!owner || !row || row.ownerKey !== owner || row.status === 'processing') return;
            await db.syncQueue.delete(id);
            // Same rule as a permanent failure: what depended on it can no longer run.
            if (row.entityTempId) {
                await db.tempIds.put({ id: `${owner}|${row.entityTempId}`, ownerKey: owner, tempId: row.entityTempId, realId: '', discarded: true, timestamp: now() });
                await failDependents(owner, row.entityTempId, 'operación descartada');
            }
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

        /**
         * Replays on connectivity regained; returns this caller's own stop function. Reference counted: several screens
         * (waiter home, inventory) may start the same queue, and it detaches only when the last one stops.
         */
        start(): () => void {
            starters += 1;
            if (!detach) {
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
            }
            let released = false;
            return () => {
                if (released) return;
                released = true;
                starters -= 1;
                if (starters <= 0) {
                    starters = 0;
                    detach?.();
                }
            };
        },
    };
}

export type OfflineQueue = ReturnType<typeof createOfflineQueue>;
