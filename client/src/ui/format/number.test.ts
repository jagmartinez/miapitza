import { formatNumber, formatMoney, formatPercent, formatQty, parseNumber } from './number';

describe('formato numérico', () => {
  it('formatNumber', () => {
    expect(formatNumber(1234567.891)).toBe('1,234,567.89');
    expect(formatNumber('1,234.5')).toBe('1,234.50');
    expect(formatNumber(null)).toBe('0.00');
    expect(formatNumber(NaN)).toBe('0.00');
    expect(formatNumber(-0.004)).toBe('0.00');
    expect(formatNumber({ toNumber: () => 3 })).toBe('3.00');
    expect(formatNumber(12, 0)).toBe('12');
  });
  it('formatMoney', () => {
    expect(formatMoney(1500)).toBe('C$ 1,500.00');
    expect(formatMoney(-350, 'C$')).toBe('-C$ 350.00');
  });
  it('formatQty y formatPercent', () => {
    expect(formatQty('2.5')).toBe('2.50');
    expect(formatPercent(32.5)).toBe('32.50 %');
  });
  it('parseNumber', () => {
    expect(parseNumber(' 12,345.67 ')).toBe(12345.67);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
});
