import fs from 'fs';
import path from 'path';
import { normalizeRecipeQuantity, resolveRecipeUnit } from '../../utils/recipe-unit';

describe('recipe/cost/unit precision migration', () => {
    const root = path.resolve(__dirname, '../../..');
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
    const dir = path.join(root, 'prisma/migrations/20260801_widen_recipe_cost_unit_precision');
    const sql = fs.readFileSync(path.join(dir, 'migration.sql'), 'utf8');
    const rollback = fs.readFileSync(path.join(dir, 'rollback.sql'), 'utf8');

    it('widens the schema columns the migration alters', () => {
        expect(schema).toMatch(/model Recipe \{[\s\S]*?quantity\s+Decimal @db\.Decimal\(18, 6\)/);
        expect(schema).toMatch(/consumeQuantity Decimal\? @db\.Decimal\(18, 6\)/);
        expect(schema).toMatch(/model ProductUnit \{[\s\S]*?conversionFactor Decimal @db\.Decimal\(24, 12\)/);
        expect(schema).toMatch(/model Product \{[\s\S]*?cost\s+Decimal\s+@default\(0\) @db\.Decimal\(18, 6\)/);
    });

    it('only widens (never narrows) so existing values are preserved', () => {
        expect(sql).toContain('MODIFY `quantity` DECIMAL(18, 6) NOT NULL');
        expect(sql).toContain('MODIFY `consumeQuantity` DECIMAL(18, 6) NULL');
        expect(sql).toContain('MODIFY `cost` DECIMAL(18, 6) NOT NULL DEFAULT 0');
        expect(sql).toContain('MODIFY `conversionFactor` DECIMAL(24, 12) NOT NULL');
        expect(sql).not.toMatch(/DROP|UPDATE|DELETE/i);
        expect(rollback).toContain('MODIFY `quantity` DECIMAL(10, 3) NOT NULL');
        expect(rollback).toContain('MODIFY `conversionFactor` DECIMAL(18, 6) NOT NULL');
    });
});

describe('recipe-unit helpers', () => {
    it('resolves units with the sales priority: line unit, line FK, base unit, legacy unit', () => {
        const product = { unit: 'lb', baseUnit: { abbreviation: 'g' } };
        expect(resolveRecipeUnit({ unit: 'kg', unitOfMeasure: { abbreviation: 'oz' } }, product)).toBe('kg');
        expect(resolveRecipeUnit({ unit: ' ', unitOfMeasure: { abbreviation: 'oz' } }, product)).toBe('oz');
        expect(resolveRecipeUnit({ unit: null, unitOfMeasure: null }, product)).toBe('g');
        expect(resolveRecipeUnit({}, { unit: 'lb', baseUnit: null })).toBe('lb');
    });

    it('validates the stored (rounded) recipe quantity, not the raw input', () => {
        expect(normalizeRecipeQuantity(0.0004)).toBe(0.0004);
        expect(normalizeRecipeQuantity('0.0000015')).toBe(0.000002);
        expect(() => normalizeRecipeQuantity(0.0000004)).toThrow(/demasiado pequeña/);
        expect(() => normalizeRecipeQuantity(0)).toThrow(/mayor a 0/);
        expect(() => normalizeRecipeQuantity('abc')).toThrow(/mayor a 0/);
    });
});
