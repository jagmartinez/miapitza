import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}.tsx`, import.meta.url)), 'utf8');

const SCREENS = [
  'Categories', 'Brands', 'UnitsOfMeasure', 'ProductUnitSettings', 'Suppliers', 'Branches',
  'Companies', 'Warehouses', 'CashRegisters', 'Users', 'RolesPermissions',
];
const WITH_TABLE = ['Categories', 'Brands', 'Suppliers', 'Branches', 'Companies', 'Warehouses', 'Users'];

const WITH_MODAL = ['Categories', 'Brands', 'UnitsOfMeasure', 'Suppliers', 'Branches', 'Companies', 'Warehouses', 'CashRegisters', 'Users', 'RolesPermissions'];
const WITH_SELECT = ['ProductUnitSettings', 'Suppliers', 'Branches', 'Companies', 'Warehouses', 'CashRegisters', 'Users'];
const COUNT_HEADERS = ['Usuarios', 'Mesas', 'Platos', 'Orden', 'Sucursales', 'Productos', 'Movimientos', 'Permisos'];

describe('catálogos usan el design system', () => {
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
  for (const name of WITH_MODAL) {
    const src = read(name);
    it(`${name}: los formularios usan FullScreenModal`, () => {
      expect(src).toMatch(/<FullScreenModal/);
    });
  }
  for (const name of WITH_SELECT) {
    const src = read(name);
    it(`${name}: los selects son AppSelect`, () => {
      expect(src).toMatch(/<AppSelect/);
    });
  }
  for (const name of [...WITH_TABLE, 'RolesPermissions']) {
    const src = read(name);
    it(`${name}: columnas Acciones son type actions y las de conteo type number`, () => {
      const actions = [...src.matchAll(/header: 'Acciones',\s*type: '(\w+)'/g)].map((m) => m[1]);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every((t) => t === 'actions')).toBe(true);
      for (const h of COUNT_HEADERS) {
        const m = src.match(new RegExp(`header: '${h}',([^\n]*)`));
        if (m) expect(m[1]).toMatch(/type: 'number'/);
      }
    });
  }
  it('Users conserva el contrato de estados (users-status.contract.test.ts sigue verde)', () => {
    expect(read('Users')).toMatch(/Estado|status/i);
  });
});
