import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';

export class ReportProductionService {
    /**
     * Recipe Cost Analysis: breaks down the cost of each menu item by its recipe components.
     */
    static async getRecipeCostAnalysis(companyId: number, filters?: { categoryId?: number; branchId?: number }) {
        const where: Record<string, unknown> = { companyId, active: true };
        if (filters?.categoryId) where.categoryId = filters.categoryId;

        const menuItems = await prisma.menuItem.findMany({
            where,
            include: {
                category: { select: { id: true, name: true } },
                recipes: {
                    include: {
                        product: {
                            select: { id: true, name: true, unit: true, currentAverageCost: true, cost: true }
                        }
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        const items = await Promise.all(menuItems.map(async (mi) => {
            const ingredients = await Promise.all(mi.recipes.map(async (r) => {
                const unitCost = Number(r.product.currentAverageCost || r.product.cost || 0);
                const recipeUnit = r.unit || r.product.unit;
                const qty = Number(r.quantity);
                let baseQty = qty;

                try {
                    const conv = await UnitConversionService.convert(
                        r.product.id,
                        companyId,
                        qty,
                        recipeUnit
                    );
                    baseQty = conv.baseQuantity;
                } catch {
                    // Fallback to legacy quantity when conversion is not configured
                }

                return {
                    productId: r.product.id,
                    productName: r.product.name,
                    unit: recipeUnit,
                    quantity: qty,
                    baseQuantity: baseQty,
                    unitCost,
                    lineCost: baseQty * unitCost,
                };
            }));

            const totalCost = ingredients.reduce((sum, i) => sum + i.lineCost, 0);
            const price = Number(mi.price);
            const margin = price - totalCost;
            const marginPct = price > 0 ? (margin / price) * 100 : 0;
            const foodCostPct = price > 0 ? (totalCost / price) * 100 : 0;

            return {
                menuItemId: mi.id,
                menuItemName: mi.name,
                category: mi.category?.name || 'Sin categoría',
                price,
                totalCost: Math.round(totalCost * 100) / 100,
                margin: Math.round(margin * 100) / 100,
                marginPct: Math.round(marginPct * 10) / 10,
                foodCostPct: Math.round(foodCostPct * 10) / 10,
                ingredientCount: ingredients.length,
                ingredients,
            };
        }));

        const withRecipes = items.filter(i => i.ingredientCount > 0);
        const avgFoodCost = withRecipes.length > 0
            ? withRecipes.reduce((sum, i) => sum + i.foodCostPct, 0) / withRecipes.length
            : 0;

        return {
            items,
            summary: {
                totalMenuItems: items.length,
                withRecipes: withRecipes.length,
                withoutRecipes: items.length - withRecipes.length,
                avgFoodCostPct: Math.round(avgFoodCost * 10) / 10,
                highCostItems: withRecipes.filter(i => i.foodCostPct > 35).length,
            }
        };
    }

    /**
     * Production Yield Report: estimates how many portions can be produced from current stock.
     */
    static async getProductionYield(companyId: number, filters?: { warehouseId?: number; branchId?: number }) {
        const stockWhere: Record<string, unknown> = { companyId };
        if (filters?.warehouseId) stockWhere.warehouseId = filters.warehouseId;
        if (filters?.branchId) stockWhere.warehouse = { branchId: filters.branchId };

        const menuItems = await prisma.menuItem.findMany({
            where: { companyId, active: true },
            include: {
                category: { select: { name: true } },
                recipes: {
                    include: {
                        product: {
                            select: {
                                id: true, name: true, unit: true,
                                stocks: { where: stockWhere, select: { quantity: true } }
                            }
                        }
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        const items: Array<{
            menuItemName: string;
            category: string;
            maxPortions: number;
            limitingIngredient: string;
            ingredientCount: number;
        }> = [];

        for (const mi of menuItems) {
            if (mi.recipes.length === 0) continue;

            let maxPortions = Infinity;
            let limitingIngredient = '';

            for (const recipe of mi.recipes) {
                const totalStock = recipe.product.stocks.reduce((s, st) => s + Number(st.quantity), 0);
                const recipeUnit = recipe.unit || recipe.product.unit;
                let needed = Number(recipe.quantity);

                try {
                    const conv = await UnitConversionService.convert(
                        recipe.product.id,
                        companyId,
                        Number(recipe.quantity),
                        recipeUnit
                    );
                    needed = conv.baseQuantity;
                } catch {
                    // Fallback to legacy quantity when conversion is not configured
                }

                const portions = needed > 0 ? Math.floor(totalStock / needed) : 0;

                if (portions < maxPortions) {
                    maxPortions = portions;
                    limitingIngredient = recipe.product.name;
                }
            }

            if (maxPortions === Infinity) maxPortions = 0;

            items.push({
                menuItemName: mi.name,
                category: mi.category?.name || 'Sin categoría',
                maxPortions,
                limitingIngredient,
                ingredientCount: mi.recipes.length,
            });
        }

        const totalPortions = items.reduce((s, i) => s + i.maxPortions, 0);
        const zeroStock = items.filter(i => i.maxPortions === 0).length;

        return {
            items,
            summary: {
                totalItems: items.length,
                totalPossiblePortions: totalPortions,
                itemsWithZeroStock: zeroStock,
                avgPortionsPerItem: items.length > 0 ? Math.round(totalPortions / items.length) : 0,
            }
        };
    }

    /**
     * Menu Engineering (Star Products): classifies items into Stars, Puzzles, Plowhorses, Dogs
     * based on popularity (quantity sold) and profitability (margin).
     */
    static async getMenuEngineering(companyId: number, filters?: { dateFrom?: Date; dateTo?: Date; branchId?: number }) {
        const orderWhere: Record<string, unknown> = { companyId, status: 'PAID' };
        if (filters?.branchId) orderWhere.branchId = filters.branchId;
        if (filters?.dateFrom || filters?.dateTo) {
            orderWhere.createdAt = {};
            if (filters?.dateFrom) (orderWhere.createdAt as Record<string, unknown>).gte = filters.dateFrom;
            if (filters?.dateTo) (orderWhere.createdAt as Record<string, unknown>).lte = filters.dateTo;
        }

        const orderItems = await prisma.orderItem.findMany({
            where: { order: orderWhere },
            select: {
                menuItemId: true,
                quantity: true,
                price: true,
                subtotal: true,
            }
        });

        const menuItems = await prisma.menuItem.findMany({
            where: { companyId, active: true },
            include: {
                category: { select: { name: true } },
                recipes: {
                    include: {
                        product: { select: { id: true, unit: true, currentAverageCost: true, cost: true } }
                    }
                }
            }
        });

        const salesMap = new Map<number, { qty: number; revenue: number }>();
        for (const oi of orderItems) {
            const current = salesMap.get(oi.menuItemId) || { qty: 0, revenue: 0 };
            current.qty += oi.quantity;
            current.revenue += Number(oi.subtotal);
            salesMap.set(oi.menuItemId, current);
        }

        const analysis = await Promise.all(menuItems.map(async (mi) => {
            const sales = salesMap.get(mi.id) || { qty: 0, revenue: 0 };
            let recipeCost = 0;
            for (const r of mi.recipes) {
                const recipeUnit = r.unit || r.product.unit;
                let qtyInBase = Number(r.quantity);
                try {
                    const conv = await UnitConversionService.convert(
                        r.product.id,
                        companyId,
                        Number(r.quantity),
                        recipeUnit
                    );
                    qtyInBase = conv.baseQuantity;
                } catch {
                    // Fallback to legacy quantity when conversion is not configured
                }
                recipeCost += qtyInBase * Number(r.product.currentAverageCost || r.product.cost || 0);
            }
            const margin = Number(mi.price) - recipeCost;

            return {
                menuItemId: mi.id,
                menuItemName: mi.name,
                category: mi.category?.name || 'Sin categoría',
                price: Number(mi.price),
                cost: Math.round(recipeCost * 100) / 100,
                margin: Math.round(margin * 100) / 100,
                qtySold: sales.qty,
                revenue: Math.round(sales.revenue * 100) / 100,
                totalProfit: Math.round(margin * sales.qty * 100) / 100,
            };
        }));
        const filteredAnalysis = analysis.filter(i => i.qtySold > 0);

        const avgQty = filteredAnalysis.length > 0 ? filteredAnalysis.reduce((s, i) => s + i.qtySold, 0) / filteredAnalysis.length : 0;
        const avgMargin = filteredAnalysis.length > 0 ? filteredAnalysis.reduce((s, i) => s + i.margin, 0) / filteredAnalysis.length : 0;

        const classified = filteredAnalysis.map(item => {
            const highPop = item.qtySold >= avgQty;
            const highProfit = item.margin >= avgMargin;

            let classification: string;
            if (highPop && highProfit) classification = 'ESTRELLA';
            else if (!highPop && highProfit) classification = 'PUZZLE';
            else if (highPop && !highProfit) classification = 'CABALLO';
            else classification = 'PERRO';

            return { ...item, classification };
        });

        classified.sort((a, b) => b.totalProfit - a.totalProfit);

        const stars = classified.filter(i => i.classification === 'ESTRELLA').length;
        const puzzles = classified.filter(i => i.classification === 'PUZZLE').length;
        const horses = classified.filter(i => i.classification === 'CABALLO').length;
        const dogs = classified.filter(i => i.classification === 'PERRO').length;

        return {
            items: classified,
            summary: {
                totalAnalyzed: classified.length,
                stars, puzzles, horses, dogs,
                avgQtySold: Math.round(avgQty),
                avgMargin: Math.round(avgMargin * 100) / 100,
                totalRevenue: Math.round(classified.reduce((s, i) => s + i.revenue, 0) * 100) / 100,
            }
        };
    }

    /**
     * Purchase Projection: estimates required purchases based on recent sales velocity and current stock.
     */
    static async getPurchaseProjection(companyId: number, filters?: { days?: number; warehouseId?: number; branchId?: number }) {
        const projectionDays = filters?.days || 7;
        const lookbackDays = 30;
        const since = new Date();
        since.setDate(since.getDate() - lookbackDays);

        const orderWhere: Record<string, unknown> = { companyId, status: 'PAID', createdAt: { gte: since } };
        if (filters?.branchId) orderWhere.branchId = filters.branchId;

        const orderItems = await prisma.orderItem.findMany({
            where: { order: orderWhere },
            select: { menuItemId: true, quantity: true }
        });

        const menuItemSales = new Map<number, number>();
        for (const oi of orderItems) {
            menuItemSales.set(oi.menuItemId, (menuItemSales.get(oi.menuItemId) || 0) + oi.quantity);
        }

        const recipes = await prisma.recipe.findMany({
            where: { menuItem: { companyId } },
            select: {
                menuItemId: true,
                productId: true,
                quantity: true,
                unit: true,
                product: { select: { unit: true } }
            }
        });

        const productDemand = new Map<number, number>();
        for (const recipe of recipes) {
            const miSales = menuItemSales.get(recipe.menuItemId) || 0;
            const recipeUnit = recipe.unit || recipe.product.unit;
            let qtyInBase = Number(recipe.quantity);
            try {
                const conv = await UnitConversionService.convert(
                    recipe.productId,
                    companyId,
                    Number(recipe.quantity),
                    recipeUnit
                );
                qtyInBase = conv.baseQuantity;
            } catch {
                // Fallback to legacy quantity when conversion is not configured
            }
            const dailyUsage = (miSales * qtyInBase) / lookbackDays;
            productDemand.set(recipe.productId, (productDemand.get(recipe.productId) || 0) + dailyUsage);
        }

        const stockWhere: Record<string, unknown> = { companyId };
        if (filters?.warehouseId) stockWhere.warehouseId = filters.warehouseId;
        if (filters?.branchId) stockWhere.warehouse = { branchId: filters.branchId };

        const products = await prisma.product.findMany({
            where: { companyId, active: true, id: { in: Array.from(productDemand.keys()) } },
            include: {
                stocks: { where: stockWhere, select: { quantity: true } },
                category: { select: { name: true } }
            }
        });

        const items = products.map(p => {
            const dailyUsage = productDemand.get(p.id) || 0;
            const currentStock = p.stocks.reduce((s, st) => s + Number(st.quantity), 0);
            const projectedNeed = dailyUsage * projectionDays;
            const deficit = projectedNeed - currentStock;
            const daysUntilStockout = dailyUsage > 0 ? Math.floor(currentStock / dailyUsage) : 999;
            const cost = Number(p.currentAverageCost || p.cost || 0);

            return {
                productId: p.id,
                productName: p.name,
                category: p.category?.name || 'Sin categoría',
                unit: p.unit,
                currentStock: Math.round(currentStock * 100) / 100,
                dailyUsage: Math.round(dailyUsage * 100) / 100,
                projectedNeed: Math.round(projectedNeed * 100) / 100,
                suggestedPurchase: Math.max(0, Math.ceil(deficit)),
                daysUntilStockout,
                estimatedCost: Math.round(Math.max(0, deficit) * cost * 100) / 100,
            };
        });

        items.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);

        const urgent = items.filter(i => i.daysUntilStockout <= 3).length;
        const totalCost = items.reduce((s, i) => s + i.estimatedCost, 0);

        return {
            items,
            summary: {
                projectionDays,
                totalProducts: items.length,
                urgentItems: urgent,
                estimatedTotalCost: Math.round(totalCost * 100) / 100,
                avgDaysUntilStockout: items.length > 0
                    ? Math.round(items.reduce((s, i) => s + Math.min(i.daysUntilStockout, 999), 0) / items.length)
                    : 0,
            }
        };
    }
}
