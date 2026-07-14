export interface CashShiftScope {
    hasActiveShift?: boolean;
    requiresClose?: boolean;
    shift?: {
        cashRegister?: {
            branch?: { id?: number } | null;
        } | null;
    } | null;
}

/** Mirrors PaymentService's persisted semantic method contract. */
export function isCashPaymentMethodType(type: string | null | undefined): boolean {
    return type === 'CASH';
}

/** Cash must post into an open, current shift belonging to the order branch. */
export function hasUsableCashShift(status: CashShiftScope | null | undefined, orderBranchId?: number | null): boolean {
    return Boolean(
        status?.hasActiveShift
        && !status.requiresClose
        && orderBranchId
        && status.shift?.cashRegister?.branch?.id === orderBranchId
    );
}
