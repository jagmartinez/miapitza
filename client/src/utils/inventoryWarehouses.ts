import { effectiveUnitCost } from './productCost';

export interface WarehouseStockRow {
  productId: number;
  quantity: number | string;
}

export interface WarehouseStockInput {
  warehouseId: number;
  warehouseName: string;
  rows: WarehouseStockRow[];
}

export interface CostedProduct {
  id: number;
  cost?: number;
  currentAverageCost?: number;
}

export interface WarehouseValue {
  warehouseId: number;
  name: string;
  value: number;
}

export interface WarehouseBreakdown {
  /** Nombre del almacén si el producto tiene existencia en uno solo; "Varias" si en más de uno; "-" si en ninguno. */
  labelByProduct: Map<number, string>;
  /** Valor valorizado por almacén, de mayor a menor (sin almacenes en cero). */
  valueByWarehouse: WarehouseValue[];
}

export function buildWarehouseBreakdown(
  warehouses: WarehouseStockInput[],
  products: CostedProduct[],
): WarehouseBreakdown {
  const unitCost = new Map(products.map((p) => [p.id, effectiveUnitCost(p.currentAverageCost, p.cost)]));
  const names = new Map<number, string[]>();
  const valueByWarehouse: WarehouseValue[] = [];

  for (const w of warehouses) {
    let value = 0;
    for (const row of w.rows) {
      const qty = Number(row.quantity);
      if (!(qty > 0)) continue;
      const list = names.get(row.productId) ?? [];
      list.push(w.warehouseName);
      names.set(row.productId, list);
      value += qty * (unitCost.get(row.productId) ?? 0);
    }
    if (value > 0) valueByWarehouse.push({ warehouseId: w.warehouseId, name: w.warehouseName, value });
  }

  const labelByProduct = new Map<number, string>();
  for (const p of products) {
    const list = names.get(p.id) ?? [];
    labelByProduct.set(p.id, list.length === 0 ? '-' : list.length === 1 ? list[0] : 'Varias');
  }
  valueByWarehouse.sort((a, b) => b.value - a.value);
  return { labelByProduct, valueByWarehouse };
}
