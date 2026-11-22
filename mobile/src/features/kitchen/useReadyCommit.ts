import { useCallback, useEffect, useRef, useState } from 'react';
import { newIdempotencyKey } from '@web/utils/idempotency';
import { kitchenAuthStatus } from '../../core/kitchenAuth';
import { KitchenActionError, type KitchenApi } from './kitchenApi';
import { kitchenLabel } from './kitchenLabel';
import { batchKey, type KitchenBatch } from './kitchenTypes';
import { useSessionWake } from './useSessionWake';

export const READY_UNDO_MS = 5000;
const MIN_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30_000;
const MAX_COMMITTED = 10;
/** A commit that gets no usable answer for this long is given up and the card restored. */
const GIVE_UP_MS = 120_000;

export interface PendingReady {
    key: string;
    label: string;
    waiter: string;
    deadline: number;
}
export interface ReadyFailure {
    key: string;
    label: string;
    message: string;
}

type Phase = 'pending' | 'committing' | 'done';
interface Entry {
    batch: KitchenBatch;
    key: string;
    label: string;
    waiter: string;
    deadline: number;
    readyKey: string;
    releaseKey: string;
    phase: Phase;
    /** Steps already acknowledged by the server (0 = none, 1 = ready done). */
    step: 0 | 1;
    timer: ReturnType<typeof setTimeout> | null;
    /** Start of the current run of network/5xx failures (reset by any acknowledged step). */
    failingSince: number | null;
}

type ReadyApi = Pick<KitchenApi, 'ready' | 'release'>;

/**
 * "Listo" with a deferred commit: the card hides at once, the user has `undoMs` to undo,
 * then ready -> release run in sequence with idempotency keys fixed at markReady time.
 */
export function useReadyCommit(api: ReadyApi, opts: { undoMs?: number; sessionKey?: string | null } = {}) {
    const undoMs = opts.undoMs ?? READY_UNDO_MS;
    const apiRef = useRef(api);
    apiRef.current = api;
    const entries = useRef(new Map<string, Entry>());
    const mounted = useRef(true);
    const onSessionWake = useSessionWake(opts.sessionKey);
    const [, setVersion] = useState(0);
    const [committed, setCommitted] = useState<KitchenBatch[]>([]);
    const [failures, setFailures] = useState<ReadyFailure[]>([]);
    const bump = useCallback(() => {
        if (mounted.current) setVersion((v) => v + 1);
    }, []);

    // `fail` is defined below; the give-up timer reaches it through this ref.
    const failRef = useRef<(entry: Entry, message: string) => void>(() => undefined);

    const waitForOnline = useCallback(
        (entry: Entry, backoff: number, resume: (next: number) => void) => {
            // Bounded: a renewal that never reaches "online" must not leave the card hidden forever.
            const left = GIVE_UP_MS - (Date.now() - (entry.failingSince ?? Date.now()));
            let cancel: () => void = () => undefined;
            const giveUp = setTimeout(() => {
                cancel();
                failRef.current(entry, 'sin sesión con el servidor');
            }, Math.max(0, left));
            const proceed = (next: number) => {
                clearTimeout(giveUp);
                resume(next);
            };
            cancel = onSessionWake(() => proceed(MIN_BACKOFF_MS));
            // Already online (the 401 outran the status event): retry with the same growing backoff.
            if (kitchenAuthStatus() === 'online') {
                cancel();
                entry.timer = setTimeout(() => proceed(Math.min(backoff * 2, MAX_BACKOFF_MS)), backoff);
            }
        },
        [onSessionWake],
    );

    const fail = useCallback(
        (entry: Entry, message: string) => {
            entries.current.delete(entry.key);
            if (mounted.current) setFailures((f) => [...f.filter((x) => x.key !== entry.key), { key: entry.key, label: entry.label || 'Comanda', message }]);
            bump();
        },
        [bump],
    );
    failRef.current = fail;

    const run = useCallback(
        async (entry: Entry, backoff = MIN_BACKOFF_MS): Promise<void> => {
            entry.timer = null;
            const steps = ['ready', 'release'] as const;
            while (entry.step < 2) {
                const action = steps[entry.step];
                const key = action === 'ready' ? entry.readyKey : entry.releaseKey;
                try {
                    await apiRef.current[action](entry.batch, key);
                } catch (cause) {
                    // A non-KitchenActionError is a programming bug, not a network blip: never retry it forever.
                    const err = cause instanceof KitchenActionError ? cause : new KitchenActionError('rejected', 'Error inesperado al marcar Listo.');
                    if (err.kind === 'already-done') {
                        entry.step = (entry.step + 1) as 0 | 1;
                        continue;
                    }
                    if (err.kind === 'auth') {
                        entry.failingSince ??= Date.now();
                        waitForOnline(entry, backoff, (next) => void run(entry, next));
                        return;
                    }
                    if (err.kind === 'network') {
                        entry.failingSince ??= Date.now();
                        if (Date.now() - entry.failingSince >= GIVE_UP_MS) {
                            fail(entry, 'sin respuesta del servidor');
                            return;
                        }
                        entry.timer = setTimeout(() => void run(entry, Math.min(backoff * 2, MAX_BACKOFF_MS)), backoff);
                        return;
                    }
                    fail(entry, err.message);
                    return;
                }
                entry.failingSince = null;
                entry.step = (entry.step + 1) as 0 | 1;
            }
            entry.phase = 'done';
            if (mounted.current) setCommitted((c) => [{ ...entry.batch, status: 'READY', kitchenReleasedAt: new Date().toISOString() },...c.filter((b) => batchKey(b) !== entry.key)].slice(0, MAX_COMMITTED));
            bump();
        },
        [bump, fail, waitForOnline],
    );

    const startCommit = useCallback(
        (entry: Entry) => {
            entry.phase = 'committing';
            bump();
            void run(entry);
        },
        [bump, run],
    );

    const markReady = useCallback(
        (b: KitchenBatch) => {
            const key = batchKey(b);
            const existing = entries.current.get(key);
            if (existing) return;
            const entry: Entry = {
                batch: b,
                key,
                label: kitchenLabel(b),
                waiter: b.user?.name ?? '',
                deadline: Date.now() + undoMs,
                readyKey: newIdempotencyKey(),
                releaseKey: newIdempotencyKey(),
                phase: 'pending',
                step: 0,
                timer: null,
                failingSince: null,
            };
            entry.timer = setTimeout(() => startCommit(entry), undoMs);
            entries.current.set(key, entry);
            setFailures((f) => f.filter((x) => x.key !== key));
            bump();
        },
        [bump, startCommit, undoMs],
    );

    const undo = useCallback(
        (key: string) => {
            const entry = entries.current.get(key);
            if (!entry || entry.phase !== 'pending') return;
            if (entry.timer) clearTimeout(entry.timer);
            entries.current.delete(key);
            bump();
        },
        [bump],
    );

    /** Call with the keys of the latest loaded queue: committed batches it no longer holds stop being hidden. */
    const syncQueue = useCallback(
        (queueKeys: ReadonlySet<string>) => {
            let changed = false;
            const dropped: Entry[] = [];
            for (const [key, entry] of entries.current) {
                if (queueKeys.has(key)) continue;
                if (entry.phase === 'done') {
                    entries.current.delete(key);
                    changed = true;
                } else if (entry.phase === 'pending') {
                    // Cancelled or released elsewhere during the undo window: never mark a gone batch ready.
                    if (entry.timer) clearTimeout(entry.timer);
                    entries.current.delete(key);
                    dropped.push(entry);
                    changed = true;
                }
            }
            if (dropped.length > 0 && mounted.current) {
                setFailures((f) => [...f, ...dropped.map((e) => ({ key: e.key, label: e.label || 'Comanda', message: 'ya no está en la cola (cancelada o entregada)' }))]);
            }
            if (changed) bump();
        },
        [bump],
    );

    const dismissFailure = useCallback((key: string) => setFailures((f) => f.filter((x) => x.key !== key)), []);

    useEffect(() => {
        mounted.current = true;
        const map = entries.current;
        // Re-arm undo windows cleared by a previous cleanup (StrictMode remount).
        for (const e of map.values()) {
            if (e.phase === 'pending' && !e.timer) e.timer = setTimeout(() => startCommit(e), Math.max(0, e.deadline - Date.now()));
        }
        return () => {
            mounted.current = false;
            // Undo windows are owned by the UI; in-flight commits and their retries are left to finish.
            for (const e of map.values()) if (e.phase === 'pending' && e.timer) {
                    clearTimeout(e.timer);
                    e.timer = null;
                }
        };
    }, [startCommit]);

    const hiddenRef = useRef<Set<string>>(new Set());
    const current = entries.current;
    if (current.size !== hiddenRef.current.size || [...current.keys()].some((k) => !hiddenRef.current.has(k))) {
        hiddenRef.current = new Set(current.keys());
    }
    const hiddenKeys = hiddenRef.current;
    const pending: PendingReady[] = [...entries.current.values()]
        .filter((e) => e.phase === 'pending')
        .map(({ key, label, waiter, deadline }) => ({ key, label, waiter, deadline }));

    return { hiddenKeys, pending, markReady, undo, committed, failures, syncQueue, dismissFailure };
}
