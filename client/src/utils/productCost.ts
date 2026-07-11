/**
 * A catalog reference price is not a received purchase, but it is still the
 * best operational fallback until a positive weighted-average cost exists.
 */
export function effectiveUnitCost(
  currentAverageCost: unknown,
  referenceCost: unknown,
): number {
  const average = Number(currentAverageCost);
  if (Number.isFinite(average) && average > 0) return average;

  const reference = Number(referenceCost);
  if (Number.isFinite(reference) && reference > 0) return reference;

  return 0;
}
