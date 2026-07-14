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
