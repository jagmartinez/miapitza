export interface DenomRow {
    key: string;
    /** Accessible name, e.g. "Billete C$ 100". */
    name: string;
    label: string;
    count: number;
    subtotal: string;
    selected: boolean;
}

export interface DenominationColumnProps {
    title: string;
    groups: { heading?: string; rows: DenomRow[] }[];
    onSelect: (key: string) => void;
    /** Totals under the column (already formatted, one line each). */
    footer: { label: string; value: string }[];
}

/** One currency column of the arqueo: tap a denomination to type its count; subtotals and totals on one line. */
export function DenominationColumn({ title, groups, onSelect, footer }: DenominationColumnProps) {
    return (
        <section className="cash-dcol" aria-label={title}>
            <h2 className="cash-h">{title}</h2>
            {groups.map((g, i) => (
                <div key={g.heading ?? i} className="cash-dlist">
                    {g.heading && <span className="muted cash-dgroup">{g.heading}</span>}
                    {g.rows.map((r) => (
                        <button key={r.key} type="button" className="btn cash-drow" aria-pressed={r.selected} aria-label={r.name} onClick={() => onSelect(r.key)}>
                            <span className="cash-num">{r.label}</span>
                            <strong className="cash-num">{`× ${r.count}`}</strong>
                            <span className="muted cash-num cash-dsub">{r.subtotal}</span>
                        </button>
                    ))}
                </div>
            ))}
            <dl className="cash-lines cash-dfoot">
                {footer.map((f) => (
                    <div key={f.label}>
                        <dt>{f.label}</dt>
                        <dd className="cash-num">{f.value}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
