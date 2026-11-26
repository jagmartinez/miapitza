import { useState } from 'react';
import { Sheet } from '../tables/Sheet';
import { money, type ModifierGroup, type Product } from './orderModel';

export interface ModifierChoice {
    modifierIds: number[];
    modifierNames: string[];
    modifierTotal: number;
    notes: string;
}

/** Bottom sheet: required/optional modifier groups plus a free note. "Agregar" stays off until every minimum is met. */
export function ModifierSheet({ product, groups, onConfirm, onClose }: { product: Product; groups: ModifierGroup[]; onConfirm: (choice: ModifierChoice) => void; onClose: () => void }) {
    const [picked, setPicked] = useState<Record<number, number[]>>({});
    const [notes, setNotes] = useState('');

    const toggle = (group: ModifierGroup, id: number) =>
        setPicked((prev) => {
            const current = prev[group.id] ?? [];
            if (current.includes(id)) return { ...prev, [group.id]: current.filter((x) => x !== id) };
            if (group.maxSelect === 1) return { ...prev, [group.id]: [id] }; // a single choice swaps
            if (group.maxSelect != null && current.length >= group.maxSelect) return prev;
            return { ...prev, [group.id]: [...current, id] };
        });

    const options = groups.flatMap((g) => g.modifiers);
    const chosen = groups.flatMap((g) => picked[g.id] ?? []);
    const missing = groups.some((g) => (picked[g.id]?.length ?? 0) < g.minSelect);
    const extra = chosen.reduce((sum, id) => sum + (options.find((o) => o.id === id)?.price ?? 0), 0);

    const confirm = () =>
        onConfirm({
            modifierIds: chosen,
            modifierNames: chosen.map((id) => options.find((o) => o.id === id)?.name ?? '').filter(Boolean),
            modifierTotal: extra,
            notes,
        });

    return (
        <Sheet label={product.name} onClose={onClose}>
            <h2 className="sheet-title">{product.name}</h2>
            {groups.map((group) => (
                <fieldset key={group.id} className="mod-group">
                    <legend className="mod-legend">
                        {group.name}
                        <span className="muted">{group.minSelect > 0 ? ' · obligatorio' : ' · opcional'}</span>
                    </legend>
                    <div className="mod-options">
                        {group.modifiers.map((m) => (
                            <button key={m.id} type="button" className="btn mod-option" aria-pressed={(picked[group.id] ?? []).includes(m.id)} onClick={() => toggle(group, m.id)}>
                                {m.name}
                                {m.price > 0 && <span className="muted">{` +${money(m.price)}`}</span>}
                            </button>
                        ))}
                    </div>
                </fieldset>
            ))}
            <label className="field">
                Nota
                <input value={notes} maxLength={200} placeholder="Ej. sin cebolla" onChange={(e) => setNotes(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary sheet-main" disabled={missing} onClick={confirm}>
                {`Agregar · ${money(product.price + extra)}`}
            </button>
        </Sheet>
    );
}
