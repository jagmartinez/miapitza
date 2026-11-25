import type { CSSProperties } from 'react';
import { formatMoney } from '../format/number';
import { waterfallBars } from './geometry';
import type { BridgeStep } from './types';
import './charts.css';

function barClass(step: BridgeStep): string {
  if (step.quality === 'unavailable') return 'ui-waterfall__bar ui-waterfall__bar--unavailable';
  if (step.quality === 'partial') return 'ui-waterfall__bar ui-waterfall__bar--partial';
  if (step.kind === 'negative') return 'ui-waterfall__bar ui-waterfall__bar--negative';
  if (step.key === 'operating') return `ui-waterfall__bar ${step.amount >= 0 ? 'ui-waterfall__bar--positive' : 'ui-waterfall__bar--negative'}`;
  return 'ui-waterfall__bar';
}

/** Un monto que no se pudo calcular se muestra como N/D, nunca como 0. */
function amountLabel(step: BridgeStep): string {
  if (step.quality === 'unavailable') return 'N/D';
  const text = formatMoney(step.kind === 'negative' ? -step.amount : step.amount);
  return step.quality === 'partial' ? `${text} (parcial)` : text;
}

/** Puente de la venta bruta a la utilidad operativa. */
export function WaterfallChart({ steps }: { steps: BridgeStep[] }) {
  if (steps.length === 0) return <p className="ui-chart__empty">Sin datos en el periodo</p>;
  const bars = waterfallBars(steps);
  const label = 'Puente de la venta bruta a la utilidad operativa';
  return (
    <figure className="ui-chart">
      <div className="ui-waterfall" role="img" aria-label={label} style={{ '--steps': steps.length } as CSSProperties}>
        {steps.map((s, i) => (
          <div key={s.key} className="ui-waterfall__col">
            <span className="ui-waterfall__amount">{amountLabel(s)}</span>
            <div className="ui-waterfall__plot">
              <div
                className={barClass(s)}
                style={{ '--b': bars[i].bottomPct, '--h': bars[i].heightPct } as CSSProperties}
              />
            </div>
            <span className="ui-waterfall__label">{s.label}</span>
          </div>
        ))}
      </div>
      <table className="ui-visually-hidden">
        <caption>{label}</caption>
        <thead><tr><th>Concepto</th><th>Monto</th></tr></thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.key}><td>{s.label}</td><td>{amountLabel(s)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
