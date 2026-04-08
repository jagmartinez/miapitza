/**
 * Currency Formatting Utility
 * Provides dynamic currency formatting based on company settings
 */

export interface CurrencySettings {
    currency_symbol?: string;
    currency_code?: string;
    currency_name?: string;
}

/**
 * Format amount with currency symbol from settings
 * @param amount - The numeric amount to format
 * @param settings - Company settings object containing currency configuration
 * @returns Formatted currency string (e.g., "C$ 100.00")
 */
export const formatCurrency = (amount: number, settings: CurrencySettings = {}): string => {
    const symbol = settings.currency_symbol || '$';
    return `${symbol} ${amount.toFixed(2)}`;
};

/**
 * Get currency symbol from settings
 * @param settings - Company settings object
 * @returns Currency symbol (default: '$')
 */
export const getCurrencySymbol = (settings: CurrencySettings = {}): string => {
    return settings.currency_symbol || '$';
};

/**
 * Get currency code from settings
 * @param settings - Company settings object
 * @returns Currency code (default: 'NIO')
 */
export const getCurrencyCode = (settings: CurrencySettings = {}): string => {
    return settings.currency_code || 'NIO';
};

/**
 * Get currency name from settings
 * @param settings - Company settings object
 * @returns Currency name (default: 'Córdoba Nicaragüense')
 */
export const getCurrencyName = (settings: CurrencySettings = {}): string => {
    return settings.currency_name || 'Córdoba Nicaragüense';
};
