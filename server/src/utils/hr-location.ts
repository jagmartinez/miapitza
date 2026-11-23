/**
 * Phones rarely report a GPS fix better than ~10 m, so a stricter accuracy
 * limit rejects every punch. Configuration below this floor is refused and
 * legacy stored values are lifted to it when punching.
 */
export const MIN_LOCATION_ACCURACY_M = 10;

/** Strictest of the policy and branch limits, never below the floor. */
export function effectiveLocationAccuracyLimit(policyLimitM: number, branchLimitM: number | null | undefined): number {
    const configured = branchLimitM ? Math.min(policyLimitM, branchLimitM) : policyLimitM;
    return Math.max(MIN_LOCATION_ACCURACY_M, configured);
}
