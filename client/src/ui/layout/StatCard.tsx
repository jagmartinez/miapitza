import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Tone } from '../primitives/statusTone';
import './layout.css';

/** Tarjeta de indicador: valor + contexto obligatorio (sin conteos sueltos). */
export function StatCard({ label, value, context, tone = 'neutral', action }: {
  label: string;
  value: ReactNode;
  context: ReactNode;
  tone?: Tone;
  action?: { label: string; to?: string; onClick?(): void };
}) {
  return (
    <section className={`ui-statcard ui-statcard--${tone}`} aria-label={label}>
      <p className="ui-statcard__label">{label}</p>
      <p className="ui-statcard__value">{value}</p>
      <p className="ui-statcard__context">{context}</p>
      {action ? (
        action.to ? (
          <Link className="ui-statcard__action" to={action.to}>{action.label}</Link>
        ) : (
          <button type="button" className="ui-statcard__action" onClick={action.onClick}>{action.label}</button>
        )
      ) : null}
    </section>
  );
}
