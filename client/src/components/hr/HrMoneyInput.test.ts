import { describe, expect, it } from 'vitest';
import { formatHrDecimalInput, normalizeHrDecimalInput } from './hrMoneyInputFormat';

describe('HrMoneyInput formatting', () => {
  it('adds thousands separators without changing the decimal value sent to the API', () => {
    expect(formatHrDecimalInput('1234567.89')).toBe('1,234,567.89');
    expect(normalizeHrDecimalInput('1,234,567.89')).toBe('1234567.89');
  });

  it('limits monetary precision to two decimals', () => {
    expect(normalizeHrDecimalInput('12,345.6789')).toBe('12345.67');
  });
});
