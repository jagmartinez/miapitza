import type { Tone } from '../primitives/statusTone';
import { sparkPoints } from './geometry';
import './charts.css';

const TONE_COLOR: Record<Tone, string> = {
  neutral: 'var(--ui-text-muted)',
  primary: 'var(--ui-primary)',
  success: 'var(--ui-success)',
  warning: 'var(--ui-warning)',
  danger: 'var(--ui-danger)',
};

/** Línea mínima de tendencia para tarjetas; decorativa (el valor ya está en la tarjeta). */
export function Sparkline({ values, tone = 'primary', width = 96, height = 28 }: {
  values: number[];
  tone?: Tone;
  width?: number;
  height?: number;
}) {
  const pts = sparkPoints(values, width, height - 4);
  if (!pts) return null;
  return (
    <svg className="ui-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" focusable="false">
      <polyline points={pts} transform="translate(0 2)" fill="none" stroke={TONE_COLOR[tone]} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
