import { formatMoney, formatNumber } from '@/ui';

const SYMBOLS: Record<string, string> = { NIO: 'C$', USD: 'US$', EUR: '€' };

/** Dato ausente o no numérico: nunca se muestra como 0, se ve "N/D". */
export const HR_NO_DATA = 'N/D';

function toFinite(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** Número con separador de miles y 2 decimales (formatNumber del design system). */
export function formatHrNumber(value: string | number | null | undefined): string {
  const numeric = toFinite(value);
  return numeric === null ? HR_NO_DATA : formatNumber(numeric);
}

/** Monto con el símbolo de su moneda (formatMoney del design system). */
export function formatHrMoney(currency: string | null | undefined, value: string | number | null | undefined): string {
  const numeric = toFinite(value);
  if (numeric === null) return HR_NO_DATA;
  const code = currency?.trim().toUpperCase() || 'NIO';
  return formatMoney(numeric, SYMBOLS[code] ?? code);
}
