import { describe, expect, it, jest } from '@jest/globals';
import type { Prisma } from '@prisma/client';

import { UnitConversionService } from '../../services/unit-conversion.service';

type Tx = Prisma.TransactionClient;

/**
 * Minimal `tx` stub. `convert` reads `product.findFirst` (with baseUnit +
 * allowedUnits) and, when no base unit is configured, falls back to
 * `unitOfMeasure.findUnique/findFirst` (legacy inference). The latter return
 * null here so the "no configured units" branch is exercised.
 */
function makeDb(product: unknown): Tx {
    return {
        product: { findFirst: jest.fn(async () => product) },
        unitOfMeasure: {
            findUnique: jest.fn(async () => null),
            findFirst: jest.fn(async () => null)
        }
    } as unknown as Tx;
}

const flourBaseGrams = {
    id: 1,
    companyId: 1,
    name: 'Harina',
    unit: 'g',
    baseUnit: { abbreviation: 'g', measurementType: 'MASS', systemFactor: 1 },
    allowedUnits: [
        {
            conversionFactor: 1000,
            unit: { abbreviation: 'kg', measurementType: 'MASS', systemFactor: 1000 }
        }
    ]
};

describe('Unit conversion numeric invariants', () => {
    it.each([
        [0.001, 2.5, 0.0025], [0.125, 8, 1], [1000, 2.5, 2500], [1_000_000, 0.000001, 1]
    ])('preserves quantity times factor for factor %s and quantity %s', async (factor, quantity, expected) => {
        const db = makeDb({ ...flourBaseGrams, allowedUnits: [{ conversionFactor: factor, unit: { abbreviation: 'x' } }] });
        const res = await UnitConversionService.convert(1, 1, quantity, 'x', db);
        expect(res.baseQuantity).toBeCloseTo(expected, 12);
    });

    it.each([NaN, Infinity, -Infinity, 0, -1])('rejects invalid quantity %s', async (quantity) => {
        await expect(UnitConversionService.convert(1, 1, quantity, 'kg', makeDb(flourBaseGrams))).rejects.toThrow(/finito/i);
    });

    it.each([NaN, Infinity, -Infinity, -0.01])('rejects invalid unit cost %s', async (cost) => {
        await expect(UnitConversionService.convertWithCost(1, 1, 1, 'kg', cost, makeDb(flourBaseGrams))).rejects.toThrow(/costo/i);
    });
});

describe('UnitConversionService.convert — base-unit math', () => {
    it('converts a purchase in kg to grams (base = g): 1 kg -> 1000 g', async () => {
        const db = makeDb(flourBaseGrams);
        const res = await UnitConversionService.convert(1, 1, 1, 'kg', db);
        expect(res.baseQuantity).toBe(1000);
        expect(res.conversionFactor).toBe(1000);
        expect(res.baseUnit).toBe('g');
    });

    it('returns 1:1 when the requested unit IS the base unit (200 g -> 200 g)', async () => {
        const db = makeDb(flourBaseGrams);
        const res = await UnitConversionService.convert(1, 1, 200, 'g', db);
        expect(res.baseQuantity).toBe(200);
        expect(res.conversionFactor).toBe(1);
    });

    it('normalizes legacy aliases (kilos -> kg) before applying the factor', async () => {
        const db = makeDb(flourBaseGrams);
        const res = await UnitConversionService.convert(1, 1, 2, 'kilos', db);
        expect(res.baseQuantity).toBe(2000);
    });
});

describe('UnitConversionService.convert — fail-fast (no silent 1:1)', () => {
    it('throws when no units are configured and the requested unit differs from the product unit', async () => {
        const db = makeDb({
            id: 1,
            companyId: 1,
            name: 'Producto sin unidades',
            unit: 'g',
            baseUnit: null,
            allowedUnits: []
        });
        await expect(UnitConversionService.convert(1, 1, 2, 'kg', db)).rejects.toThrow(
            /no tiene unidades configuradas/i
        );
    });

    it('still allows 1:1 when no units are configured but the requested unit equals the product unit', async () => {
        const db = makeDb({
            id: 1,
            companyId: 1,
            name: 'Producto sin unidades',
            unit: 'g',
            baseUnit: null,
            allowedUnits: []
        });
        const res = await UnitConversionService.convert(1, 1, 5, 'g', db);
        expect(res.baseQuantity).toBe(5);
        expect(res.conversionFactor).toBe(1);
    });
});

describe('UnitConversionService.convertWithCost — base cost', () => {
    it('divides the purchase cost by the factor: C$500/kg -> C$0.5/g', async () => {
        const db = makeDb(flourBaseGrams);
        const res = await UnitConversionService.convertWithCost(1, 1, 1, 'kg', 500, db);
        expect(res.baseQuantity).toBe(1000);
        expect(res.baseCost).toBeCloseTo(0.5, 9);
    });

    it('throws on a non-positive conversion factor instead of corrupting cost', async () => {
        const db = makeDb({
            id: 1,
            companyId: 1,
            name: 'Factor corrupto',
            unit: 'g',
            baseUnit: { abbreviation: 'g', measurementType: 'MASS', systemFactor: 1 },
            allowedUnits: [
                {
                    conversionFactor: 0,
                    unit: { abbreviation: 'kg', measurementType: 'MASS', systemFactor: 1000 }
                }
            ]
        });
        await expect(
            UnitConversionService.convertWithCost(1, 1, 1, 'kg', 500, db)
        ).rejects.toThrow(/Factor de conversión inválido/i);
    });
});
