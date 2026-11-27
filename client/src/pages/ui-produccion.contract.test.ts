import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (file: string) => readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');

// Misma heurística que la guarda no-legacy: .toFixed( en una línea de JSX.
const jsxToFixed = (source: string) =>
  source.split(/\r?\n/).filter((l) => l.includes('.toFixed(') && /<\/|\/>|<[A-Za-z]|^\s*\{/.test(l));

describe('menu y producción usan el design system', () => {
  const pages = ['Menu.tsx', 'ProductionRecipes.tsx', 'ProductionOrders.tsx', 'ProductionDashboard.tsx'];

  for (const page of pages) {
    describe(page, () => {
      const source = read(page);
      it('usa PageHeader de @/ui', () => {
        expect(source).toMatch(/from '@\/ui'/);
        expect(source).toContain('<PageHeader');
      });
      it('no usa selects, tablas ni modales legados', () => {
        expect(source).not.toMatch(/from '\.\.\/components\/Select'/);
        expect(source).not.toMatch(/from 'react-select/);
        expect(source).not.toMatch(/<select[\s>]/);
        expect(source).not.toMatch(/<table[\s>]/);
        expect(jsxToFixed(source)).toEqual([]);
        expect(source).not.toMatch(/from '\.\.\/components\/Sidebar'/);
        expect(source).not.toMatch(/from '\.\.\/components\/Modal'/);
      });
    });
  }

  it('Menu: tabla DataTable con costos y formularios en FullScreenModal', () => {
    const source = read('Menu.tsx');
    expect(source).toContain('<DataTable');
    expect(source).toContain('<FullScreenModal');
    expect(source).toContain('<AppSelect');
    expect(source).toContain('classifyMenu');
    for (const header of ['Costo', 'Food cost', 'Margen', 'Vend. 30 d']) {
      expect(source).toContain(header);
    }
  });

  it('ProductionRecipes y ProductionOrders: tablas DataTable y formularios FullScreenModal', () => {
    for (const page of ['ProductionRecipes.tsx', 'ProductionOrders.tsx']) {
      const source = read(page);
      expect(source).toContain('<DataTable');
      expect(source).toContain('<FullScreenModal');
    }
  });

  it('ProductionOrders: costo estimado, real y variación', () => {
    const source = read('ProductionOrders.tsx');
    for (const header of ['Costo estimado', 'Costo real', 'Variación']) expect(source).toContain(header);
  });
});
