import type { ReactNode } from 'react';
import type { Tone } from './statusTone';
import './primitives.css';

export function Badge({ tone = 'neutral', dot = false, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`ui-badge ui-badge--${tone}`}>
      {dot && <span className="ui-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
