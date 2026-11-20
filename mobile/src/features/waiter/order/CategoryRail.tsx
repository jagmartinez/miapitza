import type { RailEntry } from './orderModel';

/** Vertical rail: text only, no colour. The selected entry is the one with a full border. */
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
