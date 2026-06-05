import { createContext } from 'react';
import type { CurrencySettings } from '../utils/currency';

export interface CurrencyContextValue {
  settings: CurrencySettings;
  symbol: string;
  formatMoney: (amount: number) => string;
  refresh: () => Promise<void>;
  loading: boolean;
}

export const CurrencyContext = createContext<CurrencyContextValue | null>(null);
