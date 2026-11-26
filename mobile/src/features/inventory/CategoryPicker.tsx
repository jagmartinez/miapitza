import { IconCheck } from '../../ui/Icon';
import type { CountCategory } from './inventoryTypes';

export interface CategoryPickerItem extends CountCategory {
    counted: number;
    total: number;
}

export interface CategoryPickerProps {
    items: CategoryPickerItem[];
    selectedId: number | null;
    onPick: (categoryId: number | null) => void;
}

/** The dropdown list laid over the products: every category with its N/M, a progress bar and a check once complete. */
export function CategoryPicker({ items, selectedId, onPick }: CategoryPickerProps) {
    return (
        <ul className="cnt-cats" role="listbox" aria-label="Categorías">
            {items.map((c) => {
                const done = c.total > 0 && c.counted === c.total;
                return (
                    <li key={String(c.categoryId)} role="presentation">
                        <button type="button" role="option" aria-selected={c.categoryId === selectedId} className="cnt-cat" data-done={done} onClick={() => onPick(c.categoryId)}>
                            <span className="cnt-cat-name">{c.name}</span>
                            <span className="cnt-cat-count">
                                {c.counted}/{c.total}
                            </span>
                            <span className="cnt-cat-check" aria-label={done ? 'Completa' : undefined}>
                                {done && <IconCheck size={16} stroke={1.5} aria-hidden />}
                            </span>
                            <span className="inv-progress cnt-cat-bar" data-done={done} aria-hidden="true">
                                <span className="inv-progress-fill" style={{ width: `${c.total > 0 ? Math.round((c.counted / c.total) * 100) : 0}%`, display: 'block' }} />
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
