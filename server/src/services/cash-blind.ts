import { isCompanyWide } from '../utils/branch-scope';

type Viewer = Parameters<typeof isCompanyWide>[0];

/**
 * A "blind" cashier is a CAJERO without ADMIN/SUPERADMIN: while the shift is
 * open they count the drawer without seeing the expected amount. The rule is
 * enforced here (server side) so a tablet cannot read what the UI hides.
 */
export function isBlindCashier(user: Viewer): boolean {
    const roles = user.roles ?? [user.role];
    return roles.includes('CAJERO') && !isCompanyWide(user);
}

/** Drops expected/difference from an arqueo count or close preview for blind cashiers. */
export function redactBlindCount<T extends object>(data: T, user: Viewer): Partial<T> {
    if (!isBlindCashier(user)) return data;
    const copy = { ...data } as Record<string, unknown>;
    for (const key of ['expectedAmount', 'expected', 'difference', 'absoluteDifference']) delete copy[key];
    return copy as Partial<T>;
}

/** Drops the expected end amount from the summary of an OPEN shift for blind cashiers. */
export function redactBlindSummary<T extends { shift: { endDate?: Date | null }; summary: object }>(
    data: T,
    user: Viewer
): T {
    if (!isBlindCashier(user) || data.shift.endDate) return data;
    const summary = { ...data.summary } as Record<string, unknown>;
    delete summary.expectedBalance;
    delete summary.expectedAmount;
    return { ...data, summary } as T;
}

/** Drops expected/difference amounts from the arqueo detail of an OPEN shift for blind cashiers. */
export function redactBlindDetails<T extends {
    shift: { status?: string };
    amounts: object;
    reconciliation: object;
}>(data: T, user: Viewer): T {
    if (!isBlindCashier(user) || data.shift.status === 'CERRADO') return data;
    const amounts = { ...data.amounts } as Record<string, unknown>;
    delete amounts.expectedEndAmount;
    delete amounts.difference;
    const reconciliation = { ...data.reconciliation } as Record<string, unknown>;
    delete reconciliation.surplus;
    delete reconciliation.deficit;
    delete reconciliation.isBalanced;
    return { ...data, amounts, reconciliation } as T;
}
