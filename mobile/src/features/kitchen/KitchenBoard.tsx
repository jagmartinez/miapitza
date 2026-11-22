import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconHistory } from '../../ui/Icon';
import { newIdempotencyKey } from '@web/utils/idempotency';
import { kitchenAuthStatus } from '../../core/kitchenAuth';
import { KitchenActionError, type KitchenApi } from './kitchenApi';
import { KitchenCard } from './KitchenCard';
import { kitchenLabel } from './kitchenLabel';
import { playKitchenChime } from './kitchenSound';
import { batchKey, type KitchenBatch } from './kitchenTypes';
import { ReadyToasts, type ActionFailure } from './ReadyToasts';
import { mergeRecent, RecentSheet } from './RecentSheet';
import { useKitchenQueue, type KitchenRealtime } from './useKitchenQueue';
import { useKioskExit } from './useKioskExit';
import { useReadyCommit } from './useReadyCommit';
import { useSessionWake } from './useSessionWake';
import './kitchen.css';

export type KitchenConnection = 'online' | 'reconnecting' | 'offline' | 'unavailable';

const CONNECTION_TEXT: Record<KitchenConnection, string> = {
    online: 'En línea',
    reconnecting: 'Reconectando…',
    offline: 'Sin conexión',
    unavailable: 'Cuenta de cocina no disponible — avisa al administrador',
};

const MAX_AUTH_RETRIES = 5;
/** Resolves when the session is usable again (auth back online / new session). */
function waitForSession(wake: (resume: () => void) => () => void): Promise<void> {
    return new Promise((resolve) => {
        const cancel = wake(resolve);
        // Already online (the 401 outran the status event): just retry shortly.
        if (kitchenAuthStatus() === 'online') {
            cancel();
            setTimeout(resolve, 2000);
        }
    });
}

const SOUND_KEY = 'kds.sound';
const readSound = (): boolean => {
    try {
        return localStorage.getItem(SOUND_KEY) !== 'off';
    } catch {
        return true;
    }
};
const clock = (ms: number) => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

interface Props {
    api: KitchenApi;
    realtime: KitchenRealtime;
    canManage: boolean;
    connection: KitchenConnection;
    undoMs?: number;
    /** False until the kitchen has had a session: no queue request goes out unauthenticated. Default true. */
    sessionReady?: boolean;
    /** Changes when a new session arrives; wakes work paused on authentication. */
    sessionKey?: string | null;
}

export function KitchenBoard({ api, realtime, canManage, connection, undoMs, sessionReady = true, sessionKey = null }: Props) {
    const kiosk = useKioskExit();
    const queue = useKitchenQueue(api, realtime, { enabled: sessionReady });
    const commit = useReadyCommit(api, undoMs === undefined ? { sessionKey } : { undoMs, sessionKey });
    const wake = useSessionWake(sessionKey);
    const [now, setNow] = useState(() => Date.now());
    const [sound, setSound] = useState(readSound);
    const [starting, setStarting] = useState<ReadonlySet<string>>(new Set());
    const [startFailures, setStartFailures] = useState<ActionFailure[]>([]);
    const [serverRecent, setServerRecent] = useState<KitchenBatch[]>([]);
    const [showRecent, setShowRecent] = useState(false);
    const soundRef = useRef(sound);
    soundRef.current = sound;

    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => queue.onNewBatches(() => soundRef.current && playKitchenChime()), [queue.onNewBatches]);

    const { batches, lastLoadedAt } = queue;
    const { syncQueue } = commit;
    useEffect(() => {
        if (lastLoadedAt !== undefined) syncQueue(new Set(batches.map(batchKey)));
    }, [batches, lastLoadedAt, syncQueue]);

    const committedCount = commit.committed.length;
    const refreshRecent = useCallback(() => {
        api.recent(10).then(setServerRecent, () => {});
    }, [api]);
    useEffect(() => {
        if (sessionReady) refreshRecent();
    }, [refreshRecent, committedCount, sessionReady]);

    const toggleSound = () => {
        const next = !sound;
        setSound(next);
        try {
            localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
        } catch {
            /* preference just won't persist */
        }
    };

    const start = useCallback(
        async (b: KitchenBatch) => {
            const key = batchKey(b);
            setStarting((s) => new Set(s).add(key));
            setStartFailures((f) => f.filter((x) => x.key !== key));
            try {
                // Same idempotency key across retries; an auth error means the session is being renewed.
                const idem = newIdempotencyKey();
                for (let attempt = 0; ; attempt++) {
                    try {
                        await api.start(b, idem);
                        break;
                    } catch (cause) {
                        if (!(cause instanceof KitchenActionError && cause.kind === 'auth' && attempt < MAX_AUTH_RETRIES)) throw cause;
                        await waitForSession(wake);
                    }
                }
            } catch (cause) {
                if (!(cause instanceof KitchenActionError && cause.kind === 'already-done')) {
                    const message = cause instanceof KitchenActionError ? cause.message : 'Sin conexión con el servidor.';
                    setStartFailures((f) => [...f.filter((x) => x.key !== key), { key, label: kitchenLabel(b), message, action: 'start' }]);
                    setStarting((s) => {
                        const n = new Set(s);
                        n.delete(key);
                        return n;
                    });
                    return;
                }
            }
            // Keep "Iniciando…" until the refreshed queue reflects the new state (no flicker back to Iniciar).
            await queue.reload();
            setStarting((s) => {
                const n = new Set(s);
                n.delete(key);
                return n;
            });
        },
        [api, queue.reload, wake],
    );

    const visible = batches.filter((b) => !commit.hiddenKeys.has(batchKey(b)));
    const recent = mergeRecent(commit.committed, serverRecent);
    const failures: ActionFailure[] = [
        ...commit.failures.map((f) => ({ ...f, action: 'ready' as const })),
        ...startFailures,
    ];
    const dismiss = (key: string) => {
        commit.dismissFailure(key);
        setStartFailures((f) => f.filter((x) => x.key !== key));
    };

    const empty = queue.status === 'ready' && visible.length === 0;
    const dot = connection === 'online' ? 'is-online' : connection === 'offline' || connection === 'unavailable' ? 'is-offline' : 'is-reconnecting';
    const memoConfig = useMemo(() => queue.config, [queue.config]);

    return (
        <div className="kitchen">
            <header className="kitchen-bar">
                <strong className="kitchen-title" {...kiosk.handlers}>Cocina</strong>
                <span className="kitchen-queue">{`· ${visible.length} en cola`}</span>
                <span className="kitchen-clock">{clock(now)}</span>
                <span className={`kitchen-conn ${dot}`} role="status">
                    <i aria-hidden="true" />
                    {CONNECTION_TEXT[connection]}
                </span>
                <span className="kitchen-spacer" />
                <button type="button" className="kitchen-link" aria-pressed={sound} onClick={toggleSound}>
                    {sound ? 'Sonido: sí' : 'Sonido: no'}
                </button>
                <button type="button" className="kitchen-link" onClick={() => {
                        refreshRecent();
                        setShowRecent(true);
                    }}>
                    <IconHistory size={18} stroke={1.5} aria-hidden />
                    {`Recientes (${recent.length})`}
                </button>
            </header>

            {queue.status === 'error' && (
                <div className="kitchen-error" role="alert">
                    <span>{`No se pudo cargar la cola: ${queue.error ?? ''}`}</span>
                    <button type="button" className="kitchen-btn" onClick={() => void queue.reload()}>
                        Reintentar
                    </button>
                </div>
            )}

            {queue.status === 'loading' && <p className="kitchen-msg">Cargando comandas…</p>}
            {empty && <p className="kitchen-msg">Sin comandas</p>}

            {visible.length > 0 && (
                <div className="kitchen-row">
                    {visible.map((b) => (
                        <KitchenCard
                            key={batchKey(b)}
                            batch={b}
                            config={memoConfig}
                            now={now}
                            canManage={canManage}
                            starting={starting.has(batchKey(b))}
                            onStart={() => void start(b)}
                            onReady={() => commit.markReady(b)}
                        />
                    ))}
                </div>
            )}

            <ReadyToasts pending={commit.pending} failures={failures} onUndo={commit.undo} onDismiss={dismiss} />
            {kiosk.sheet}
            {showRecent && <RecentSheet batches={recent} onClose={() => setShowRecent(false)} />}
        </div>
    );
}
