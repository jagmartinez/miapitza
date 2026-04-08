/**
 * Currency Formatting Utility for Client
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
    const symbol = settings.currency_symbol || 'C$';
    return `${symbol} ${amount.toFixed(2)}`;
};

/**
 * Get currency symbol from settings
 * @param settings - Company settings object
 * @returns Currency symbol (default: 'C$')
 */
export const getCurrencySymbol = (settings: CurrencySettings = {}): string => {
    return settings.currency_symbol || 'C$';
};
