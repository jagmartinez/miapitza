import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { MenuItemService } from '../../services/menu-item.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('Menu sale-recipe readiness', () => {
    const stubScopedRefs = () => {
        jest.spyOn(
            MenuItemService as unknown as { assertScopedRefs: (...args: unknown[]) => Promise<void> },
            'assertScopedRefs'
        ).mockResolvedValue(undefined);
    };

    it('creates PREPARED menu items inactive until a sale recipe exists', async () => {
        stubScopedRefs();
        const create = jest.spyOn(prisma.menuItem, 'create').mockResolvedValue({
            id: 9,
            active: false,
            type: 'PREPARED',
            name: 'Pasta',
            category: { id: 1, name: 'Platos' }
        } as never);

        await MenuItemService.create(1, {
            categoryId: 1,
            name: 'Pasta',
            price: 12,
            type: 'PREPARED'
        });

        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ type: 'PREPARED', active: false })
        }));
    });

    it('excludes corrupt active PREPARED items without a BOM from operational catalogs', async () => {
        const findMany = jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([]);

        await MenuItemService.getAll(1, { active: true, branchId: 2 });

        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                active: true,
                AND: [{
                    OR: [
                        { type: 'DIRECT' },
                        { type: 'PREPARED', recipes: { some: {} } }
                    ]
                }]
            })
        }));
    });

    it('creates DIRECT menu items active without requiring a sale recipe', async () => {
        stubScopedRefs();
        const create = jest.spyOn(prisma.menuItem, 'create').mockResolvedValue({
            id: 10,
            active: true,
            type: 'DIRECT',
            name: 'Agua',
            category: { id: 1, name: 'Bebidas' }
        } as never);

        await MenuItemService.create(1, {
            categoryId: 1,
            name: 'Agua',
            price: 2,
            type: 'DIRECT'
        });

        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ type: 'DIRECT', active: true })
        }));
    });

    it('blocks activating a PREPARED item with an empty sale recipe', async () => {
        const tx = {
            menuItem: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, type: 'PREPARED', active: false, name: 'Pasta'
                })),
                update: jest.fn()
            },
            recipe: { count: jest.fn(async () => 0) }
        };
        stubScopedRefs();
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(MenuItemService.update(9, 1, { active: true }))
            .rejects.toThrow(/sin receta de venta/i);
        expect(tx.menuItem.update).not.toHaveBeenCalled();
    });

    it('blocks deleting the last sale-recipe line from an active PREPARED item', async () => {
        const tx = {
            recipe: {
                findFirst: jest.fn(async () => ({
                    id: 4,
                    menuItemId: 9,
                    menuItem: { active: true, type: 'PREPARED', name: 'Pasta' }
                })),
                count: jest.fn(async () => 0),
                delete: jest.fn()
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(MenuItemService.deleteRecipe(4, 1))
            .rejects.toThrow(/último ingrediente/i);
        expect(tx.recipe.delete).not.toHaveBeenCalled();
    });

    it('replaces the last ingredient atomically after validating every new line', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            menuItem: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, active: true, type: 'PREPARED', name: 'Pasta'
                }))
            },
            product: {
                findMany: jest.fn(async () => [{ id: 20, unit: 'kg' }])
            },
            unitOfMeasure: {
                findFirst: jest.fn(async () => ({ id: 3 }))
            },
            recipe: {
                deleteMany: jest.fn(async (_args: unknown) => ({ count: 1 })),
                createMany: jest.fn(async (_args: unknown) => ({ count: 1 })),
                findMany: jest.fn(async () => [{ id: 11, menuItemId: 9, productId: 20 }])
            }
        };
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            baseQuantity: 0.25,
            conversionFactor: 1,
            originalQuantity: 0.25,
            originalUnit: 'kg',
            baseUnit: 'kg'
        });
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await MenuItemService.replaceRecipes(9, 1, [
            { productId: 20, quantity: 0.25, unit: 'kg' }
        ]);

        expect(tx.recipe.deleteMany).toHaveBeenCalledWith({ where: { menuItemId: 9 } });
        expect(tx.recipe.createMany).toHaveBeenCalledWith({
            data: [{ menuItemId: 9, productId: 20, quantity: 0.25, unit: 'kg', unitId: 3 }]
        });
    });

    it('keeps the previous recipe untouched when a replacement line is invalid', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            menuItem: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, active: true, type: 'PREPARED', name: 'Pasta'
                }))
            },
            product: {
                findMany: jest.fn(async () => [{ id: 20, unit: 'kg' }])
            },
            unitOfMeasure: { findFirst: jest.fn() },
            recipe: {
                deleteMany: jest.fn(),
                createMany: jest.fn(),
                findMany: jest.fn()
            }
        };
        jest.spyOn(UnitConversionService, 'convert').mockRejectedValue(new Error('Unidad incompatible'));
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(MenuItemService.replaceRecipes(9, 1, [
            { productId: 20, quantity: 0.25, unit: 'gal' }
        ])).rejects.toThrow(/incompatible/i);
        expect(tx.recipe.deleteMany).not.toHaveBeenCalled();
        expect(tx.recipe.createMany).not.toHaveBeenCalled();
    });

    it('rejects invalid menu metadata before replacing any recipe row', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => []),
            menuItem: {
                findFirst: jest.fn(async () => ({
                    id: 9, companyId: 1, active: true, type: 'PREPARED', name: 'Pasta'
                })),
                update: jest.fn()
            },
            category: { findFirst: jest.fn(async () => null) },
            menuBrand: { findFirst: jest.fn() },
            branch: { findFirst: jest.fn() },
            product: { findMany: jest.fn() },
            recipe: {
                deleteMany: jest.fn(),
                createMany: jest.fn(),
                findMany: jest.fn()
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(MenuItemService.replaceRecipes(
            9,
            1,
            [{ productId: 20, quantity: 0.25, unit: 'kg' }],
            { categoryId: 999, name: 'Pasta nueva', active: true, type: 'PREPARED' }
        )).rejects.toThrow(/categoría/i);

        expect(tx.recipe.deleteMany).not.toHaveBeenCalled();
        expect(tx.menuItem.update).not.toHaveBeenCalled();
    });
});
