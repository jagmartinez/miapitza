import { describe, expect, it } from 'vitest';
import { classifyMenu, summarizeMenu, type MenuSalesRow } from './menuEngineering';

const row = (menuItemId: number, price: number, cost: number, qtySold: number): MenuSalesRow => ({
  menuItemId, price, cost, margin: price - cost, qtySold, revenue: price * qtySold,
});

describe('menu engineering classification', () => {
  const rows = [
    row(1, 100, 30, 90), // vende mucho, margen alto 70  -> Estrella
    row(2, 50, 40, 80),  // vende mucho, margen bajo 10  -> Caballo de batalla
    row(3, 120, 40, 10), // vende poco, margen alto 80   -> Rompecabezas
    row(4, 40, 35, 5),   // vende poco, margen bajo 5    -> Perro
  ];

  it('places four sample dishes in the four quadrants', () => {
    const result = classifyMenu(rows);
    expect(result.get(1)).toBe('ESTRELLA');
    expect(result.get(2)).toBe('CABALLO');
    expect(result.get(3)).toBe('PUZZLE');
    expect(result.get(4)).toBe('PERRO');
  });

  it('never classifies dishes without sales or without a known cost', () => {
    const result = classifyMenu([...rows, row(5, 30, 0, 50), row(6, 30, 10, 0)]);
    expect(result.get(5)).toBe('SIN_COSTO');
    expect(result.get(6)).toBe('SIN_VENTAS');
    expect(result.get(1)).toBe('ESTRELLA');
  });

  it('weights the margin by units sold and excludes dishes without cost', () => {
    const summary = summarizeMenu([...rows, row(5, 30, 0, 50)]);
    // utilidad: 70*90 + 10*80 + 80*10 + 5*5 = 6300 + 800 + 800 + 25 = 7925
    // ventas:   100*90 + 50*80 + 120*10 + 40*5 = 9000 + 4000 + 1200 + 200 = 14400
    expect(summary.profit).toBe(7925);
    expect(summary.revenue).toBe(14400);
    expect(summary.weightedMarginPct).toBeCloseTo((7925 / 14400) * 100, 6);
    expect(summary.excludedWithoutCost).toBe(1);
    expect(summary.costedCount).toBe(4);
  });

  it('returns null margin when nothing has cost and sales', () => {
    expect(summarizeMenu([row(5, 30, 0, 50)]).weightedMarginPct).toBeNull();
    expect(summarizeMenu([]).weightedMarginPct).toBeNull();
  });
});
