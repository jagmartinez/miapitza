/** Ingeniería de menú: popularidad × margen (mismas reglas que el reporte del servidor). */
export type MenuClass = 'ESTRELLA' | 'CABALLO' | 'PUZZLE' | 'PERRO' | 'SIN_VENTAS' | 'SIN_COSTO';

export interface MenuSalesRow {
  menuItemId: number;
  price: number;
  /** Costo estándar de la receta; <= 0 significa que no hay costo conocido (N/D). */
  cost: number;
  margin: number;
  qtySold: number;
  revenue: number;
}

export const MENU_CLASS_LABEL: Record<MenuClass, string> = {
  ESTRELLA: 'Estrella',
  CABALLO: 'Caballo de batalla',
  PUZZLE: 'Rompecabezas',
  PERRO: 'Perro',
  SIN_VENTAS: 'Sin ventas',
  SIN_COSTO: 'Sin costo',
};

export const MENU_CLASS_HINT: Record<MenuClass, string> = {
  ESTRELLA: 'Vende mucho y deja buen margen: protégelo.',
  CABALLO: 'Vende mucho pero deja poco margen: revisa costo o precio.',
  PUZZLE: 'Deja buen margen pero vende poco: promuévelo.',
  PERRO: 'Vende poco y deja poco margen: rediseña o retira.',
  SIN_VENTAS: 'Sin ventas en el periodo.',
  SIN_COSTO: 'Sin costo conocido: completa la receta o el costo de los insumos.',
};

const hasCost = (r: MenuSalesRow) => Number.isFinite(r.cost) && r.cost > 0;

export function classifyMenu(rows: MenuSalesRow[]): Map<number, MenuClass> {
  const out = new Map<number, MenuClass>();
  const scored = rows.filter((r) => r.qtySold > 0 && hasCost(r));
  const avgQty = scored.length ? scored.reduce((s, r) => s + r.qtySold, 0) / scored.length : 0;
  const avgMargin = scored.length ? scored.reduce((s, r) => s + r.margin, 0) / scored.length : 0;
  for (const r of rows) {
    if (r.qtySold <= 0) out.set(r.menuItemId, 'SIN_VENTAS');
    else if (!hasCost(r)) out.set(r.menuItemId, 'SIN_COSTO');
    else {
      const highPop = r.qtySold >= avgQty;
      const highMargin = r.margin >= avgMargin;
      out.set(r.menuItemId, highPop && highMargin ? 'ESTRELLA' : highPop ? 'CABALLO' : highMargin ? 'PUZZLE' : 'PERRO');
    }
  }
  return out;
}

export interface MenuSummary {
  /** Margen ponderado por unidades vendidas; null si ningún plato tiene costo y ventas. */
  weightedMarginPct: number | null;
  profit: number;
  revenue: number;
  costedCount: number;
  /** Platos con ventas pero sin costo conocido: no entran en los totales. */
  excludedWithoutCost: number;
}

export function summarizeMenu(rows: MenuSalesRow[]): MenuSummary {
  let profit = 0;
  let revenue = 0;
  let costedCount = 0;
  let excludedWithoutCost = 0;
  for (const r of rows) {
    if (r.qtySold <= 0) continue;
    if (!hasCost(r)) {
      excludedWithoutCost += 1;
      continue;
    }
    costedCount += 1;
    profit += r.margin * r.qtySold;
    revenue += r.price * r.qtySold;
  }
  return {
    weightedMarginPct: revenue > 0 ? (profit / revenue) * 100 : null,
    profit,
    revenue,
    costedCount,
    excludedWithoutCost,
  };
}
