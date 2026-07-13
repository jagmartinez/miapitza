import prisma from '../utils/prisma';
import { effectiveUnitCost } from '../utils/product-cost';
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
            const unitCost = effectiveUnitCost(r.product.currentAverageCost, r.product.cost);

            try {
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

        const recipes = await prisma.recipe.findMany({
            where: { menuItemId },
            include: {
                product: { select: { name: true, unit: true, cost: true, currentAverageCost: true } },
                unitOfMeasure: { select: { abbreviation: true } }
            }
        });

        // Calculate total input weight (assuming quantities in same unit)
        const totalInput = recipes.reduce((sum, r) => sum + Number(r.quantity), 0);

        // Apply waste percentage
        const wasteMultiplier = 1 - ((settings.wastePercentage || 0) / 100);
        const usableOutput = settings.totalWeight
            ? settings.totalWeight
            : totalInput * wasteMultiplier;

        // Calculate portions
        const portionsFromYield = settings.portionSize
            ? Math.floor(usableOutput / settings.portionSize)
            : 1;
        const safePortions = Math.max(1, portionsFromYield);

        // Calculate costs in base units (convert with the recipe's unit and value
        // with weighted-average/reference fallback) so the cost is coherent with kg/g usage.
        const ingredientCosts = await Promise.all(recipes.map(async (r) => {
            const recipeUnit = r.unit || r.unitOfMeasure?.abbreviation || r.product.unit;
            const unitCost = effectiveUnitCost(r.product.currentAverageCost, r.product.cost);
            try {
                const conv = await UnitConversionService.convert(r.productId, companyId, Number(r.quantity), recipeUnit);
                return unitCost * conv.baseQuantity;
            } catch (error) {
                throw new Error(`No se pudo convertir la unidad "${recipeUnit}" de "${r.product.name}": ${(error as Error).message}`);
            }
        }));
        const totalIngredientCost = ingredientCosts.reduce((sum, v) => sum + v, 0);

        return {
            input: {
                totalWeight: totalInput,
                ingredients: recipes.length
            },
            output: {
                totalWeight: usableOutput,
                wastePercentage: settings.wastePercentage || 0,
                portionSize: settings.portionSize || usableOutput,
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
        // Create as a product that can be used in other recipes
        const product = await prisma.product.create({
            data: {
                companyId,
                name: `[Sub-Receta] ${data.name}`,
                unit: data.unit,
                type: 'INGREDIENT', // Can be used as ingredient
                categoryId: data.categoryId,
                minStock: 0,
                cost: 0 // Will be calculated
            }
        });

        // Calculate cost from ingredients
        let totalCost = 0;
        for (const ing of data.ingredients) {
            const ingredient = await prisma.product.findFirst({
                where: { id: ing.productId, companyId },
                select: { cost: true }
            });
            if (!ingredient) {
                throw new Error(`Ingrediente no encontrado: ${ing.productId}`);
            }
            totalCost += Number(ingredient?.cost || 0) * ing.quantity;
        }

        // Update product cost
        await prisma.product.update({
            where: { id: product.id },
            data: { cost: totalCost / data.baseYield }
        });

        return {
            id: product.id,
            name: data.name,
            unit: data.unit,
            baseYield: data.baseYield,
            costPerUnit: Math.round((totalCost / data.baseYield) * 100) / 100,
            ingredients: data.ingredients
        };
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
