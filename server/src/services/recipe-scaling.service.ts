import prisma from '../utils/prisma';
import { effectiveUnitCost } from '../utils/product-cost';
import { ProductionRecipeService } from './production-recipe.service';
import { UnitConversionService } from './unit-conversion.service';

/**
 * Recipe Scaling Service
 * Handles portion management, scaling, and sub-recipes
 */
export class RecipeScalingService {
    /**
     * Scale a recipe to a different number of portions
     */
    static async scaleRecipe(recipeId: number, companyId: number, targetPortions: number) {
        if (!targetPortions || targetPortions <= 0) {
            throw new Error('Target portions must be a positive number');
        }
        const recipe = await prisma.recipe.findFirst({
            where: { id: recipeId, menuItem: { companyId } },
            include: {
                menuItem: { select: { name: true } },
                product: {
                    select: { name: true, unit: true, cost: true }
                }
            }
        });

        if (!recipe) {
            throw new Error('Receta no encontrada');
        }

        // Get all ingredients for this menu item's recipes
        const recipes = await prisma.recipe.findMany({
            where: { menuItemId: recipe.menuItemId },
            include: {
                product: {
                    select: { name: true, unit: true, cost: true, currentAverageCost: true }
                },
                unitOfMeasure: { select: { abbreviation: true } }
            }
        });

        // Assume base recipe is for 1 portion
        const basePortions = 1;
        const scaleFactor = targetPortions / basePortions;

        // Cost in base units: convert the scaled quantity with the recipe's unit
        // (recipe.unit -> recipe.unitId abbreviation -> product.unit) and value it
        // with the weighted average first and catalog reference as fallback.
        const scaledIngredients = await Promise.all(recipes.map(async (r) => {
            const recipeUnit = r.unit || r.unitOfMeasure?.abbreviation || r.product.unit;
            const scaledQty = Number(r.quantity) * scaleFactor;

            try {
                // Intermediate products can have no stored average until their first
                // production. The production resolver derives their ACTIVE-BOM cost
                // and detects circular dependencies instead of displaying a false 0.
                const unitCost = await ProductionRecipeService.resolveProductUnitCost(r.productId, companyId);
                const conv = await UnitConversionService.convert(r.productId, companyId, scaledQty, recipeUnit);
                const totalCost = Math.round(unitCost * conv.baseQuantity * 100) / 100;
                return {
                    productId: r.productId,
                    productName: r.product.name,
                    unit: r.product.unit,
                    baseQuantity: Number(r.quantity),
                    scaledQuantity: Math.round(scaledQty * 1000) / 1000,
                    unitCost,
                    totalCost
                };
            } catch (error) {
                throw new Error(`No se pudo convertir la unidad "${recipeUnit}" de "${r.product.name}": ${(error as Error).message}`);
            }
        }));

        const totalCost = scaledIngredients.reduce((sum, i) => sum + i.totalCost, 0);

        return {
            menuItem: recipe.menuItem.name,
            basePortions,
            targetPortions,
            scaleFactor,
            ingredients: scaledIngredients,
            totalCost: Math.round(totalCost * 100) / 100,
            costPerPortion: Math.round((totalCost / targetPortions) * 100) / 100
        };
    }

    /**
     * Calculate yield/portion info for a recipe
     */
    static async calculateYield(menuItemId: number, companyId: number, settings: {
        totalWeight?: number;  // Total output weight
        portionSize?: number;  // Weight per portion
        wastePercentage?: number; // Expected waste %
    }) {
        const menuItem = await prisma.menuItem.findFirst({
            where: { id: menuItemId, companyId },
            select: { id: true }
        });
        if (!menuItem) {
            throw new Error('Menu item no encontrado');
        }

        const explicitTotalWeight = settings.totalWeight == null ? null : Number(settings.totalWeight);
        const explicitPortionSize = settings.portionSize == null ? null : Number(settings.portionSize);
        const wastePercentage = settings.wastePercentage == null ? 0 : Number(settings.wastePercentage);
        if (explicitTotalWeight !== null && (!Number.isFinite(explicitTotalWeight) || explicitTotalWeight <= 0)) {
            throw new Error('El peso total de salida debe ser un número finito mayor a 0.');
        }
        if (explicitPortionSize !== null && (!Number.isFinite(explicitPortionSize) || explicitPortionSize <= 0)) {
            throw new Error('El tamaño de porción debe ser un número finito mayor a 0.');
        }
        if (!Number.isFinite(wastePercentage) || wastePercentage < 0 || wastePercentage > 100) {
            throw new Error('El porcentaje de merma debe estar entre 0 y 100.');
        }

        const recipes = await prisma.recipe.findMany({
            where: { menuItemId },
            include: {
                product: { select: { name: true, unit: true, cost: true, currentAverageCost: true } },
                unitOfMeasure: { select: { abbreviation: true } }
            }
        });

        if (recipes.length === 0) {
            throw new Error('El plato no tiene ingredientes para calcular rendimiento.');
        }

        // Normalize every line to the company's canonical measurement reference
        // (g/ml/unidad, etc.). Raw recipe quantities cannot be added: 1 kg + 500 g
        // is 1500 g, while mass + volume/count is not a meaningful total at all.
        const normalizedIngredients = await Promise.all(recipes.map(async (r) => {
            const recipeUnit = r.unit || r.unitOfMeasure?.abbreviation || r.product.unit;
            try {
                const [conv, unitCost] = await Promise.all([
                    UnitConversionService.convert(r.productId, companyId, Number(r.quantity), recipeUnit),
                    ProductionRecipeService.resolveProductUnitCost(r.productId, companyId)
                ]);
                const baseUnit = await prisma.unitOfMeasure.findFirst({
                    where: { companyId, active: true, abbreviation: conv.baseUnit },
                    select: { abbreviation: true, measurementType: true, systemFactor: true }
                });
                const systemFactor = Number(baseUnit?.systemFactor);
                if (!baseUnit || !Number.isFinite(systemFactor) || systemFactor <= 0) {
                    throw new Error(`la unidad base "${conv.baseUnit}" no tiene referencia de medición válida`);
                }
                return {
                    measurementType: baseUnit.measurementType,
                    canonicalQuantity: conv.baseQuantity * systemFactor,
                    ingredientCost: unitCost * conv.baseQuantity
                };
            } catch (error) {
                throw new Error(`No se pudo calcular "${r.product.name}" (${recipeUnit}): ${(error as Error).message}`);
            }
        }));

        const measurementTypes = [...new Set(normalizedIngredients.map((ingredient) => ingredient.measurementType))];
        if (measurementTypes.length !== 1) {
            throw new Error(
                `No se pueden sumar ingredientes de mediciones heterogéneas (${measurementTypes.join(', ')}). ` +
                'Defina el rendimiento en una receta de producción con una unidad de salida explícita.'
            );
        }
        const canonicalUnit = await prisma.unitOfMeasure.findFirst({
            where: {
                companyId,
                active: true,
                measurementType: measurementTypes[0],
                systemFactor: 1
            },
            select: { abbreviation: true }
        });
        if (!canonicalUnit) {
            throw new Error(`No existe una unidad de referencia para la medición ${measurementTypes[0]}.`);
        }
        const totalInput = normalizedIngredients.reduce((sum, ingredient) => sum + ingredient.canonicalQuantity, 0);

        // Apply waste percentage
        const wasteMultiplier = 1 - (wastePercentage / 100);
        const usableOutput = explicitTotalWeight !== null
            ? explicitTotalWeight
            : totalInput * wasteMultiplier;

        // Calculate portions
        const portionsFromYield = explicitPortionSize !== null
            ? Math.floor(usableOutput / explicitPortionSize)
            : 1;
        const safePortions = Math.max(1, portionsFromYield);

        const totalIngredientCost = normalizedIngredients.reduce((sum, ingredient) => sum + ingredient.ingredientCost, 0);

        return {
            input: {
                totalWeight: totalInput,
                unit: canonicalUnit.abbreviation,
                ingredients: recipes.length
            },
            output: {
                totalWeight: usableOutput,
                unit: canonicalUnit.abbreviation,
                wastePercentage,
                portionSize: explicitPortionSize ?? usableOutput,
                numberOfPortions: portionsFromYield
            },
            costs: {
                totalIngredientCost: Math.round(totalIngredientCost * 100) / 100,
                costPerPortion: Math.round((totalIngredientCost / safePortions) * 100) / 100,
                yieldPercentage: totalInput > 0 ? Math.round((usableOutput / totalInput) * 100) : 0
            }
        };
    }

    /**
     * Create a sub-recipe (composite recipe)
     */
    static async createSubRecipe(companyId: number, data: {
        name: string;
        categoryId: number;
        baseYield: number;
        unit: string;
        ingredients: { productId: number; quantity: number }[];
    }) {
        if (!Number.isFinite(data.baseYield) || !(data.baseYield > 0)) {
            throw new Error('El rendimiento base de la sub-receta debe ser mayor a 0.');
        }
        if (!data.ingredients?.length) {
            throw new Error('La sub-receta debe tener al menos un ingrediente.');
        }

        // Not exposed by HTTP routes today; keep fail-closed so a future wire-up
        // cannot silently publish a zero-cost composite ingredient.
        return prisma.$transaction(async (tx) => {
            let totalCost = 0;
            for (const ing of data.ingredients) {
                const quantity = Number(ing.quantity);
                if (!Number.isFinite(quantity) || !(quantity > 0)) {
                    throw new Error('Cada ingrediente de la sub-receta debe tener cantidad mayor a 0.');
                }
                const ingredient = await tx.product.findFirst({
                    where: { id: ing.productId, companyId, active: true },
                    select: { id: true, name: true, cost: true, currentAverageCost: true, unit: true }
                });
                if (!ingredient) {
                    throw new Error(`Ingrediente no encontrado o inactivo: ${ing.productId}`);
                }
                const unitCost = effectiveUnitCost(ingredient.currentAverageCost, ingredient.cost);
                if (!(unitCost > 0)) {
                    throw new Error(
                        `El ingrediente "${ingredient.name}" no tiene costo unitario positivo; no se puede crear la sub-receta.`
                    );
                }
                const conv = await UnitConversionService.convert(
                    ingredient.id,
                    companyId,
                    quantity,
                    ingredient.unit,
                    tx
                );
                totalCost += unitCost * conv.baseQuantity;
            }

            const costPerUnit = totalCost / data.baseYield;
            const product = await tx.product.create({
                data: {
                    companyId,
                    name: `[Sub-Receta] ${data.name}`,
                    unit: data.unit,
                    type: 'INGREDIENT',
                    categoryId: data.categoryId,
                    minStock: 0,
                    cost: costPerUnit,
                    currentAverageCost: costPerUnit
                }
            });

            return {
                id: product.id,
                name: data.name,
                unit: data.unit,
                baseYield: data.baseYield,
                costPerUnit: Math.round(costPerUnit * 100) / 100,
                ingredients: data.ingredients
            };
        });
    }

    /**
     * Get portion suggestions based on common serving sizes
     */
    static getPortionSuggestions(category: string) {
        type PortionSuggestion =
            | { name: string; weight: number; unit: string }
            | { name: string; volume: number; unit: string };
        const suggestions: Record<string, PortionSuggestion[]> = {
            'Entradas': [
                { name: 'Individual', weight: 150, unit: 'g' },
                { name: 'Para compartir', weight: 300, unit: 'g' }
            ],
            'Platos Fuertes': [
                { name: 'Regular', weight: 300, unit: 'g' },
                { name: 'Grande', weight: 450, unit: 'g' }
            ],
            'Postres': [
                { name: 'Individual', weight: 120, unit: 'g' },
                { name: 'Para compartir', weight: 250, unit: 'g' }
            ],
            'Bebidas': [
                { name: 'Pequeño', volume: 250, unit: 'ml' },
                { name: 'Mediano', volume: 350, unit: 'ml' },
                { name: 'Grande', volume: 500, unit: 'ml' }
            ]
        };

        return suggestions[category] || [
            { name: 'Estándar', weight: 200, unit: 'g' }
        ];
    }
}
