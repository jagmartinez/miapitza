import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}.tsx`, import.meta.url)), 'utf8');

const SCREENS = [
  'Inventory', 'Kardex', 'WasteReport', 'CostReport',
];
const WITH_TABLE = ['Inventory', 'Kardex', 'WasteReport', 'CostReport'];

describe('inventario usa el design system', () => {
  for (const name of SCREENS) {
    describe(name, () => {
      const src = read(name);
      it('importa de @/ui y no de los adaptadores heredados', () => {
        expect(src).toMatch(/from '@\/ui'/);
        expect(src).not.toMatch(/components\/(PageHeader|Sidebar|CatalogTable|Select|Button|Pagination)'/);
        expect(src).not.toMatch(/from 'react-select'/);
      });
      it('usa PageHeader, sin <table> ni <select> nativos ni toFixed en JSX', () => {
        expect(src).toMatch(/<PageHeader\b/);
        expect(src).not.toMatch(/<table[\s>]/);
        expect(src).not.toMatch(/<select[\s>]/);
        expect(src.split(/\r?\n/).filter((l) => l.includes('.toFixed(') && /<\/|\/>|<[A-Za-z]|^\s*\{/.test(l))).toEqual([]);
      });
      if (WITH_TABLE.includes(name)) {
        it('las tablas son DataTable', () => {
          expect(src).toMatch(/<DataTable\b/);
        });
      }
    });
  }
});
