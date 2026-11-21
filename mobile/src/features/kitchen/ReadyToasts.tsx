import { useEffect, useState } from 'react';
import type { PendingReady, ReadyFailure } from './useReadyCommit';

const MAX_TOASTS = 3;

export interface ActionFailure extends ReadyFailure {
    label: string;
}

interface Props {
    pending: PendingReady[];
    failures: Array<ActionFailure>;
    onUndo: (key: string) => void;
    onDismiss: (key: string) => void;
}

/** Stacked toasts in their own band below the cards (max 3): failures first so they are never hidden, then undo countdowns. */
export function ReadyToasts({ pending, failures, onUndo, onDismiss }: Props) {
    const [now, setNow] = useState(() => Date.now());
    const hasPending = pending.length > 0;
    useEffect(() => {
        if (!hasPending) return;
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(t);
    }, [hasPending]);

    const rows = [
        ...failures.map((f) => ({ kind: 'failure' as const, f })),
        ...pending.map((p) => ({ kind: 'pending' as const, p })),
    ].slice(0, MAX_TOASTS);
    if (rows.length === 0) return null;
    return (
        <div className="kitchen-toasts" aria-live="polite">
            {rows.map((row) =>
                row.kind === 'pending' ? (
                    <div className="kitchen-toast" key={`p-${row.p.key}`} role="status">
                        <span>{`${row.p.label} lista · aviso a ${row.p.waiter}`}</span>
                        <button type="button" onClick={() => onUndo(row.p.key)}>
                            {`Deshacer (${Math.max(0, Math.ceil((row.p.deadline - now) / 1000))}s)`}
                        </button>
                    </div>
                ) : (
                    <div className="kitchen-toast is-failure" key={`f-${row.f.key}`} role="alert">
                        <span>{`No se pudo marcar ${row.f.label}: ${row.f.message}`}</span>
                        <button type="button" onClick={() => onDismiss(row.f.key)}>
                            Cerrar
                        </button>
                    </div>
                ),
            )}
        </div>
    );
}
