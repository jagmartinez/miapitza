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

function finishedThisMonth(orders: ProductionOrder[], now: Date): ProductionOrder[] {
  return orders.filter((order) => {
    if (order.status !== 'FINISHED') return false;
    const when = new Date(order.finishedAt ?? order.date);
    return when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth();
  });
}

export interface MonthlyOverrun {
  overrun: number;
  estimated: number;
  real: number;
  pct: number;
  count: number;
  /** Órdenes finalizadas del mes que no entran en el total por no tener costo estimado o real. */
  excluded: number;
}

export function monthlyOverrun(orders: ProductionOrder[], now = new Date()): MonthlyOverrun | null {
  let estimated = 0;
  let real = 0;
  let count = 0;
  let excluded = 0;
  for (const order of finishedThisMonth(orders, now)) {
    const variation = costVariationOf(order);
    if (!variation) {
      excluded += 1;
      continue;
    }
    estimated += num(order.estimatedCost);
    real += num(order.realCost);
    count += 1;
  }
  if (count === 0) return null;
  return { overrun: real - estimated, estimated, real, pct: ((real - estimated) / estimated) * 100, count, excluded };
}

export interface MonthlyYield {
  avgPct: number;
  count: number;
  lowest: { code: string; pct: number };
}

/** Rendimiento real (producido / planificado) promedio de las órdenes finalizadas del mes. */
export function monthlyYield(orders: ProductionOrder[], now = new Date()): MonthlyYield | null {
  const yields = finishedThisMonth(orders, now)
    .map((order) => ({ code: order.code, planned: num(order.plannedQuantity), produced: num(order.producedQuantity) }))
    .filter((o) => o.planned > 0 && Number.isFinite(o.produced))
    .map((o) => ({ code: o.code, pct: (o.produced / o.planned) * 100 }));
  if (yields.length === 0) return null;
  const lowest = yields.reduce((a, b) => (b.pct < a.pct ? b : a));
  return { avgPct: yields.reduce((s, y) => s + y.pct, 0) / yields.length, count: yields.length, lowest };
}
