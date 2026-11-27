import { describe, expect, it } from 'vitest';
import { buildChartSeries, buildQuickRead, compareSummaries, isAdditiveColumn, previousPeriod, type InsightCol } from './reportInsights';

const cols: InsightCol[] = [
    { key: 'name', header: 'Producto' },
    { key: 'amount', header: 'Monto', format: 'currency' },
    { key: 'unitPrice', header: 'Precio', format: 'currency' },
];

describe('reportInsights', () => {
    it('suma solo columnas de monto acumulables', () => {
        expect(isAdditiveColumn(cols[1])).toBe(true);
        expect(isAdditiveColumn(cols[2])).toBe(false);
        expect(isAdditiveColumn({ key: 'margin', header: 'Margen', format: 'currency', signColor: true })).toBe(false);
    });

    it('el gráfico excluye filas sin dato y no las dibuja como 0', () => {
        const items = [
            { name: 'A', amount: 60 },
            { name: 'B', amount: 40 },
            { name: 'C', amount: null },
        ];
        const s = buildChartSeries(items, cols)!;
        expect(s.items.map((i) => i.name)).toEqual(['A', 'B']);
        expect(s.items[1].cumulativePct).toBeCloseTo(100);
        expect(s.skipped).toBe(1);
        expect(s.title).toBe('Top 2 por Monto');
    });

    it('no grafica cuando hay valores negativos o una sola fila', () => {
        expect(buildChartSeries([{ name: 'A', amount: 1 }], cols)).toBeNull();
        expect(buildChartSeries([{ name: 'A', amount: -1 }, { name: 'B', amount: 5 }], cols)).toBeNull();
    });

    it('la lectura rápida cita el mayor y avisa de las filas N/D', () => {
        const lines = buildQuickRead({
            items: [{ name: 'A', amount: 75 }, { name: 'B', amount: 25 }, { name: 'C', amount: undefined }],
            cols,
            format: (_c, v) => `C$ ${v}`,
        });
        expect(lines[0]).toContain('3 registros');
        expect(lines[1]).toBe('Producto con mayor monto: A (C$ 75, 75.00 % del total).');
        expect(lines[2]).toContain('1 fila sin dato de monto (N/D)');
    });

    it('el periodo anterior tiene la misma duración y termina el día previo', () => {
        expect(previousPeriod('2026-11-01', '2026-11-10')).toEqual({ dateFrom: '2026-10-22', dateTo: '2026-10-31' });
        expect(previousPeriod('2026-11-10', '2026-11-01')).toBeNull();
    });

    it('la comparación omite textos y no inventa porcentaje con base 0', () => {
        const d = compareSummaries({ total: 150, topSupplier: 'X', zero: 5 }, { total: 100, topSupplier: 'Y', zero: 0 });
        expect(d.find((x) => x.key === 'total')?.pct).toBe(50);
        expect(d.find((x) => x.key === 'zero')?.pct).toBeNull();
        expect(d.some((x) => x.key === 'topSupplier')).toBe(false);
        expect(compareSummaries({ total: 1 }, null)).toEqual([]);
    });
});
