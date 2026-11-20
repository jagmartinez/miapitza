import type { OfflineQueue } from './offlineQueue';
import { offlineLabel, useOnline, usePendingSync } from './useOnline';

/** "Sin conexión · N pendientes" chip; renders nothing when online and in sync. */
export function OfflineIndicator({ queue }: { queue: OfflineQueue | null }) {
    const online = useOnline();
    const { pending, failed } = usePendingSync(queue);
    const label = offlineLabel(online, pending, failed);
    if (!label) return null;
    return (
        <div role="status" aria-live="polite" data-testid="offline-indicator" style={{ padding: '4px 10px', borderRadius: 12, fontSize: 12, background: online ? '#e8f0fe' : '#fdecea' }}>
            {label}
        </div>
    );
}
