import prisma from '../utils/prisma';

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
                    select: { name: true, unit: true, cost: true }
                }
            }
        });

        // Assume base recipe is for 1 portion
        const basePortions = 1;
        const scaleFactor = targetPortions / basePortions;

        const scaledIngredients = recipes.map((r) => ({
            productId: r.productId,
            productName: r.product.name,
            unit: r.product.unit,
            baseQuantity: Number(r.quantity),
            scaledQuantity: Math.round(Number(r.quantity) * scaleFactor * 1000) / 1000,
            unitCost: Number(r.product.cost),
            totalCost: Math.round(Number(r.quantity) * scaleFactor * Number(r.product.cost) * 100) / 100
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
                product: { select: { name: true, unit: true, cost: true } }
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

        // Calculate costs
        const totalIngredientCost = recipes.reduce((sum, r) =>
            sum + (Number(r.quantity) * Number(r.product.cost)), 0);

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
