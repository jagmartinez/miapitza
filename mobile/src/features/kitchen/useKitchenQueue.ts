import { useCallback, useEffect, useRef, useState } from 'react';
import { getKitchenReceivedAt } from '@web/utils/kdsTiming';
import { getApiErrorMessage } from '@web/utils/apiError';
import { isVoidedOrderLine } from '@web/utils/orderLineVoid';
import { httpStatus } from '../../core/httpErrors';
import type { KitchenApi } from './kitchenApi';
import { batchKey, type KitchenBatch, type KitchenConfig } from './kitchenTypes';

export interface KitchenRealtime {
    subscribe(type: string, fn: (payload: unknown) => void): () => void;
}

export interface UseKitchenQueueOptions {
    debounceMs?: number;
    /** False until the kitchen has a session: no request goes out unauthenticated. Default true. */
    enabled?: boolean;
}

export type KitchenQueueStatus = 'loading' | 'ready' | 'error';

const SAFETY_REFETCH_MS = 60_000;
/** Delay thresholds are admin-editable: refetch them now and then instead of once per app start. */
const CONFIG_REFRESH_MS = 10 * 60_000;
const REFETCH_TYPES = ['ORDER_SENT_TO_KITCHEN', 'ORDER_IN_PREPARATION', 'ORDER_READY', 'ORDER_UPDATE', 'CONNECTED'] as const;
/** Edits to lines not yet sent to the kitchen; the full order payload is not batch-shaped. */
const IGNORED_UPDATE_STATUSES = new Set(['ITEMS_CHANGED', 'GUESTS_CHANGED']);

function queueErrorText(cause: unknown): string {
    const status = httpStatus(cause);
    if (status === 403) return 'Sin permiso para ver la cocina';
    if (status === undefined) return 'Sin conexión con el servidor';
    return getApiErrorMessage(cause) || 'No se pudo cargar la cola.';
}

/** Voided lines stay (the cook sees what was withdrawn); a batch with no live line left is hidden; oldest received first. */
function visibleBatches(raw: KitchenBatch[]): KitchenBatch[] {
    const out: KitchenBatch[] = [];
    for (const b of raw) {
        const items = b.items ?? [];
        if (items.some((i) => !isVoidedOrderLine(i as Parameters<typeof isVoidedOrderLine>[0]))) out.push({ ...b, items });
    }
    const at = (b: KitchenBatch) => new Date(getKitchenReceivedAt(b)).getTime();
    return out.sort((a, b) => at(a) - at(b));
}

export function useKitchenQueue(api: KitchenApi, realtime: KitchenRealtime, opts: UseKitchenQueueOptions = {}) {
    const debounceMs = opts.debounceMs ?? 250;
    const enabled = opts.enabled ?? true;
    const [batches, setBatches] = useState<KitchenBatch[]>([]);
    const [config, setConfig] = useState<KitchenConfig | undefined>();
    const [status, setStatus] = useState<KitchenQueueStatus>('loading');
    const [error, setError] = useState<string | undefined>();
    const [lastLoadedAt, setLastLoadedAt] = useState<number | undefined>();

    const seq = useRef(0);
    const alive = useRef(true);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevKeys = useRef<Set<string> | null>(null);
    const listeners = useRef(new Set<(fresh: KitchenBatch[]) => void>());
    const loading = useRef(false);
    const configAt = useRef<number | null>(null);
    const apiRef = useRef(api);
    apiRef.current = api;

    const load = useCallback(async () => {
        const mine = ++seq.current;
        loading.current = true;
        try {
            const raw = await apiRef.current.queue();
            if (mine === seq.current) loading.current = false;
            if (!alive.current || mine !== seq.current) return; // stale or unmounted
            const next = visibleBatches(raw);
            const previous = prevKeys.current;
            prevKeys.current = new Set(next.map(batchKey));
            setBatches(next);
            setStatus('ready');
            setError(undefined);
            setLastLoadedAt(Date.now());
            if (previous) {
                const fresh = next.filter((b) => !previous.has(batchKey(b)));
                if (fresh.length > 0) {
                    for (const fn of [...listeners.current]) {
                        try {
                            fn(fresh);
                        } catch {
                            /* a faulty listener must not affect the load or other listeners */
                        }
                    }
                }
            }
        } catch (cause) {
            if (mine === seq.current) loading.current = false;
            if (!alive.current || mine !== seq.current) return;
            setStatus('error');
            setError(queueErrorText(cause));
        }
        if (configAt.current === null || Date.now() - configAt.current >= CONFIG_REFRESH_MS) {
            try {
                const cfg = await apiRef.current.config();
                if (alive.current) {
                    configAt.current = Date.now();
                    setConfig(cfg);
                }
            } catch {
                /* timing colors fall back to normal until the next load */
            }
        }
    }, []);

    const schedule = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            timer.current = null;
            void load();
        }, debounceMs);
    }, [debounceMs, load]);

    useEffect(() => {
        alive.current = true;
        if (!enabled) {
            return () => {
                alive.current = false;
            };
        }
        void load();
        // Safety net for a socket that died silently: events alone would never trigger a refetch.
        const poll = setInterval(() => {
            if (!loading.current) void load();
        }, SAFETY_REFETCH_MS);
        const offs = REFETCH_TYPES.map((type) =>
            realtime.subscribe(type, (payload) => {
                if (type === 'ORDER_UPDATE') {
                    const s = (payload as { status?: unknown } | null)?.status;
                    if (typeof s === 'string' && IGNORED_UPDATE_STATUSES.has(s)) return;
                }
                schedule();
            }),
        );
        return () => {
            alive.current = false;
            clearInterval(poll);
            offs.forEach((off) => off());
            if (timer.current) clearTimeout(timer.current);
            timer.current = null;
        };
    }, [realtime, load, schedule, enabled]);

    const reload = useCallback(() => load(), [load]);
    const onNewBatches = useCallback((cb: (fresh: KitchenBatch[]) => void) => {
        listeners.current.add(cb);
        return () => {
            listeners.current.delete(cb);
        };
    }, []);

    return { batches, config, status, error, lastLoadedAt, reload, onNewBatches };
}
