import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { RecipeScalingService } from '../../services/recipe-scaling.service';
import { ProductionRecipeService } from '../../services/production-recipe.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

describe('RecipeScalingService UOM failures', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('fails closed instead of returning a zero ingredient cost', async () => {
        jest.spyOn(prisma.recipe, 'findFirst').mockResolvedValue({
            id: 1, menuItemId: 8, productId: 4, menuItem: { name: 'Pizza' },
            product: { name: 'Harina', unit: 'kg', cost: 2 }
        } as never);
        jest.spyOn(prisma.recipe, 'findMany').mockResolvedValue([{
            id: 1, menuItemId: 8, productId: 4, quantity: 500, unit: 'ml',
            unitOfMeasure: null,
            product: { name: 'Harina', unit: 'kg', cost: 2, currentAverageCost: 2 }
        }] as never);
        jest.spyOn(UnitConversionService, 'convert').mockRejectedValue(new Error('Dimensiones incompatibles'));

        await expect(RecipeScalingService.scaleRecipe(1, 2, 4))
            .rejects.toThrow('Harina');
    });

    it('derives the cost of an unproduced intermediate from its active production recipe', async () => {
        jest.spyOn(prisma.recipe, 'findFirst').mockResolvedValue({
            id: 1, menuItemId: 8, productId: 4, menuItem: { name: 'Pizza' },
            product: { name: 'Masa', unit: 'g', cost: 0 }
        } as never);
        jest.spyOn(prisma.recipe, 'findMany').mockResolvedValue([{
            id: 1, menuItemId: 8, productId: 4, quantity: 2, unit: 'g',
            unitOfMeasure: null,
            product: { name: 'Masa', unit: 'g', cost: 0, currentAverageCost: 0 }
        }] as never);
        const resolveCost = jest.spyOn(ProductionRecipeService, 'resolveProductUnitCost').mockResolvedValue(7);
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            originalQuantity: 2, originalUnit: 'g', baseQuantity: 2, baseUnit: 'g', conversionFactor: 1
        });

        const result = await RecipeScalingService.scaleRecipe(1, 2, 1);

        expect(resolveCost).toHaveBeenCalledWith(4, 2);
        expect(result.ingredients[0]).toEqual(expect.objectContaining({ unitCost: 7, totalCost: 14 }));
        expect(result.totalCost).toBe(14);
    });

    it('normalizes homogeneous masses to the canonical unit before summing yield input', async () => {
        jest.spyOn(prisma.menuItem, 'findFirst').mockResolvedValue({ id: 8 } as never);
        jest.spyOn(prisma.recipe, 'findMany').mockResolvedValue([
            { productId: 1, quantity: 1, unit: 'kg', unitOfMeasure: null, product: { name: 'Harina', unit: 'kg' } },
            { productId: 2, quantity: 500, unit: 'g', unitOfMeasure: null, product: { name: 'Azúcar', unit: 'g' } }
        ] as never);
        jest.spyOn(UnitConversionService, 'convert').mockImplementation(async (productId) => productId === 1
            ? { originalQuantity: 1, originalUnit: 'kg', baseQuantity: 1, baseUnit: 'kg', conversionFactor: 1 }
            : { originalQuantity: 500, originalUnit: 'g', baseQuantity: 500, baseUnit: 'g', conversionFactor: 1 });
        jest.spyOn(ProductionRecipeService, 'resolveProductUnitCost').mockResolvedValue(2);
        jest.spyOn(prisma.unitOfMeasure, 'findFirst').mockImplementation((async (args: {
            where: { abbreviation?: string; measurementType?: string; systemFactor?: number };
        }) => {
            if (args.where.abbreviation === 'kg') return { abbreviation: 'kg', measurementType: 'MASS', systemFactor: 1000 };
            if (args.where.abbreviation === 'g') return { abbreviation: 'g', measurementType: 'MASS', systemFactor: 1 };
            if (args.where.measurementType === 'MASS' && args.where.systemFactor === 1) return { abbreviation: 'g' };
            return null;
        }) as never);

        const result = await RecipeScalingService.calculateYield(8, 2, { wastePercentage: 10, portionSize: 100 });

        expect(result.input).toEqual({ totalWeight: 1500, unit: 'g', ingredients: 2 });
        expect(result.output).toEqual(expect.objectContaining({ totalWeight: 1350, unit: 'g', numberOfPortions: 13 }));
    });

    it('fails closed instead of summing mass and volume in one yield', async () => {
        jest.spyOn(prisma.menuItem, 'findFirst').mockResolvedValue({ id: 8 } as never);
        jest.spyOn(prisma.recipe, 'findMany').mockResolvedValue([
            { productId: 1, quantity: 1, unit: 'g', unitOfMeasure: null, product: { name: 'Harina', unit: 'g' } },
            { productId: 2, quantity: 1, unit: 'ml', unitOfMeasure: null, product: { name: 'Agua', unit: 'ml' } }
        ] as never);
        jest.spyOn(UnitConversionService, 'convert').mockImplementation(async (productId) => productId === 1
            ? { originalQuantity: 1, originalUnit: 'g', baseQuantity: 1, baseUnit: 'g', conversionFactor: 1 }
            : { originalQuantity: 1, originalUnit: 'ml', baseQuantity: 1, baseUnit: 'ml', conversionFactor: 1 });
        jest.spyOn(ProductionRecipeService, 'resolveProductUnitCost').mockResolvedValue(1);
        jest.spyOn(prisma.unitOfMeasure, 'findFirst').mockImplementation((async (args: {
            where: { abbreviation?: string };
        }) => args.where.abbreviation === 'g'
            ? { abbreviation: 'g', measurementType: 'MASS', systemFactor: 1 }
            : { abbreviation: 'ml', measurementType: 'VOLUME', systemFactor: 1 }) as never);

        await expect(RecipeScalingService.calculateYield(8, 2, {}))
            .rejects.toThrow(/mediciones heterogéneas/i);
    });
});
