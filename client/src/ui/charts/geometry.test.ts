import { areaPath, donutSegments, linePath, niceMax, sparkPoints, waterfallBars } from './geometry';

describe('geometría de gráficos', () => {
  it('niceMax redondea hacia arriba a pasos legibles', () => {
    expect(niceMax(13650)).toBe(15000);
    expect(niceMax(0)).toBe(1);
    expect(niceMax(2)).toBe(2);
    expect(niceMax(2.2)).toBe(2.5);
    expect(niceMax(NaN)).toBe(1);
  });

  it('linePath y areaPath', () => {
    expect(linePath([0, 10], 100, 50, 10)).toBe('M0 50 L100 0');
    expect(areaPath([0, 10], 100, 50, 10)).toBe('M0 50 L100 0 L100 50 L0 50 Z');
  });

  it('arreglos vacíos devuelven cadena vacía, sin NaN', () => {
    expect(linePath([], 100, 50, 10)).toBe('');
    expect(areaPath([], 100, 50, 10)).toBe('');
    expect(sparkPoints([], 100, 50)).toBe('');
    expect(donutSegments([])).toEqual([]);
    expect(waterfallBars([])).toEqual([]);
  });

  it('max en cero o valores no finitos no producen NaN', () => {
    expect(linePath([0, 0, 0], 100, 50, 0)).not.toContain('NaN');
    expect(linePath([NaN, 5], 100, 50, 10)).not.toContain('NaN');
    expect(sparkPoints([3, 3, 3], 90, 20)).toBe('0,10 45,10 90,10');
    expect(sparkPoints([5], 90, 20)).toBe('45,10');
  });

  it('sparkPoints escala de mínimo a máximo', () => {
    expect(sparkPoints([1, 3], 100, 20)).toBe('0,20 100,0');
  });

  it('waterfallBars: el total arranca en 0 y el negativo flota desde el nivel acumulado', () => {
    const bars = waterfallBars([
      { amount: 100, kind: 'total' },
      { amount: 10, kind: 'negative' },
      { amount: 90, kind: 'total' },
      { amount: 40, kind: 'negative' },
      { amount: 50, kind: 'total' },
      { amount: 50, kind: 'negative' },
      { amount: 0, kind: 'total' },
    ]);
    expect(bars[0]).toEqual({ bottomPct: 0, heightPct: 100 });
    expect(bars[1]).toEqual({ bottomPct: 90, heightPct: 10 });
    expect(bars[2].bottomPct).toBe(0);
    expect(bars[3]).toEqual({ bottomPct: 50, heightPct: 40 });
    expect(bars[5]).toEqual({ bottomPct: 0, heightPct: 50 });
    expect(bars[6].bottomPct).toBe(0);
  });

  it('waterfallBars: un paso mayor que el nivel no baja de 0', () => {
    const [, neg] = waterfallBars([{ amount: 10, kind: 'total' }, { amount: 30, kind: 'negative' }]);
    expect(neg.bottomPct).toBe(0);
    expect(neg.heightPct).toBe(100);
  });

  it('donutSegments acumula el desfase', () => {
    const segs = donutSegments([61, 22, 17]);
    expect(segs[0]).toEqual({ dasharray: '61 39', dashoffset: 0 });
    expect(segs[1].dashoffset).toBe(-61);
    expect(segs[2].dashoffset).toBe(-83);
  });
});
