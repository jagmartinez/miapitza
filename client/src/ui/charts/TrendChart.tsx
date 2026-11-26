import { areaPath, linePath, niceMax } from './geometry';
import './charts.css';

const W = 640;
const H = 220;
const PAD = { left: 76, right: 12, top: 10, bottom: 26 };
const PW = W - PAD.left - PAD.right;
const PH = H - PAD.top - PAD.bottom;
const TICKS = 4;

/** Tendencia con comparación opcional y meta; sin datos muestra un mensaje en lugar del eje vacío. */
export function TrendChart({ buckets, current, previous, goal, format, ariaLabel, previousLabel }: {
  buckets: string[];
  current: number[];
  previous?: number[];
  goal?: number | null;
  format(v: number): string;
  ariaLabel: string;
  previousLabel: string;
}) {
  const prev = previous && previous.length > 0 ? previous : null;
  const hasData = buckets.length > 0 && [...current, ...(prev ?? [])].some((v) => Number.isFinite(v) && v !== 0);
  if (!hasData) return <p className="ui-chart__empty">Sin datos en el periodo</p>;

  const goalValue = goal != null && Number.isFinite(goal) && goal > 0 ? goal : null;
  const max = niceMax(Math.max(...current, ...(prev ?? []), goalValue ?? 0, 0));
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => (max * i) / TICKS);
  const step = Math.max(1, Math.ceil(buckets.length / 6));
  const goalY = goalValue != null ? PAD.top + PH - (Math.min(goalValue, max) / max) * PH : null;

  return (
    <figure className="ui-chart">
      <svg className="ui-chart__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} focusable="false">
        {ticks.map((t) => {
          const y = PAD.top + PH - (t / max) * PH;
          return (
            <g key={t}>
              <line className="ui-chart__axis" x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} />
              <text className="ui-chart__tick" x={PAD.left - 8} y={y + 4} textAnchor="end">{format(t)}</text>
            </g>
          );
        })}
        {buckets.map((b, i) => (i % step === 0 ? (
          <text
            key={`${b}-${i}`}
            className="ui-chart__tick"
            x={PAD.left + (buckets.length === 1 ? PW / 2 : (i * PW) / (buckets.length - 1))}
            y={H - 6}
            textAnchor="middle"
          >
            {b}
          </text>
        ) : null))}
        <g transform={`translate(${PAD.left} ${PAD.top})`}>
          <path d={areaPath(current, PW, PH, max)} fill="var(--ui-primary)" opacity="0.1" />
          {prev ? <path d={linePath(prev, PW, PH, max)} fill="none" stroke="var(--ui-text-muted)" strokeWidth="1.5" strokeDasharray="4 3" /> : null}
          <path d={linePath(current, PW, PH, max)} fill="none" stroke="var(--ui-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </g>
        {goalY != null ? (
          <line x1={PAD.left} x2={W - PAD.right} y1={goalY} y2={goalY} stroke="var(--ui-warning)" strokeWidth="1.5" strokeDasharray="6 4" />
        ) : null}
      </svg>
      <ul className="ui-chart__legend">
        <li><span className="ui-chart__swatch" aria-hidden="true" />Periodo actual</li>
        {prev ? <li><span className="ui-chart__swatch ui-chart__swatch--muted" aria-hidden="true" />{previousLabel}</li> : null}
        {goalValue != null ? <li><span className="ui-chart__swatch ui-chart__swatch--goal" aria-hidden="true" />Meta ({format(goalValue)})</li> : null}
      </ul>
      <table className="ui-visually-hidden">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr><th>Periodo</th><th>Actual</th>{prev ? <th>{previousLabel}</th> : null}</tr>
        </thead>
        <tbody>
          {buckets.map((b, i) => (
            <tr key={`${b}-${i}`}>
              <td>{b}</td>
              <td>{format(current[i] ?? 0)}</td>
              {prev ? <td>{prev[i] == null ? 'N/D' : format(prev[i])}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
