import { useCallback, useEffect, useState } from 'react';
import { Sheet } from '../features/waiter/tables/Sheet';
import { itemStatus, itemTime, itemTitle } from './queueLabels';
import type { OfflineQueue } from './offlineQueue';
import type { SyncItem } from './types';
import './queueSheet.css';

/** The waiter's own queued work: why it is waiting, and Reintentar / Descartar for each item. Never another user's. */
export default function QueueSheet({ queue, onClose }: { queue: OfflineQueue; onClose: () => void }) {
    const [items, setItems] = useState<SyncItem[] | null>(null);

    const reload = useCallback(() => {
        queue.listItems().then(setItems, () => setItems([]));
    }, [queue]);

    useEffect(() => {
        reload();
        const off = queue.subscribe(reload);
        const offSynced = queue.onSynced(reload);
        return () => {
            off();
            offSynced();
        };
    }, [queue, reload]);

    // Nothing left to review: the list has done its job.
    useEffect(() => {
        if (items && items.length === 0) onClose();
    }, [items, onClose]);

    const act = async (fn: () => Promise<void>) => {
        await fn();
        reload();
    };

    return (
        <Sheet label="Pendientes de sincronizar" onClose={onClose}>
            <h2 className="sheet-title">Pendientes de sincronizar</h2>
            <p className="sheet-sub muted">Lo que queda en este equipo hasta que se envíe al servidor.</p>
            <ul className="queue-list">
                {(items ?? []).map((item) => (
                    <li key={item.id} className="queue-item" data-status={item.status}>
                        <div className="queue-text">
                            <strong>{itemTitle(item)}</strong>
                            <span className="muted">{`${itemTime(item)} · ${itemStatus(item)}`}</span>
                            {item.status === 'failed' && item.lastError && <span className="queue-error">{item.lastError}</span>}
                        </div>
                        <div className="queue-actions">
                            {item.status !== 'processing' && (
                                <button type="button" className="btn" onClick={() => void act(() => queue.retry(item.id!))}>
                                    Reintentar
                                </button>
                            )}
                            {item.status !== 'processing' && (
                                <button type="button" className="btn" onClick={() => void act(() => queue.discard(item.id!))}>
                                    Descartar
                                </button>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
            <button type="button" className="btn sheet-main" onClick={onClose}>
                Cerrar
            </button>
        </Sheet>
    );
}
