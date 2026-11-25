import { describe, expect, it, jest } from '@jest/globals';
import { MenuAvailabilityService, LOW_STOCK_PORTIONS, type MenuAvailabilityDb } from '../../services/menu-availability.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

const recipe = (productId: number, quantity: number, unit = 'kg') => ({
    productId,
    quantity,
    unit,
    unitOfMeasure: null,
    product: { unit: 'kg', baseUnit: { abbreviation: 'kg' } },
});

function makeDb(opts: {
    warehouse?: { id: number; branchId: number | null } | null;
    items: Array<{ id: number; recipes: ReturnType<typeof recipe>[] }>;
    stocks: Array<{ productId: number; quantity: number }>;
}): MenuAvailabilityDb {
    return {
        warehouse: { findFirst: jest.fn(async () => (opts.warehouse === undefined ? { id: 7, branchId: 3 } : opts.warehouse)) },
        menuItem: { findMany: jest.fn(async () => opts.items) },
        stock: { findMany: jest.fn(async () => opts.stocks) },
    } as unknown as MenuAvailabilityDb;
}

const identityConversion = () =>
    jest.spyOn(UnitConversionService, 'convert').mockImplementation((async (_p: number, _c: number, qty: number) => ({ baseQuantity: qty })) as never);

describe('MenuAvailabilityService.forWarehouse', () => {
    it('reports OUT without stock for one ingredient and OK when portions reach the threshold', async () => {
        identityConversion();
        const db = makeDb({
            items: [
                { id: 1, recipes: [recipe(10, 0.5), recipe(11, 1)] },
                { id: 2, recipes: [recipe(10, 0.5)] },
                { id: 3, recipes: [recipe(12, 1)] },
            ],
            stocks: [
                { productId: 10, quantity: 10 },
                { productId: 11, quantity: 0 },
                { productId: 12, quantity: LOW_STOCK_PORTIONS },
            ],
        });
        const result = await MenuAvailabilityService.forWarehouse(db, { companyId: 1, warehouseId: 7 });
        const byId = new Map(result!.items.map((item) => [item.menuItemId, item]));
        expect(byId.get(1)).toMatchObject({ status: 'OUT', portions: 0 });
        expect(byId.get(2)).toMatchObject({ status: 'OK', portions: 20 });
        expect(byId.get(3)).toMatchObject({ status: 'OK', portions: LOW_STOCK_PORTIONS });
    });

    it('marks LOW below the threshold using the scarcest ingredient', async () => {
        identityConversion();
        const db = makeDb({
            items: [{ id: 1, recipes: [recipe(10, 2), recipe(11, 1)] }],
            stocks: [{ productId: 10, quantity: 5 }, { productId: 11, quantity: 100 }],
        });
        const result = await MenuAvailabilityService.forWarehouse(db, { companyId: 1, warehouseId: 7 });
        expect(result!.items[0]).toMatchObject({ menuItemId: 1, status: 'LOW', portions: 2 });
    });

    it('applies the unit conversion factor to the recipe quantity', async () => {
        jest.spyOn(UnitConversionService, 'convert').mockImplementation((async () => ({ baseQuantity: 0.001 })) as never);
        const db = makeDb({
            items: [{ id: 1, recipes: [recipe(10, 200, 'g')] }],
            stocks: [{ productId: 10, quantity: 1 }],
        });
        const result = await MenuAvailabilityService.forWarehouse(db, { companyId: 1, warehouseId: 7 });
        expect(result!.items[0]).toMatchObject({ portions: 5, status: 'OK' });
    });

    it('omits dishes without recipes or whose unit conversion fails instead of inventing a status', async () => {
        jest.spyOn(UnitConversionService, 'convert').mockImplementation((async (productId: number, _c: number, qty: number) => {
            if (productId === 99) throw new Error('unidad incompatible');
            return { baseQuantity: qty };
        }) as never);
        const db = makeDb({
            items: [
                { id: 1, recipes: [] },
                { id: 2, recipes: [recipe(99, 1)] },
                { id: 3, recipes: [recipe(10, 1)] },
            ],
            stocks: [{ productId: 10, quantity: 50 }],
        });
        const result = await MenuAvailabilityService.forWarehouse(db, { companyId: 1, warehouseId: 7 });
        expect(result!.items.map((item) => item.menuItemId)).toEqual([3]);
    });

    it('treats a missing stock row as zero stock', async () => {
        identityConversion();
        const db = makeDb({ items: [{ id: 1, recipes: [recipe(10, 1)] }], stocks: [] });
        const result = await MenuAvailabilityService.forWarehouse(db, { companyId: 1, warehouseId: 7 });
        expect(result!.items[0]).toMatchObject({ status: 'OUT', portions: 0 });
    });

    it('returns null when the warehouse does not belong to the company', async () => {
        const db = makeDb({ warehouse: null, items: [], stocks: [] });
        await expect(MenuAvailabilityService.forWarehouse(db, { companyId: 1, warehouseId: 7 })).resolves.toBeNull();
    });

    it('only reads: the simulated client exposes no write methods', async () => {
        identityConversion();
        const db = makeDb({ items: [{ id: 1, recipes: [recipe(10, 1)] }], stocks: [{ productId: 10, quantity: 9 }] });
        await MenuAvailabilityService.forWarehouse(db, { companyId: 1, warehouseId: 7 });
        expect(Object.keys((db as unknown as Record<string, object>).stock)).toEqual(['findMany']);
        expect(Object.keys((db as unknown as Record<string, object>).menuItem)).toEqual(['findMany']);
    });
});
