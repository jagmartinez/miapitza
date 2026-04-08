export const calculateTipAmount = (orderTotal: number, tipPercentage: number, customTip?: string) => {
    if (customTip) {
        return parseFloat(customTip) || 0;
    }

    return orderTotal * (tipPercentage / 100);
};

export const calculateTotalWithTip = (orderTotal: number, tipAmount: number) => orderTotal + tipAmount;

export const splitTotalEvenly = (total: number, count: number) => {
    if (count <= 0) {
        return [];
    }

    const perPerson = Math.floor((total * 100) / count) / 100;
    const lastPerson = Math.round((total - (perPerson * (count - 1))) * 100) / 100;

    return Array.from({ length: count }, (_, index) => Number((index === count - 1 ? lastPerson : perPerson).toFixed(2)));
};
