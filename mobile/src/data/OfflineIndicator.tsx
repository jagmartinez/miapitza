import { lazy, Suspense, useState } from 'react';
import type { OfflineQueue } from './offlineQueue';
import { offlineLabel, useOnline, usePendingSync } from './useOnline';
import './queueSheet.css';

const QueueSheet = lazy(() => import('./QueueSheet'));

/** "Sin conexión · N pendientes" chip; tapping it lists the queued items. Renders nothing when online and in sync. */
export function OfflineIndicator({ queue }: { queue: OfflineQueue | null }) {
    const online = useOnline();
    const { pending, failed } = usePendingSync(queue);
    const [open, setOpen] = useState(false);
    const label = offlineLabel(online, pending, failed);
    if (!label) return null;
    return (
        <div role="status" aria-live="polite" data-testid="offline-indicator">
            <button type="button" className="sync-chip" data-failed={failed > 0} disabled={!queue} onClick={() => setOpen(true)}>
                {label}
            </button>
            {open && queue && (
                <Suspense fallback={null}>
                    <QueueSheet queue={queue} onClose={() => setOpen(false)} />
                </Suspense>
            )}
        </div>
    );
}
