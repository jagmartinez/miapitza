import { useCallback, useEffect, useRef, useState } from 'react';
import { newIdempotencyKey } from '@web/utils/idempotency';
import { appEvents } from '../../core/events';
import { kitchenAuthStatus } from '../../core/kitchenAuth';
import { KitchenActionError, type KitchenApi } from './kitchenApi';
import { kitchenLabel } from './kitchenLabel';
import { batchKey, type KitchenBatch } from './kitchenTypes';

export const READY_UNDO_MS = 5000;
const MIN_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30_000;
const MAX_COMMITTED = 10;

export interface PendingReady {
    key: string;
    label: string;
    waiter: string;
    deadline: number;
}
export interface ReadyFailure {
    key: string;
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
}

type ReadyApi = Pick<KitchenApi, 'ready' | 'release'>;

/**
 * "Listo" with a deferred commit: the card hides at once, the user has `undoMs` to undo,
 * then ready -> release run in sequence with idempotency keys fixed at markReady time.
 */
export function useReadyCommit(api: ReadyApi, opts: { undoMs?: number } = {}) {
    const undoMs = opts.undoMs ?? READY_UNDO_MS;
    const apiRef = useRef(api);
    apiRef.current = api;
    const entries = useRef(new Map<string, Entry>());
    const mounted = useRef(true);
    const [, setVersion] = useState(0);
    const [committed, setCommitted] = useState<KitchenBatch[]>([]);
    const [failures, setFailures] = useState<ReadyFailure[]>([]);
    const bump = useCallback(() => {
        if (mounted.current) setVersion((v) => v + 1);
    }, []);

    const waitForOnline = useCallback(
        (entry: Entry, resume: () => void) => {
            const off = appEvents.on('kitchen-auth-status', (status) => {
                if (status !== 'online') return;
                off();
                resume();
            });
            // If the session already came back before we subscribed, do not wait forever.
            if (kitchenAuthStatus() === 'online') {
                off();
                entry.timer = setTimeout(resume, MIN_BACKOFF_MS);
            }
        },
        [],
    );

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
                    const err = cause instanceof KitchenActionError ? cause : new KitchenActionError('network', 'Sin conexión con el servidor.');
                    if (err.kind === 'already-done') {
                        entry.step = (entry.step + 1) as 0 | 1;
                        continue;
                    }
                    if (err.kind === 'auth') {
                        waitForOnline(entry, () => void run(entry, MIN_BACKOFF_MS));
                        return;
                    }
                    if (err.kind === 'network') {
                        entry.timer = setTimeout(() => void run(entry, Math.min(backoff * 2, MAX_BACKOFF_MS)), backoff);
                        return;
                    }
                    entries.current.delete(entry.key);
                    if (mounted.current) setFailures((f) => [...f.filter((x) => x.key !== entry.key), { key: entry.key, message: err.message }]);
                    bump();
                    return;
                }
                entry.step = (entry.step + 1) as 0 | 1;
            }
            entry.phase = 'done';
            if (mounted.current) setCommitted((c) => [entry.batch, ...c.filter((b) => batchKey(b) !== entry.key)].slice(0, MAX_COMMITTED));
            bump();
        },
        [bump, waitForOnline],
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
            for (const [key, entry] of entries.current) {
                if (entry.phase === 'done' && !queueKeys.has(key)) {
                    entries.current.delete(key);
                    changed = true;
                }
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

    const hiddenKeys = new Set(entries.current.keys());
    const pending: PendingReady[] = [...entries.current.values()]
        .filter((e) => e.phase === 'pending')
        .map(({ key, label, waiter, deadline }) => ({ key, label, waiter, deadline }));

    return { hiddenKeys, pending, markReady, undo, committed, failures, syncQueue, dismissFailure };
}
