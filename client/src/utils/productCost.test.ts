import { describe, expect, it } from 'vitest';
import { effectiveUnitCost } from './productCost';

describe('effectiveUnitCost', () => {
  it('prefers the positive weighted average', () => {
    expect(effectiveUnitCost(12.5, 9)).toBe(12.5);
  });

  it('falls back to the reference when average is zero', () => {
    expect(effectiveUnitCost(0, 9)).toBe(9);
  });

  it('returns zero for invalid values', () => {
    expect(effectiveUnitCost(undefined, -1)).toBe(0);
  });
});
