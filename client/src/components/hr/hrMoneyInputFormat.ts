export function normalizeHrDecimalInput(value: string): string {
  const cleaned = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const negative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/-/g, '');
  const [integer = '', ...fractionParts] = unsigned.split('.');
  const fraction = fractionParts.join('').slice(0, 2);
  const normalizedInteger = integer.replace(/^0+(?=\d)/, '') || (fraction ? '0' : '');
  return `${negative ? '-' : ''}${normalizedInteger}${fractionParts.length ? `.${fraction}` : ''}`;
}

export function formatHrDecimalInput(value: string | number): string {
  const normalized = normalizeHrDecimalInput(String(value ?? ''));
  if (!normalized || normalized === '-') return normalized;
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integer, fraction] = unsigned.split('.');
  const grouped = (integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction !== undefined ? `.${fraction}` : ''}`;
}
