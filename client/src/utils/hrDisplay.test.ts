import { describe, expect, it } from 'vitest';
import { formatMoney, formatNumber } from '@/ui';
import { formatHrMoney, formatHrNumber } from './hrDisplay';

describe('hrDisplay', () => {
  it('delegates to the design-system formatters', () => {
    expect(formatHrMoney('NIO', 12345.5)).toBe(formatMoney(12345.5, 'C$'));
    expect(formatHrMoney('USD', 10)).toBe(formatMoney(10, 'US$'));
    expect(formatHrNumber('1234.5')).toBe(formatNumber(1234.5));
  });
  it('shows N/D for missing data instead of zero', () => {
    expect(formatHrMoney('NIO', null)).toBe('N/D');
    expect(formatHrNumber(undefined)).toBe('N/D');
    expect(formatHrNumber('abc')).toBe('N/D');
  });
  it('keeps a real zero', () => {
    expect(formatHrNumber(0)).toBe(formatNumber(0));
  });
});
