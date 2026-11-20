import { agoLabel, sumQuantity, type ServerLine } from './orderModel';

/** Amber-bordered card above the ticket: what the kitchen finished and nobody has taken to the table. */
export function ReadyCard({ lines, now, busy, onDeliver }: { lines: ServerLine[]; now: number; busy: boolean; onDeliver: (itemIds: number[]) => void }) {
    if (lines.length === 0) return null;
    const total = sumQuantity(lines);
    const oldest = lines.reduce<string | null>((acc, l) => (l.finishedAt && (!acc || l.finishedAt < acc) ? l.finishedAt : acc), null);
    const ago = oldest ? ` · ${agoLabel(oldest, now)}` : '';
    return (
        <section className="ready-card" aria-label="Listo para entregar">
            <h3 className="ready-card-title">{`Listo para entregar · ${total}${ago}`}</h3>
            <ul className="ready-card-list">
                {lines.map((l) => (
                    <li key={l.id} className="ready-card-row">
                        <span className="ready-card-name">{`${l.quantity} × ${l.name}`}</span>
                        <button type="button" className="btn check-btn" aria-label={`Entregar ${l.name}`} disabled={busy} onClick={() => onDeliver([l.id])}>
                            ✓
                        </button>
                    </li>
                ))}
            </ul>
            <button type="button" className="btn btn-primary ready-card-all" disabled={busy} onClick={() => onDeliver(lines.map((l) => l.id))}>
                {`Entregar todo · ${total}`}
            </button>
        </section>
    );
}
