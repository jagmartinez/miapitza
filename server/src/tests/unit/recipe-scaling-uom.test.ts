import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { RecipeScalingService } from '../../services/recipe-scaling.service';
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
});
