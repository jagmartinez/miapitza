import type { RailEntry } from './orderModel';

/** Narrow vertical rail: 12-14px muted text; the selected entry is a filled grey block with weight 500, no border. */
export function CategoryRail({ entries, selected, onSelect }: { entries: RailEntry[]; selected: RailEntry['id'] | null; onSelect: (id: RailEntry['id']) => void }) {
    return (
        <nav className="rail" aria-label="Categorías">
            {entries.map((entry) => (
                <button key={String(entry.id)} type="button" className="rail-btn" aria-pressed={selected === entry.id} onClick={() => onSelect(entry.id)}>
                    {entry.name}
                </button>
            ))}
        </nav>
    );
}
