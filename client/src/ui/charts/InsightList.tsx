import { Link } from 'react-router-dom';
import { formatMoney } from '../format/number';
import type { Insight } from './types';
import './charts.css';

/** Hallazgos ordenados por impacto en C$ (el orden lo define el servidor). */
export function InsightList({ items }: { items: Insight[] }) {
  if (items.length === 0) return <p className="ui-chart__empty">Sin hallazgos en el periodo</p>;
  return (
    <ul className="ui-insights">
      {items.map((it) => (
        <li key={it.id} className={`ui-insights__item ui-insights__item--${it.severity}`}>
          <div className="ui-insights__body">
            <p className="ui-insights__message">{it.message}</p>
            <span className="ui-insights__impact">Impacto: {formatMoney(it.impactAmount)}</span>
          </div>
          <Link className="ui-insights__action" to={it.action.route}>{it.action.label}</Link>
        </li>
      ))}
    </ul>
  );
}
