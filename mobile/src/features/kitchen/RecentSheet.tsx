import { kitchenLabel } from './kitchenLabel';
import { batchKey, type KitchenBatch } from './kitchenTypes';

const hhmm = (iso?: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
};

/** Last 10 released batches: local commits first, then the server list, deduped by key. */
export function mergeRecent(local: KitchenBatch[], server: KitchenBatch[]): KitchenBatch[] {
    const seen = new Set<string>();
    const out: KitchenBatch[] = [];
    for (const b of [...local, ...server]) {
        const key = batchKey(b);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(b);
    }
    return out.slice(0, 10);
}

export function RecentSheet({ batches, onClose }: { batches: KitchenBatch[]; onClose: () => void }) {
    return (
        <div className="kds-sheet-backdrop" onClick={onClose}>
            <div className="kds-sheet kitchen-recent" role="dialog" aria-modal="true" aria-label="Recientes" onClick={(e) => e.stopPropagation()}>
                <header className="kitchen-recent-head">
                    <strong>Recientes</strong>
                    <button type="button" onClick={onClose}>
                        Cerrar
                    </button>
                </header>
                {batches.length === 0 ? (
                    <p className="muted">Sin entregas recientes</p>
                ) : (
                    <ul>
                        {batches.map((b) => (
                            <li key={batchKey(b)}>
                                <strong>{kitchenLabel(b)}</strong>
                                <span>{b.user?.name ?? ''}</span>
                                <span>{hhmm(b.kitchenReleasedAt ?? b.kitchenReadyAt)}</span>
                                <span>{`${b.items.length} ${b.items.length === 1 ? 'línea' : 'líneas'}`}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
