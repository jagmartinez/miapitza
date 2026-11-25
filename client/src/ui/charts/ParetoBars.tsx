import type { CSSProperties } from 'react';
import { formatPercent } from '../format/number';
import './charts.css';

/** Ranking de margen por plato con el acumulado; los platos que pierden dinero llevan barra vacía. */
export function ParetoBars({ items, format }: {
  items: { name: string; value: number; cumulativePct: number }[];
  format(v: number): string;
}) {
  if (items.length === 0) return <p className="ui-chart__empty">Sin datos en el periodo</p>;
  const max = Math.max(...items.map((i) => (Number.isFinite(i.value) ? i.value : 0)), 0);
  return (
    <figure className="ui-chart">
      <ol className="ui-pareto" aria-label="Margen por plato con porcentaje acumulado">
        {items.map((it, idx) => {
          const w = max > 0 ? Math.max(Math.min((it.value / max) * 100, 100), 0) : 0;
          return (
            <li key={`${it.name}-${idx}`} className="ui-pareto__row">
              <span className="ui-pareto__name">{it.name}</span>
              <span className="ui-pareto__track" aria-hidden="true">
                <span className="ui-pareto__bar" style={{ '--w': Math.round(w * 100) / 100 } as CSSProperties} />
              </span>
              <span className="ui-pareto__nums">
                <span className="ui-pareto__value">{format(it.value)}</span>
                <span>{formatPercent(it.cumulativePct)} acum.</span>
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
