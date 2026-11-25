import { coerceMoneyAmount } from '../../utils/currency';

const cache = new Map<string, Intl.NumberFormat>();

function getFormat(locale: string, decimals: number): Intl.NumberFormat {
  const key = `${locale}|${decimals}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    cache.set(key, f);
  }
  return f;
}

/** Número con separador de miles y decimales fijos; valores inválidos se ven como 0.00. */
export function formatNumber(value: unknown, decimals = 2, locale = 'es-NI'): string {
  const n = coerceMoneyAmount(value);
  const f = getFormat(locale, decimals);
  const out = f.format(n);
  // Evita "-0.00" cuando el valor redondea a cero.
  return /^-[0.,\s]*$/.test(out) ? f.format(0) : out;
}

export function formatMoney(value: unknown, symbol = 'C$', decimals = 2): string {
  const n = coerceMoneyAmount(value);
  const body = formatNumber(Math.abs(n), decimals);
  const negative = n < 0 && formatNumber(n, decimals) !== formatNumber(0, decimals);
  return `${negative ? '-' : ''}${symbol} ${body}`;
}

export function formatQty(value: unknown, decimals = 2): string {
  return formatNumber(value, decimals);
}

/** Recibe el porcentaje ya escalado (32.5, no 0.325). */
export function formatPercent(value: unknown, decimals = 2): string {
  return `${formatNumber(value, decimals)} %`;
}

export function parseNumber(text: string): number | null {
  const cleaned = String(text).replace(/[,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
