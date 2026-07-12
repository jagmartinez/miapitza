import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import prisma from '../../utils/prisma';
import { ProductionRecipeService } from '../../services/production-recipe.service';

describe('Production recipe authoritative cost preview (integration)', () => {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    let companyId: number;
    let categoryId: number;
    let outputId: number;
    let oilId: number;
    let countUnitId: number;
    let mlUnitId: number;
    let kgUnitId: number;
    let recipeId: number;

    beforeAll(async () => {
        const company = await prisma.company.create({ data: { name: `Recipe cost ${suffix}` } });
        companyId = company.id;
        const category = await prisma.category.create({ data: {
            companyId, name: `Recipe cost category ${suffix}`, codePrefix: `RC${companyId}`, showInInventory: true
        } });
        categoryId = category.id;
        const [countUnit, mlUnit, kgUnit] = await Promise.all([
            prisma.unitOfMeasure.create({ data: { companyId, name: 'Unidad', abbreviation: 'unidad', measurementType: 'UNIT', systemFactor: 1 } }),
            prisma.unitOfMeasure.create({ data: { companyId, name: 'Mililitro', abbreviation: 'ml', measurementType: 'VOLUME', systemFactor: 1 } }),
            prisma.unitOfMeasure.create({ data: { companyId, name: 'Kilogramo', abbreviation: 'kg', measurementType: 'MASS', systemFactor: 1000 } }),
        ]);
        countUnitId = countUnit.id; mlUnitId = mlUnit.id; kgUnitId = kgUnit.id;
        const [output, oil] = await Promise.all([
            prisma.product.create({ data: {
                companyId, categoryId, name: `Brownie ${suffix}`, sku: `BROWNIE-${suffix}`,
                type: 'INTERMEDIATE', unit: 'unidad', baseUnitId: countUnitId
            } }),
            prisma.product.create({ data: {
                companyId, categoryId, name: `Oil ${suffix}`, sku: `OIL-${suffix}`,
                type: 'INGREDIENT', unit: 'ml', baseUnitId: mlUnitId,
                currentAverageCost: 0, cost: 0.35
            } }),
        ]);
        outputId = output.id; oilId = oil.id;
        await prisma.productUnit.createMany({ data: [
            { companyId, productId: outputId, unitId: countUnitId, conversionFactor: 1 },
            { companyId, productId: oilId, unitId: mlUnitId, conversionFactor: 1 },
        ] });
        const recipe = await ProductionRecipeService.create(companyId, {
            productId: outputId,
            yieldQuantity: 12,
            yieldUnitId: countUnitId,
            components: [{ componentProductId: oilId, quantity: 250, unitId: mlUnitId }],
        });
        recipeId = recipe.id;
    });

    afterAll(async () => {
        if (!companyId) return;
        await prisma.productionRecipeComponent.deleteMany({ where: { recipe: { companyId } } });
        await prisma.productionRecipe.deleteMany({ where: { companyId } });
        await prisma.productUnit.deleteMany({ where: { companyId } });
        await prisma.product.deleteMany({ where: { companyId } });
        await prisma.unitOfMeasure.deleteMany({ where: { companyId } });
        await prisma.category.deleteMany({ where: { companyId } });
        await prisma.company.delete({ where: { id: companyId } });
    });

    it('falls back from zero average to positive reference cost after UOM conversion', async () => {
        const cost = await ProductionRecipeService.computeRecipeCost(recipeId, companyId);
        expect(cost.lines[0].baseQuantity).toBe(250);
        expect(cost.lines[0].unitCost).toBeCloseTo(0.35, 6);
        expect(cost.batchCost).toBeCloseTo(87.5, 6);
        expect(cost.unitCost).toBeCloseTo(7.291667, 6);
        const listed = await ProductionRecipeService.list(companyId);
        expect(listed[0].cost?.batchCost).toBeCloseTo(87.5, 6);
        expect(listed[0].costError).toBeNull();
    });

    it('uses selected unitId authoritatively and rejects an incompatible unit', async () => {
        await expect(ProductionRecipeService.previewCost(companyId, {
            productId: outputId,
            yieldQuantity: 12,
            yieldUnitId: countUnitId,
            components: [{ componentProductId: oilId, quantity: 250, unitId: kgUnitId }],
        })).rejects.toThrow(/no permitida|compatible/i);
    });
});
