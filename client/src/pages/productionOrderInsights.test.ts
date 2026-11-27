import { describe, expect, it } from 'vitest';
import type { ProductionOrder } from '../types';
import { costVariationOf } from './productionOrderInsights';

const order = (over: Partial<ProductionOrder>): ProductionOrder => ({
  id: 1, code: 'P-1', status: 'FINISHED', plannedQuantity: 10, producedQuantity: 10, estimatedCost: 100, realCost: 100,
  date: '2026-11-10T12:00:00Z', finishedAt: '2026-11-10T12:00:00Z', items: [],
  ...over,
} as ProductionOrder);

describe('production order insights', () => {
  it('computes the cost variation only when both costs are known', () => {
    expect(costVariationOf(order({ estimatedCost: 100, realCost: 125 }))).toEqual({ delta: 25, pct: 25 });
    expect(costVariationOf(order({ status: 'IN_PROGRESS', realCost: 0 }))).toBeNull();
    expect(costVariationOf(order({ estimatedCost: 0, realCost: 50 }))).toBeNull();
    expect(costVariationOf(order({ realCost: 0 }))).toBeNull();
  });
});
