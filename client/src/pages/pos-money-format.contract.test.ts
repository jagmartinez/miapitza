import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatCurrencyGrouped } from '../utils/currency';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('POS grouped money display contract', () => {
  const pos = read('./POS.tsx');
  const cart = read('../components/OrderCart.tsx');
  const productCard = read('../components/POSProductCard.tsx');

  it('formats representative Córdoba amounts with thousands separators', () => {
    expect(formatCurrencyGrouped(1375, {
      currency_symbol: 'C$',
      currency_locale: 'es-NI',
    })).toBe('C$ 1,375.00');
    expect(formatCurrencyGrouped(1234567.8, {
      currency_symbol: 'C$',
      currency_locale: 'es-NI',
    })).toBe('C$ 1,234,567.80');
  });

  it('wires the shared company formatter through every POS money surface', () => {
    expect(pos).toContain('const { symbol: currencySymbol, formatMoney } = useCurrency()');
    expect(pos).toContain('formatMoney={formatMoney}');
    expect(pos).toContain('{formatMoney(activeOrderTotal)}');
    expect(pos).toContain('{formatMoney(displayTotal)}');
    expect(pos).toContain('<strong>{formatMoney(subtotal)}</strong>');
    expect(cart).toContain('{formatMoney(Number(item.price))}');
    expect(cart).toContain('{formatMoney(Number(item.price) * item.quantity)}');
    expect(cart).toContain('{formatMoney(total)}');
    expect(productCard).toContain('{formatMoney(Number(item.price))}');
  });

  it('does not bypass grouped formatting inside cart or product cards', () => {
    expect(cart).not.toContain('.toFixed(2)');
    expect(productCard).not.toContain('.toFixed(2)');
  });
});
