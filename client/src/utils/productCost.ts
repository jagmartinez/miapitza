/**
 * A catalog reference price is not a received purchase, but it is still the
 * best operational fallback until a positive weighted-average cost exists.
 */
export type ProductCostResolution = {
  value: number;
  known: boolean;
  source: 'AVERAGE' | 'REFERENCE' | 'MISSING';
  anomaly: 'PRODUCT_COST_MISSING' | null;
};

export function resolveEffectiveUnitCost(
  currentAverageCost: unknown,
  referenceCost: unknown,
  signals?: { averageCostKnown?: unknown; referenceCostKnown?: unknown },
): ProductCostResolution {
  const average = Number(currentAverageCost);
  const averageKnown = signals?.averageCostKnown === true || (Number.isFinite(average) && average > 0);
  if (averageKnown && Number.isFinite(average) && average >= 0) {
    return { value: average, known: true, source: 'AVERAGE', anomaly: null };
  }

  const reference = Number(referenceCost);
  const referenceKnown = signals?.referenceCostKnown === true || (Number.isFinite(reference) && reference > 0);
  if (referenceKnown && Number.isFinite(reference) && reference >= 0) {
    return { value: reference, known: true, source: 'REFERENCE', anomaly: null };
  }

  return { value: 0, known: false, source: 'MISSING', anomaly: 'PRODUCT_COST_MISSING' };
}

export function effectiveUnitCost(
  currentAverageCost: unknown,
  referenceCost: unknown,
  signals?: { averageCostKnown?: unknown; referenceCostKnown?: unknown },
): number {
  return resolveEffectiveUnitCost(currentAverageCost, referenceCost, signals).value;
}
