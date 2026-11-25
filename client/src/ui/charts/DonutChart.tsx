import { formatPercent } from '../format/number';
import { donutSegments } from './geometry';
import './charts.css';

/** Dona con leyenda; `share` en porcentaje (se normaliza a 100). `tone` es un color de token CSS. */
export function DonutChart({ segments, ariaLabel }: {
  segments: { label: string; share: number; tone: string }[];
  ariaLabel: string;
}) {
  const total = segments.reduce((s, x) => s + (Number.isFinite(x.share) && x.share > 0 ? x.share : 0), 0);
  if (segments.length === 0 || total <= 0) return <p className="ui-chart__empty">Sin datos en el periodo</p>;
  const shares = segments.map((s) => ((Number.isFinite(s.share) && s.share > 0 ? s.share : 0) / total) * 100);
  const geo = donutSegments(shares);
  return (
    <figure className="ui-chart ui-donut">
      <svg className="ui-donut__svg" viewBox="0 0 42 42" role="img" aria-label={ariaLabel} focusable="false">
        <circle className="ui-donut__track" cx="21" cy="21" r="15.9155" pathLength={100} />
        {segments.map((s, i) => (
          <circle
            key={s.label}
            className="ui-donut__seg"
            cx="21"
            cy="21"
            r="15.9155"
            pathLength={100}
            stroke={s.tone}
            strokeDasharray={geo[i].dasharray}
            strokeDashoffset={geo[i].dashoffset}
          />
        ))}
      </svg>
      <ul className="ui-donut__legend">
        {segments.map((s, i) => (
          <li key={s.label}>
            <span className="ui-donut__dot" style={{ background: s.tone }} aria-hidden="true" />
            <span className="ui-donut__name">{s.label}</span>
            <span className="ui-donut__pct">{formatPercent(shares[i])}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
