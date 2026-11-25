import { describe, expect, it } from 'vitest';
import { computeInventoryKpis, type KpiProduct } from './inventoryKpis';

const products: KpiProduct[] = [
  { id: 1, name: 'Harina', totalStock: 0, minStock: 10, currentAverageCost: 5, cost: 5 },   // agotado
  { id: 2, name: 'Aceite', totalStock: 4, minStock: 10, currentAverageCost: 20, cost: 20 }, // bajo mínimo
  { id: 3, name: 'Sal', totalStock: 50, minStock: 10, currentAverageCost: 2, cost: 2 },     // sano
];

describe('computeInventoryKpis', () => {
  it('valor del inventario = Σ existencia × costo', () => {
    expect(computeInventoryKpis(products).totalValue).toBe(4 * 20 + 50 * 2);
  });
  it('reposición = Σ (2 × mínimo − existencia) × costo de los productos bajo mínimo', () => {
    const k = computeInventoryKpis(products);
    // Harina: (20 − 0) × 5 = 100; Aceite: (20 − 4) × 20 = 320; Sal no entra.
    expect(k.replenishmentCost).toBe(100 + 320);
    expect(k.belowMinCount).toBe(2);
    expect(k.outOfStockCount).toBe(1);
    expect(k.outOfStockNames).toEqual(['Harina']);
  });
  it('concentración = % del valor en los 3 productos principales', () => {
    const k = computeInventoryKpis(products);
    expect(k.concentrationPct).toBe(100);
    expect(k.topNames).toEqual(['Sal', 'Aceite']);
    const more = [
      ...products,
      { id: 4, name: 'Pimienta', totalStock: 1, minStock: 0, currentAverageCost: 20, cost: 20 },
      { id: 5, name: 'Azúcar', totalStock: 1, minStock: 0, currentAverageCost: 10, cost: 10 },
    ];
    // Valores: Sal 100, Aceite 80, Pimienta 20, Azúcar 10 → top 3 = 200 de 210.
    expect(computeInventoryKpis(more).concentrationPct).toBeCloseTo((200 / 210) * 100, 5);
  });
  it('sin valor no divide entre cero', () => {
    expect(computeInventoryKpis([]).concentrationPct).toBe(0);
  });
  it('existencia igual al mínimo cuenta como bajo mínimo (misma regla que getLowStock del servidor)', () => {
    const k = computeInventoryKpis([{ id: 9, name: 'Pasta', totalStock: 10, minStock: 10, currentAverageCost: 3, cost: 3 }]);
    expect(k.belowMinCount).toBe(1);
    expect(k.outOfStockCount).toBe(0);
    expect(k.replenishmentCost).toBe(10 * 3);
  });
});
