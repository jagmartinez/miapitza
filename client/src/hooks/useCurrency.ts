import { useContext } from 'react';
import { CurrencyContext } from '../context/currency-context';
import { formatCurrencyGrouped, getCurrencySymbol } from '../utils/currency';

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (ctx) return ctx;

  const symbol = getCurrencySymbol();
  return {
    settings: {},
    symbol,
    formatMoney: (amount: unknown) => formatCurrencyGrouped(amount),
    refresh: async () => undefined,
    loading: false,
  };
}
