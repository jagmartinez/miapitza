/** Decimal string ("1,234.5") to integer cents; null when it is not a plain non-negative amount. */
export function toCents(value: string): number | null {
    const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(value.trim().replace(/,/g, ''));
    if (!m) return null;
    return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function fromCents(cents: number): string {
    const whole = Math.floor(cents / 100);
    return `${whole}.${String(cents - whole * 100).padStart(2, '0')}`;
}

/**
 * The server's rule (buildPrincipalOnlySchedule): each installment is floor(amount / n, 2) and the last
 * absorbs the remainder, so the plan always sums to the amount. Integer cents: no float drift.
 */
export function installmentPlan(amount: string, n: number): string[] {
    const total = toCents(amount);
    if (total === null || total <= 0 || !Number.isInteger(n) || n < 1) return [];
    const each = Math.floor(total / n);
    const plan = Array.from({ length: n }, () => each);
    plan[n - 1] = total - each * (n - 1);
    return plan.map(fromCents);
}
