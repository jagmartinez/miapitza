/**
 * Returns the operational unit cost without pretending a reference price was a
 * received purchase. A positive weighted-average cost always wins; otherwise
 * the catalog reference cost is used. Zero/invalid values do not mask a valid
 * fallback.
 */
export function effectiveUnitCost(
    currentAverageCost: unknown,
    referenceCost: unknown
): number {
    const average = Number(currentAverageCost);
    if (Number.isFinite(average) && average > 0) return average;

    const reference = Number(referenceCost);
    if (Number.isFinite(reference) && reference > 0) return reference;

    return 0;
}
