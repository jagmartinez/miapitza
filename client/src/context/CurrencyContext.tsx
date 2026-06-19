import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { settingsAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import {
  formatCurrency,
  getCurrencySymbol,
  type CurrencySettings,
} from '../utils/currency';
import { CurrencyContext } from './currency-context';

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<CurrencySettings>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setSettings({});
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await settingsAPI.getAll();
      const data = res.data.data ?? {};
      setSettings({
        currency_symbol: data.currency_symbol || data.currencySymbol,
        currency_code: data.currency_code || data.currency,
        currency_name: data.currency_name,
        currency_locale: data.currency_locale || data.locale,
      });
    } catch {
      setSettings({});
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => {
    const symbol = getCurrencySymbol(settings);
    return {
      settings,
      symbol,
      formatMoney: (amount: unknown) => formatCurrency(amount, settings),
      refresh,
      loading,
    };
  }, [settings, refresh, loading]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
};
