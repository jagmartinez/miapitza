import { describe, expect, it } from 'vitest';
import type { ProductionRecipe, RecipeCostLine } from '../types';
import { costVariation, ingredientWeights, previousVersion, usedIn } from './recipeInsights';

const line = (componentProductId: number, componentName: string, totalCost: number): RecipeCostLine => ({
  componentProductId, componentName, componentType: 'INGREDIENT', unit: 'kg', baseUnit: 'kg',
  quantity: 1, baseQuantity: 1, unitCost: totalCost, totalCost,
});

function recipe(id: number, productId: number, version: number, lines: RecipeCostLine[] | null, yieldBase = 10, status: ProductionRecipe['status'] = 'ACTIVE'): ProductionRecipe {
  const batchCost = lines ? lines.reduce((s, l) => s + l.totalCost, 0) : 0;
  return {
    id, companyId: 1, productId, name: `R${id}`, version, status, yieldQuantity: yieldBase, yieldUnitAbbreviation: 'kg',
    yieldUnitSource: 'RECIPE', createdAt: '', updatedAt: '',
    components: (lines ?? []).map((l) => ({ componentProductId: l.componentProductId, quantity: 1 })) as ProductionRecipe['components'],
    cost: lines ? { batchCost, yieldBaseQuantity: yieldBase, yieldBaseUnit: 'kg', unitCost: batchCost / yieldBase, lines } : null,
  } as ProductionRecipe;
}

describe('recipe insights', () => {
  const v1 = recipe(1, 100, 1, [line(1, 'Harina', 50), line(2, 'Aceite', 30)]);
  const v2 = recipe(2, 100, 2, [line(1, 'Harina', 50), line(2, 'Aceite', 60)]);
  const other = recipe(3, 200, 1, [line(100, 'Masa', 20)], 10, 'DRAFT');
  const all = [v1, v2, other];

  it('finds the previous version of the same product', () => {
    expect(previousVersion(v2, all)?.id).toBe(1);
    expect(previousVersion(v1, all)).toBeUndefined();
  });

  it('reports the unit cost variation against the previous version and the ingredient that caused it', () => {
    const variation = costVariation(v2, v1)!;
    expect(variation.previousUnitCost).toBeCloseTo(8);
    expect(variation.unitCost).toBeCloseTo(11);
    expect(variation.deltaPct).toBeCloseTo(37.5);
    expect(variation.cause).toEqual({ componentProductId: 2, name: 'Aceite', deltaUnitCost: 3 });
  });

  it('returns null when either version has no calculable cost', () => {
    expect(costVariation(v2, recipe(9, 100, 0, null))).toBeNull();
    expect(costVariation(recipe(9, 100, 3, null), v1)).toBeNull();
  });

  it('weights each ingredient over the batch cost', () => {
    const weights = ingredientWeights(v2);
    expect(weights.map((w) => [w.name, Math.round(w.pct * 100) / 100])).toEqual([['Aceite', 54.55], ['Harina', 45.45]]);
  });

  it('lists the recipes that consume the output product (excluding inactive)', () => {
    expect(usedIn(recipe(5, 100, 1, [line(1, 'Harina', 1)]), all).map((r) => r.id)).toEqual([3]);
    const inactive = recipe(3, 200, 1, [line(100, 'Masa', 20)], 10, 'INACTIVE');
    expect(usedIn(v1, [v1, inactive])).toEqual([]);
  });
});
