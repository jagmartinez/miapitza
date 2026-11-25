import type { ProductionRecipe } from '../types';

export interface CostVariation {
  previousUnitCost: number;
  unitCost: number;
  deltaPct: number;
  /** Insumo cuyo aporte al costo unitario cambió más. */
  cause: { componentProductId: number; name: string; deltaUnitCost: number } | null;
}

/** Variación a partir de la cual el aviso se marca como alerta. */
export const COST_VARIATION_ALERT_PCT = 5;

export function previousVersion(recipe: ProductionRecipe, all: ProductionRecipe[]): ProductionRecipe | undefined {
  return all
    .filter((r) => r.productId === recipe.productId && r.version < recipe.version)
    .sort((a, b) => b.version - a.version)[0];
}

/** Aporte de cada insumo al costo de una unidad base producida. */
function perUnitContribution(recipe: ProductionRecipe): Map<number, { name: string; value: number }> {
  const out = new Map<number, { name: string; value: number }>();
  const yieldBase = Number(recipe.cost?.yieldBaseQuantity) || 0;
  if (!recipe.cost || yieldBase <= 0) return out;
  for (const line of recipe.cost.lines) {
    out.set(line.componentProductId, { name: line.componentName, value: (Number(line.totalCost) || 0) / yieldBase });
  }
  return out;
}

/** null si alguna de las dos versiones no tiene costo calculable (nunca se asume 0). */
export function costVariation(recipe: ProductionRecipe, previous: ProductionRecipe | undefined): CostVariation | null {
  if (!previous || !recipe.cost || !previous.cost) return null;
  const unitCost = Number(recipe.cost.unitCost);
  const previousUnitCost = Number(previous.cost.unitCost);
  if (!Number.isFinite(unitCost) || !Number.isFinite(previousUnitCost) || previousUnitCost <= 0) return null;

  const now = perUnitContribution(recipe);
  const before = perUnitContribution(previous);
  let cause: CostVariation['cause'] = null;
  for (const id of new Set([...now.keys(), ...before.keys()])) {
    const delta = (now.get(id)?.value ?? 0) - (before.get(id)?.value ?? 0);
    if (!cause || Math.abs(delta) > Math.abs(cause.deltaUnitCost)) {
      cause = { componentProductId: id, name: (now.get(id) ?? before.get(id))!.name, deltaUnitCost: delta };
    }
  }
  if (cause && Math.abs(cause.deltaUnitCost) < 1e-9) cause = null;
  return { previousUnitCost, unitCost, deltaPct: ((unitCost - previousUnitCost) / previousUnitCost) * 100, cause };
}

export function ingredientWeights(recipe: ProductionRecipe) {
  const batch = Number(recipe.cost?.batchCost) || 0;
  if (!recipe.cost || batch <= 0) return [];
  return recipe.cost.lines
    .map((line) => ({
      componentProductId: line.componentProductId,
      name: line.componentName,
      totalCost: Number(line.totalCost) || 0,
      pct: ((Number(line.totalCost) || 0) / batch) * 100,
    }))
    .sort((a, b) => b.pct - a.pct);
}

/** Recetas vigentes (no inactivas) que consumen el producto que esta receta produce. */
export function usedIn(recipe: ProductionRecipe, all: ProductionRecipe[]): ProductionRecipe[] {
  return all.filter(
    (r) => r.id !== recipe.id && r.status !== 'INACTIVE' && r.components.some((c) => c.componentProductId === recipe.productId),
  );
}
