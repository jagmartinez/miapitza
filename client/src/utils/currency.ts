/**
 * Currency Formatting Utility for Client
 * Provides dynamic currency formatting based on company settings
 */

export interface CurrencySettings {
    currency_symbol?: string;
    currency_code?: string;
    currency_name?: string;
    currency_locale?: string;
}

/**
 * Sensible app-wide defaults. The system is Nicaragua-based (Córdoba / NIO),
 * so these are used as fallbacks whenever company settings are unavailable.
 */
export const DEFAULT_CURRENCY_CODE = 'NIO';
export const DEFAULT_CURRENCY_LOCALE = 'es-NI';
/** Fallback NIO per USD exchange rate when no setting is provided. */
export const DEFAULT_EXCHANGE_RATE = 36.5;

export interface CurrencyFormatOptions {
    /** ISO 4217 currency code, e.g. 'NIO', 'MXN', 'USD'. */
    currency?: string;
    /** BCP-47 locale, e.g. 'es-NI'. */
    locale?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
}

/**
 * Format amount with currency symbol from settings
 * @param amount - The numeric amount to format
 * @param settings - Company settings object containing currency configuration
 * @returns Formatted currency string (e.g., "C$ 100.00")
 */
export const DEFAULT_CURRENCY_SYMBOL = 'C$';

/** Left padding for inputs with a currency prefix (e.g. C$, $). */
export function currencyInputPadding(symbol: string): string {
  const chars = Math.max(symbol.trim().length, 1);
  return `calc(12px + ${chars}ch + 10px)`;
}

export const formatCurrency = (amount: number | string | null | undefined, settings: CurrencySettings = {}): string => {
    const symbol = settings.currency_symbol || DEFAULT_CURRENCY_SYMBOL;
    const n = Number(amount);
    const safe = Number.isFinite(n) ? n : 0;
    return `${symbol} ${safe.toFixed(2)}`;
};

/**
 * Configurable currency formatter backed by Intl.NumberFormat. Currency code and
 * locale are sourced from settings/options with app-wide fallbacks, so pages no
 * longer need to hardcode them.
 */
export const formatCurrencyIntl = (amount: number, options: CurrencyFormatOptions = {}): string => {
    const {
        currency = DEFAULT_CURRENCY_CODE,
        locale = DEFAULT_CURRENCY_LOCALE,
        minimumFractionDigits = 2,
        maximumFractionDigits = 2,
    } = options;
    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits,
            maximumFractionDigits,
        }).format(amount);
    } catch {
        return `${amount.toFixed(maximumFractionDigits)}`;
    }
};

/**
 * Get currency symbol from settings
 * @param settings - Company settings object
 * @returns Currency symbol (default: 'C$')
 */
export const getCurrencySymbol = (settings: CurrencySettings = {}): string => {
    return settings.currency_symbol || DEFAULT_CURRENCY_SYMBOL;
};
