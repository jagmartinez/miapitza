const numberFormatter = new Intl.NumberFormat('es-NI', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatHrNumber(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  return numberFormatter.format(Number.isFinite(numeric) ? numeric : 0);
}

export function formatHrMoney(currency: string | null | undefined, value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  const amount = Number.isFinite(numeric) ? numeric : 0;
  const normalizedCurrency = currency?.trim().toUpperCase() || 'NIO';
  try {
    return new Intl.NumberFormat('es-NI', {
      style: 'currency',
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${normalizedCurrency} ${new Intl.NumberFormat('es-NI', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)}`;
  }
}
