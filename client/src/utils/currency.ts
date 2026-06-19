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

/** Normalize API/Prisma amounts (number, string, null) for display math. */
export function coerceMoneyAmount(amount: unknown): number {
    if (amount == null) return 0;
    if (typeof amount === 'number') return Number.isFinite(amount) ? amount : 0;
    if (typeof amount === 'string') {
        const n = Number(amount.replace(/,/g, '').trim());
        return Number.isFinite(n) ? n : 0;
    }
    if (typeof amount === 'object' && amount !== null && 'toNumber' in amount) {
        const toNumber = (amount as { toNumber?: () => number }).toNumber;
        if (typeof toNumber === 'function') return coerceMoneyAmount(toNumber.call(amount));
    }
    const n = Number(amount);
    return Number.isFinite(n) ? n : 0;
}

export const formatCurrency = (amount: unknown, settings: CurrencySettings = {}): string => {
    const symbol = settings.currency_symbol || DEFAULT_CURRENCY_SYMBOL;
    return `${symbol} ${coerceMoneyAmount(amount).toFixed(2)}`;
};

/**
 * Configurable currency formatter backed by Intl.NumberFormat. Currency code and
 * locale are sourced from settings/options with app-wide fallbacks, so pages no
 * longer need to hardcode them.
 */
export const formatCurrencyIntl = (amount: unknown, options: CurrencyFormatOptions = {}): string => {
    const safe = coerceMoneyAmount(amount);
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
        }).format(safe);
    } catch {
        return `${safe.toFixed(maximumFractionDigits)}`;
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
