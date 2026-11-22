import { useEffect, useRef, useState } from 'react';
import type { PendingReady, ReadyFailure } from './useReadyCommit';

const MAX_PENDING_SHOWN = 2;
const FAILURE_TTL_MS = 8_000;

export interface ActionFailure extends ReadyFailure {
    action: 'start' | 'ready';
}

interface Props {
    pending: PendingReady[];
    failures: Array<ActionFailure>;
    onUndo: (key: string) => void;
    onDismiss: (key: string) => void;
}

/**
 * Fixed-height band below the cards, always rendered so the card row never changes height.
 * Pending undo countdowns come first (newest 2, "+n" for the rest) and are never displaced;
 * at most one failure (the newest) shares the band, and failures expire after 8 s.
 */
export function ReadyToasts({ pending, failures, onUndo, onDismiss }: Props) {
    const [now, setNow] = useState(() => Date.now());
    const hasPending = pending.length > 0;
    useEffect(() => {
        if (!hasPending) return;
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(t);
    }, [hasPending]);

    const dismissRef = useRef(onDismiss);
    dismissRef.current = onDismiss;
    const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const failureKeys = failures.map((f) => f.key).join('|');
    useEffect(() => {
        const live = new Set(failures.map((f) => f.key));
        for (const [key, t] of timers.current) {
            if (!live.has(key)) {
                clearTimeout(t);
                timers.current.delete(key);
            }
        }
        for (const key of live) {
            if (timers.current.has(key)) continue;
            timers.current.set(
                key,
                setTimeout(() => {
                    timers.current.delete(key);
                    dismissRef.current(key);
                }, FAILURE_TTL_MS),
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [failureKeys]);
    useEffect(
        () => () => {
            for (const t of timers.current.values()) clearTimeout(t);
            timers.current.clear();
        },
        [],
    );

    const newestFirst = [...pending].sort((a, b) => b.deadline - a.deadline);
    const shown = newestFirst.slice(0, MAX_PENDING_SHOWN);
    const extra = newestFirst.length - shown.length;
    const failure = failures.length > 0 ? failures[failures.length - 1] : undefined;

    return (
        <div className="kitchen-toasts" data-testid="kitchen-toasts" aria-live="polite">
            {shown.map((p) => (
                <div className={`kitchen-toast${shown.length === 1 ? ' is-solo' : ''}`} key={`p-${p.key}`} role="status">
                    <span>{`${p.label || 'Comanda'} lista · aviso a ${p.waiter}`}</span>
                    <button type="button" onClick={() => onUndo(p.key)}>
                        {`Deshacer ${Math.max(0, Math.ceil((p.deadline - now) / 1000))}`}
                    </button>
                </div>
            ))}
            {extra > 0 && <span className="kitchen-toast-more">{`+${extra}`}</span>}
            {failure && (
                <div className="kitchen-toast is-failure" key={`f-${failure.key}`} role="alert">
                    <span>{`No se pudo ${failure.action === 'start' ? 'iniciar' : 'marcar'} ${failure.label || 'Comanda'}: ${failure.message}`}</span>
                    <button type="button" onClick={() => onDismiss(failure.key)}>
                        Cerrar
                    </button>
                </div>
            )}
        </div>
    );
}
