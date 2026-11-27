import type { ProductionOrder } from '../types';

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/** Variación real vs. estimado; null si la orden no terminó o falta alguno de los dos costos (nunca se asume 0). */
export function costVariationOf(order: ProductionOrder): { delta: number; pct: number } | null {
  if (order.status !== 'FINISHED') return null;
  const estimated = num(order.estimatedCost);
  const real = num(order.realCost);
  if (!(estimated > 0) || !(real > 0)) return null;
  return { delta: real - estimated, pct: ((real - estimated) / estimated) * 100 };
}
