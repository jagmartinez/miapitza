import { formatCurrency, formatCurrencyGrouped } from '@web/utils/currency';

describe('@web alias (pure client modules)', () => {
    it('formats grouped currency from client utils', () => {
        expect(formatCurrencyGrouped(1580, { currency_symbol: 'C$' })).toContain('1,580');
    });
    it('formatCurrency keeps the configured symbol', () => {
        expect(formatCurrency(1580, { currency_symbol: 'C$' })).toContain('C$');
    });
});
