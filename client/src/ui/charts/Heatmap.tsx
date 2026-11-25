import type { CSSProperties, ReactNode } from 'react';
import './charts.css';

/** Mapa de calor filas × columnas; la intensidad es relativa al mayor valor. */
export function Heatmap({ rows, columns, format, caption }: {
  rows: { label: string; values: number[] }[];
  columns: string[];
  format(v: number): string;
  caption?: ReactNode;
}) {
  const all = rows.flatMap((r) => r.values).filter((v) => Number.isFinite(v));
  const max = all.length ? Math.max(...all) : 0;
  if (rows.length === 0 || columns.length === 0 || max <= 0) {
    return <p className="ui-chart__empty">Sin datos en el periodo</p>;
  }
  const label = 'Mapa de calor de ventas por día y hora';
  return (
    <figure className="ui-chart">
      <div
        className="ui-heatmap"
        role="img"
        aria-label={label}
        style={{ gridTemplateColumns: `minmax(0, auto) repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        <span />
        {columns.map((c, i) => <span key={c} className={`ui-heatmap__head${i % 6 === 0 ? '' : ' ui-heatmap__head--minor'}`}>{c}</span>)}
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'contents' }}>
            <span className="ui-heatmap__rowlabel">{r.label}</span>
            {columns.map((c, i) => {
              const v = r.values[i] ?? 0;
              const pct = Math.round((Math.max(v, 0) / max) * 100);
              return (
                <span
                  key={c}
                  className="ui-heatmap__cell"
                  title={`${r.label} ${c}: ${format(v)}`}
                  style={{ '--heat': `${pct}%` } as CSSProperties}
                />
              );
            })}
          </div>
        ))}
      </div>
      {caption ? <figcaption className="ui-heatmap__caption">{caption}</figcaption> : null}
      <table className="ui-visually-hidden">
        <caption>{label}</caption>
        <thead><tr><th>Día</th>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th>{r.label}</th>
              {columns.map((c, i) => <td key={c}>{format(r.values[i] ?? 0)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
