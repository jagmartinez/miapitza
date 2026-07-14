export const moneyToCents = (value: number) => Math.round(value * 100);

export const centsToMoney = (cents: number) => cents / 100;

/** Parse an editable money field without coupling calculations to presentation. */
export const parseMoneyInput = (value: string): number | null => {
    const normalized = value.trim().replace(/,/g, '');
    if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? centsToMoney(moneyToCents(parsed)) : null;
};

export const formatMoneyInput = (value: string): string => {
    const parsed = parseMoneyInput(value);
    if (parsed === null) return value;
    return parsed.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: true,
    });
};

/** Format a monetary value for display while keeping the symbol configurable. */
export const formatMoneyAmount = (
    value: number,
    currencySymbol = '$',
    locale = 'es-NI',
): string => `${currencySymbol}${value.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
})}`;

export interface PaymentAllocationSummary {
    targetCents: number;
    allocatedCents: number;
    differenceCents: number;
    exact: boolean;
}

/** Compare payment legs in integer cents so mixed/split totals never rely on floats. */
export const summarizePaymentAllocation = (
    target: number,
    amounts: Array<number | null>,
): PaymentAllocationSummary => {
    const targetCents = moneyToCents(target);
    const allocatedCents = amounts.reduce(
        (sum: number, amount) => sum + (amount === null ? 0 : moneyToCents(amount)),
        0,
    );
    const differenceCents = targetCents - allocatedCents;
    return {
        targetCents,
        allocatedCents,
        differenceCents,
        exact: differenceCents === 0,
    };
};

export const calculateTipAmount = (orderTotal: number, tipPercentage: number, customTip?: string) => {
    if (customTip) {
        return parseMoneyInput(customTip) ?? 0;
    }

    return centsToMoney(Math.round(moneyToCents(orderTotal) * (tipPercentage / 100)));
};

export const calculateTotalWithTip = (orderTotal: number, tipAmount: number) =>
    centsToMoney(moneyToCents(orderTotal) + moneyToCents(tipAmount));

export const splitTotalEvenly = (total: number, count: number) => {
    if (count <= 0) {
        return [];
    }

    const totalCents = moneyToCents(total);
    const baseCents = Math.floor(totalCents / count);
    const remainder = totalCents % count;

    return Array.from(
        { length: count },
        (_, index) => centsToMoney(baseCents + (index >= count - remainder ? 1 : 0))
    );
};
