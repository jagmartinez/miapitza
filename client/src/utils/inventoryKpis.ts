import { effectiveUnitCost } from './productCost';

export interface KpiProduct {
  id: number;
  name: string;
  totalStock?: number;
  minStock?: number;
  cost?: number;
  currentAverageCost?: number;
}

export interface InventoryKpis {
  totalValue: number;
  /** Σ (2 × mínimo − existencia) × costo de los productos con existencia ≤ mínimo (mínimo > 0). */
  replenishmentCost: number;
  belowMinCount: number;
  outOfStockCount: number;
  /** Hasta 3 nombres de productos agotados (existencia 0, mínimo > 0). */
  outOfStockNames: string[];
  /** % del valor total que concentran los 3 productos de mayor valor. */
  concentrationPct: number;
  topNames: string[];
}

export function computeInventoryKpis(products: KpiProduct[]): InventoryKpis {
  let totalValue = 0;
  let replenishmentCost = 0;
  let belowMinCount = 0;
  let outOfStockCount = 0;
  const outOfStockNames: string[] = [];
  const values: { name: string; value: number }[] = [];

  for (const p of products) {
    const stock = Math.max(0, Number(p.totalStock ?? 0));
    const min = Number(p.minStock ?? 0);
    const unitCost = effectiveUnitCost(p.currentAverageCost, p.cost);
    const value = stock * unitCost;
    totalValue += value;
    if (value > 0) values.push({ name: p.name, value });
    if (min > 0 && stock <= min) {
      belowMinCount += 1;
      if (stock === 0) {
        outOfStockCount += 1;
        if (outOfStockNames.length < 3) outOfStockNames.push(p.name);
      }
      replenishmentCost += (2 * min - stock) * unitCost;
    }
  }

  const top = values.sort((a, b) => b.value - a.value).slice(0, 3);
  const topSum = top.reduce((sum, v) => sum + v.value, 0);
  return {
    totalValue,
    replenishmentCost,
    belowMinCount,
    outOfStockCount,
    outOfStockNames,
    concentrationPct: totalValue > 0 ? (topSum / totalValue) * 100 : 0,
    topNames: top.map((v) => v.name),
  };
}
