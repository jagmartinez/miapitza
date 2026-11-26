import Dexie, { type Table, type Transaction } from 'dexie';
import { reportStorage, toStorageError } from './storage';
import type { CacheEntry, DraftRow, PlanRow, SyncItem, TempIdRow } from './types';

/** Local store of the waiter app. Holds no tokens: owners are identified by `companyId:userId`. */
/** Drafts older than this are dropped by the v5 upgrade (same rule as the drafts store). */
const DRAFT_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * Every schema version, in order: the single source of truth for the app and for the upgrade test that walks v1 -> latest.
 * An upgrade must never touch `syncQueue` rows (queued offline work); new versions only add tables or indexes.
 */
const MOBILE_SCHEMA: { stores: Record<string, string>; upgrade?: (tx: Transaction) => void | PromiseLike<unknown> }[] = [
    {
        stores: {
            caches: 'id, ownerKey, url, timestamp',
            syncQueue: '++id, ownerKey, status, timestamp, entityTempId, dependencyKey',
            drafts: 'id, userId',
        },
    },
    // Drafts were keyed by userId only; they are keyed by owner now. Unreleased data, so drop it.
    { stores: { drafts: 'id, ownerKey' }, upgrade: (tx) => tx.table('drafts').clear() },
    { stores: { tempIds: 'id, ownerKey, timestamp' } },
    { stores: { paymentPlans: 'id, ownerKey, timestamp' } },
    // Drafts follow the order (24 h expiry): rows keyed by table become the table fallback, expired ones are dropped.
    {
        stores: { drafts: 'id, ownerKey, updatedAt' },
        upgrade: async (tx) => {
            const table = tx.table('drafts');
            const cutoff = Date.now() - DRAFT_MAX_AGE_MS;
            for (const row of (await table.toArray()) as DraftRow[]) {
                if (/:[to]:\d+$/.test(row.id)) continue; // already in the new format
                await table.delete(row.id);
                if (row.updatedAt < cutoff || !row.ownerKey || typeof row.tableId !== 'number') continue;
                await table.put({ ...row, id: `${row.ownerKey}:t:${row.tableId}`, orderId: null });
            }
        },
    },
];

export const MOBILE_DB_VERSION = MOBILE_SCHEMA.length;

export class MobileDB extends Dexie {
    caches!: Table<CacheEntry, string>;
    syncQueue!: Table<SyncItem, number>;
    drafts!: Table<DraftRow, string>;
    tempIds!: Table<TempIdRow, string>;
    paymentPlans!: Table<PlanRow, string>;

    /** `upTo` opens an older schema (tests that walk the upgrades); the app always opens the latest. */
    constructor(name = 'MobileDB', opts: { upTo?: number } = {}) {
        super(name);
        MOBILE_SCHEMA.slice(0, opts.upTo ?? MOBILE_SCHEMA.length).forEach((step, i) => {
            const version = this.version(i + 1).stores(step.stores);
            if (step.upgrade) version.upgrade(step.upgrade);
        });
    }
}

export const TTL = {
    menu: 5 * 60_000,
    categories: 10 * 60_000,
    plan: 10 * 60_000,
    orders: 60_000,
    default: 3 * 60_000,
} as const;

export interface ReadOptions<T> {
    ownerKey: string;
    url: string;
    params?: Record<string, unknown>;
    ttlMs: number;
    /** Stale-while-revalidate: always answer from cache when there is an entry, refresh in the background. */
    swr?: boolean;
    fetch: () => Promise<T>;
    /** Checked after the fetch: false means the session changed meanwhile and the response must be dropped. */
    isCurrent?: () => Promise<boolean>;
    /** Called when a background refresh produced different data. */
    onRefresh?: (data: T) => void;
}

export interface CacheResult<T> {
    data: T;
    source: 'cache' | 'network';
    /** True when the answer is older than its TTL (served because the network failed). */
    stale?: boolean;
    /** Settles when the background refresh (if any) has finished. Never rejects. */
    refresh: Promise<void>;
}

/** The session changed while a request was in flight; its response belongs to nobody. */
export class StaleOwnerError extends Error {
    constructor() {
        super('La sesión cambió durante la consulta');
        this.name = 'StaleOwnerError';
    }
}

/** Cache rows older than this are purged on start. */
export const MAX_CACHE_AGE_MS = 24 * 60 * 60_000;

export function cacheKey(ownerKey: string, url: string, params?: Record<string, unknown>): string {
    const qs = Object.entries(params ?? {})
        .filter(([, v]) => v !== undefined && v !== null)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${String(v)}`)
        .join('&');
    return `${ownerKey}|${url}${qs ? `?${qs}` : ''}`;
}

export function createCache(db: MobileDB, now: () => number = Date.now) {
    const inflight = new Map<string, Promise<unknown>>();
    // Bumped by invalidate(): a fetch that began before a mutation must not store its pre-mutation data.
    const generation = new Map<string, number>();

    async function load(id: string): Promise<CacheEntry | undefined> {
        try {
            return await db.caches.get(id);
        } catch (cause) {
            // The cache is an optimisation: an unreadable one is a miss, but the UI is told.
            reportStorage(toStorageError('cache', 'read', cause));
            return undefined;
        }
    }

    async function store(id: string, o: ReadOptions<unknown>, data: unknown): Promise<void> {
        try {
            await db.caches.put({ id, url: o.url, ownerKey: o.ownerKey, data, timestamp: now() });
        } catch (cause) {
            // Quota or storage failure: the fresh data is still returned, the UI is told.
            reportStorage(toStorageError('cache', 'write', cause));
        }
    }

    /** One network fetch per key at a time. */
    function fetchAndStore<T>(id: string, o: ReadOptions<T>): Promise<T> {
        const running = inflight.get(id) as Promise<T> | undefined;
        if (running) return running;
        const p = (async () => {
            const gen = generation.get(o.ownerKey) ?? 0;
            const data = await o.fetch();
            if (o.isCurrent && !(await o.isCurrent())) throw new StaleOwnerError();
            if ((generation.get(o.ownerKey) ?? 0) === gen) await store(id, o as ReadOptions<unknown>, data);
            return data;
        })().finally(() => {
            inflight.delete(id);
        });
        inflight.set(id, p);
        return p;
    }

    return {
        async read<T>(o: ReadOptions<T>): Promise<CacheResult<T>> {
            const id = cacheKey(o.ownerKey, o.url, o.params);
            const entry = await load(id);
            if (!entry) {
                return { data: await fetchAndStore(id, o), source: 'network', refresh: Promise.resolve() };
            }
            const cached = entry.data as T;
            const expired = now() - entry.timestamp >= o.ttlMs;
            if (o.swr) {
                const refresh = fetchAndStore(id, o).then(
                    (fresh) => {
                        if (JSON.stringify(fresh) !== JSON.stringify(cached)) o.onRefresh?.(fresh);
                    },
                    () => undefined,
                );
                return { data: cached, source: 'cache', stale: expired, refresh };
            }
            if (!expired) return { data: cached, source: 'cache', refresh: Promise.resolve() };
            try {
                return { data: await fetchAndStore(id, o), source: 'network', refresh: Promise.resolve() };
            } catch {
                return { data: cached, source: 'cache', stale: true, refresh: Promise.resolve() };
            }
        },

        /** Drops an owner's cached responses whose url starts with any prefix (after own mutations). */
        async invalidate(ownerKey: string, urlPrefixes: string[]): Promise<void> {
            generation.set(ownerKey, (generation.get(ownerKey) ?? 0) + 1);
            try {
                await db.caches
                    .where('ownerKey')
                    .equals(ownerKey)
                    .filter((r) => urlPrefixes.some((p) => r.url.startsWith(p)))
                    .delete();
            } catch (cause) {
                reportStorage(toStorageError('cache', 'invalidate', cause));
            }
        },

        /** Eviction sweep, run on start. */
        async purgeExpired(maxAgeMs: number = MAX_CACHE_AGE_MS): Promise<void> {
            try {
                await db.caches.where('timestamp').below(now() - maxAgeMs).delete();
                await db.tempIds.where('timestamp').below(now() - maxAgeMs).delete();
                await db.paymentPlans.where('timestamp').below(now() - maxAgeMs).delete(); // plans of orders nobody reopened
            } catch (cause) {
                reportStorage(toStorageError('cache', 'purge', cause));
            }
        },

        /** Drops every cached response of an owner (e.g. on sign-out of a shared tablet). */
        async clearOwner(ownerKey: string): Promise<void> {
            try {
                await db.caches.where('ownerKey').equals(ownerKey).delete();
            } catch (cause) {
                reportStorage(toStorageError('cache', 'clear', cause));
            }
        },
    };
}

export type Cache = ReturnType<typeof createCache>;
