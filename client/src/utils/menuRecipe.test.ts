import { describe, expect, it } from 'vitest';
import {
  buildMenuRecipeSyncPlan,
  calculateMenuRecipeLineCost,
  type EditableMenuRecipe,
  validateMenuRecipes,
} from './menuRecipe';

const ingredient = (patch: Partial<EditableMenuRecipe> = {}): EditableMenuRecipe => ({
  id: 10,
  productId: 20,
  productName: 'Harina',
  quantity: 0.25,
  unit: 'kg',
  cost: 40,
  conversionFactor: 1,
  unitConfigured: true,
  ...patch,
});

describe('menu recipe helpers', () => {
  it('values a line in product base units', () => {
    expect(calculateMenuRecipeLineCost(ingredient({ quantity: 250, unit: 'g', conversionFactor: 0.001 }))).toBe(10);
    expect(calculateMenuRecipeLineCost(ingredient({ unitConfigured: false }))).toBe(0);
  });

  it('rejects duplicate products, invalid quantities and unresolved units', () => {
    expect(validateMenuRecipes([ingredient(), ingredient({ id: 11 })])).toContain('duplicado');
    expect(validateMenuRecipes([ingredient({ quantity: 0 })])).toContain('mayor a 0');
    expect(validateMenuRecipes([ingredient({ unitConfigured: false })])).toContain('no está configurada');
    expect(validateMenuRecipes([ingredient()])).toBeNull();
  });

  it('builds a minimal create/update/delete plan', () => {
    const original = [
      ingredient(),
      ingredient({ id: 11, productId: 21, productName: 'Sal', quantity: 5, unit: 'g' }),
      ingredient({ id: 12, productId: 22, productName: 'Aceite', quantity: 10, unit: 'ml' }),
    ];
    const current = [
      ingredient({ quantity: 0.5 }),
      ingredient({ id: 12, productId: 22, productName: 'Aceite', quantity: 10, unit: 'ML' }),
      ingredient({ id: undefined, productId: 23, productName: 'Tomate', quantity: 2, unit: 'unidad' }),
    ];

    expect(buildMenuRecipeSyncPlan(original, current)).toEqual({
      create: [{ productId: 23, quantity: 2, unit: 'unidad' }],
      update: [{ id: 10, data: { quantity: 0.5, unit: 'kg' } }],
      delete: [11],
    });
  });

  it('replaces rather than updates a retained id whose product changed', () => {
    const original = [ingredient()];
    const current = [ingredient({ productId: 99, productName: 'Masa preparada' })];

    expect(buildMenuRecipeSyncPlan(original, current)).toEqual({
      create: [{ productId: 99, quantity: 0.25, unit: 'kg' }],
      update: [],
      delete: [10],
    });
  });
});
