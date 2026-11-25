import { describe, expect, it } from 'vitest';
import type { ProductionOrder } from '../types';
import { costVariationOf, monthlyOverrun, monthlyYield } from './productionOrderInsights';

const order = (over: Partial<ProductionOrder>): ProductionOrder => ({
  id: 1, code: 'P-1', status: 'FINISHED', plannedQuantity: 10, producedQuantity: 10, estimatedCost: 100, realCost: 100,
  date: '2026-11-10T12:00:00Z', finishedAt: '2026-11-10T12:00:00Z', items: [],
  ...over,
} as ProductionOrder);

const now = new Date('2026-11-25T12:00:00Z');

describe('production order insights', () => {
  it('computes the cost variation only when both costs are known', () => {
    expect(costVariationOf(order({ estimatedCost: 100, realCost: 125 }))).toEqual({ delta: 25, pct: 25 });
    expect(costVariationOf(order({ status: 'IN_PROGRESS', realCost: 0 }))).toBeNull();
    expect(costVariationOf(order({ estimatedCost: 0, realCost: 50 }))).toBeNull();
    expect(costVariationOf(order({ realCost: 0 }))).toBeNull();
  });

  it('adds up the month overrun of finished orders and leaves out orders without costs', () => {
    const result = monthlyOverrun([
      order({ id: 1, estimatedCost: 100, realCost: 130 }),
      order({ id: 2, estimatedCost: 200, realCost: 190 }),
      order({ id: 3, estimatedCost: 0, realCost: 80 }),
      order({ id: 4, status: 'CANCELLED', estimatedCost: 50, realCost: 90 }),
      order({ id: 5, finishedAt: '2026-10-30T12:00:00Z', date: '2026-10-30T12:00:00Z', estimatedCost: 10, realCost: 99 }),
    ], now);
    expect(result).toEqual({ overrun: 20, estimated: 300, real: 320, pct: (20 / 300) * 100, count: 2, excluded: 1 });
  });

  it('averages the real yield against the standard of the month and names the weakest order', () => {
    const result = monthlyYield([
      order({ id: 1, code: 'P-1', plannedQuantity: 10, producedQuantity: 10 }),
      order({ id: 2, code: 'P-2', plannedQuantity: 20, producedQuantity: 15 }),
      order({ id: 3, code: 'P-3', status: 'PENDING', plannedQuantity: 5, producedQuantity: 0 }),
    ], now);
    expect(result).toEqual({ avgPct: 87.5, count: 2, lowest: { code: 'P-2', pct: 75 } });
    expect(monthlyYield([], now)).toBeNull();
  });
});
