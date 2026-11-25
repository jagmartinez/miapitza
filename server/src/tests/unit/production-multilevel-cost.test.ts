import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { ProductionRecipeService } from '../../services/production-recipe.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

afterEach(() => {
    jest.restoreAllMocks();
});

const conversion = (quantity: number, unit: string) => ({
    baseQuantity: quantity,
    conversionFactor: 1,
    originalQuantity: quantity,
    originalUnit: unit,
    baseUnit: unit
});

describe('ProductionRecipeService multilevel cost resolution', () => {
    it('derives an uncosted intermediate from its active production recipe', async () => {
        jest.spyOn(UnitConversionService, 'convert').mockImplementation(
            (async (_productId: number, _companyId: number, quantity: number, unit: string) => (
                conversion(quantity, unit)
            )) as never
        );

        const rootRecipe = {
            id: 10,
            productId: 100,
            yieldQuantity: 1,
            yieldUnit: null,
            product: { id: 100, unit: 'g', baseUnit: { abbreviation: 'g' } },
            components: [{
                componentProductId: 200,
                quantity: 2,
                unit: 'g',
                unitOfMeasure: null,
                componentProduct: {
                    id: 200, name: 'Masa precocida', type: 'INTERMEDIATE', unit: 'g',
                    currentAverageCost: 0, cost: 0, baseUnit: { abbreviation: 'g' }
                }
            }]
        };
        const intermediateRecipe = {
            id: 20,
            productId: 200,
            yieldQuantity: 10,
            yieldUnit: null,
            product: { id: 200, unit: 'g', baseUnit: { abbreviation: 'g' } },
            components: [{
                componentProductId: 300,
                quantity: 5,
                unit: 'g',
                unitOfMeasure: null,
                componentProduct: {
                    id: 300, name: 'Harina', type: 'RAW_MATERIAL', unit: 'g',
                    currentAverageCost: 4, cost: 4, baseUnit: { abbreviation: 'g' }
                }
            }]
        };
        const db = {
            product: {
                findFirst: jest.fn(async ({ where }: { where: { id: number } }) => (
                    where.id === 200
                        ? { currentAverageCost: 0, cost: 0 }
                        : { currentAverageCost: 4, cost: 4 }
                ))
            },
            productionRecipe: {
                findFirst: jest.fn(async ({ where }: { where: { id?: number; productId?: number } }) => {
                    if (where.id === 10) return rootRecipe;
                    if (where.id === 20) return intermediateRecipe;
                    if (where.productId === 200) return { id: 20 };
                    return null;
                })
            }
        } as unknown as Parameters<typeof ProductionRecipeService.computeRecipeCost>[2];

        const cost = await ProductionRecipeService.computeRecipeCost(10, 1, db);

        // Intermediate: 5 g * 4 / 10 g = 2 per g. Root consumes 2 g.
        expect(cost.batchCost).toBe(4);
        expect(cost.unitCost).toBe(4);
        expect(cost.lines[0].unitCost).toBe(2);
    });

    it('fails closed when a legacy active-recipe cycle is encountered', async () => {
        jest.spyOn(UnitConversionService, 'convert').mockImplementation(
            (async (_productId: number, _companyId: number, quantity: number, unit: string) => (
                conversion(quantity, unit)
            )) as never
        );

        const recipe = (id: number, productId: number, componentProductId: number) => ({
            id,
            productId,
            yieldQuantity: 1,
            yieldUnit: null,
            product: { id: productId, unit: 'g', baseUnit: { abbreviation: 'g' } },
            components: [{
                componentProductId,
                quantity: 1,
                unit: 'g',
                unitOfMeasure: null,
                componentProduct: {
                    id: componentProductId, name: `Product ${componentProductId}`,
                    type: 'INTERMEDIATE', unit: 'g', currentAverageCost: 0, cost: 0,
                    baseUnit: { abbreviation: 'g' }
                }
            }]
        });
        const db = {
            product: { findFirst: jest.fn(async () => ({ currentAverageCost: 0, cost: 0 })) },
            productionRecipe: {
                findFirst: jest.fn(async ({ where }: { where: { id?: number; productId?: number } }) => {
                    if (where.id === 10) return recipe(10, 100, 200);
                    if (where.id === 20) return recipe(20, 200, 100);
                    if (where.productId === 200) return { id: 20 };
                    if (where.productId === 100) return { id: 10 };
                    return null;
                })
            }
        } as unknown as Parameters<typeof ProductionRecipeService.computeRecipeCost>[2];

        await expect(ProductionRecipeService.computeRecipeCost(10, 1, db))
            .rejects.toThrow(/circular/i);
    });
});
