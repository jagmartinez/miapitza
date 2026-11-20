import Dexie, { type Table } from 'dexie';
import type { CacheEntry, DraftRow, SyncItem } from './types';

/** Local store of the waiter app. Holds no tokens: owners are identified by `companyId:userId`. */
export class MobileDB extends Dexie {
    caches!: Table<CacheEntry, string>;
    syncQueue!: Table<SyncItem, number>;
    drafts!: Table<DraftRow, string>;

    constructor(name = 'MobileDB') {
        super(name);
        this.version(1).stores({
            caches: 'id, ownerKey, url, timestamp',
            syncQueue: '++id, ownerKey, status, timestamp, entityTempId, dependencyKey',
            drafts: 'id, userId',
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

    async function load(id: string): Promise<CacheEntry | undefined> {
        try {
            return await db.caches.get(id);
        } catch {
            return undefined; // an unreadable cache is a miss, never an error
        }
    }

    async function store(id: string, o: ReadOptions<unknown>, data: unknown): Promise<void> {
        try {
            await db.caches.put({ id, url: o.url, ownerKey: o.ownerKey, data, timestamp: now() });
        } catch {
            // Quota or storage failure: the fresh data is still returned.
        }
    }

    /** One network fetch per key at a time. */
    function fetchAndStore<T>(id: string, o: ReadOptions<T>): Promise<T> {
        const running = inflight.get(id) as Promise<T> | undefined;
        if (running) return running;
        const p = (async () => {
            const data = await o.fetch();
            await store(id, o as ReadOptions<unknown>, data);
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

        /** Drops every cached response of an owner (e.g. on sign-out of a shared tablet). */
        async clearOwner(ownerKey: string): Promise<void> {
            await db.caches.where('ownerKey').equals(ownerKey).delete();
        },
    };
}

export type Cache = ReturnType<typeof createCache>;
