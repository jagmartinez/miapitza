import { describe, expect, it } from 'vitest';
import { buildWarehouseBreakdown } from './inventoryWarehouses';

const products = [
  { id: 1, cost: 10, currentAverageCost: 10 },
  { id: 2, cost: 5, currentAverageCost: 5 },
  { id: 3, cost: 1, currentAverageCost: 1 },
];
const warehouses = [
  { warehouseId: 1, warehouseName: 'Central', rows: [{ productId: 1, quantity: '2' }, { productId: 2, quantity: 4 }] },
  { warehouseId: 2, warehouseName: 'Cocina', rows: [{ productId: 1, quantity: 1 }, { productId: 3, quantity: 0 }] },
];

describe('buildWarehouseBreakdown', () => {
  it('etiqueta el almacén único, "Varias" o "-"', () => {
    const { labelByProduct } = buildWarehouseBreakdown(warehouses, products);
    expect(labelByProduct.get(1)).toBe('Varias');
    expect(labelByProduct.get(2)).toBe('Central');
    expect(labelByProduct.get(3)).toBe('-');
  });
  it('valor por almacén ordenado de mayor a menor', () => {
    const { valueByWarehouse } = buildWarehouseBreakdown(warehouses, products);
    expect(valueByWarehouse.map((w) => [w.name, w.value])).toEqual([['Central', 40], ['Cocina', 10]]);
  });
  it('excluye del valor los productos sin costo y los cuenta', () => {
    const r = buildWarehouseBreakdown(
      [{ warehouseId: 1, warehouseName: 'Central', rows: [{ productId: 1, quantity: 2 }, { productId: 9, quantity: 5 }] }],
      [...products, { id: 9, cost: 0, currentAverageCost: 0 }],
    );
    expect(r.valueByWarehouse.map((w) => w.value)).toEqual([20]);
    expect(r.unknownCostCount).toBe(1);
  });
});
