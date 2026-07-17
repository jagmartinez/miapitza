import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ReportProductionService } from '../../services/report-production.service';
import { UnitConversionService } from '../../services/unit-conversion.service';
import { ProductionRecipeService } from '../../services/production-recipe.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('Production report physical scope', () => {
    it('includes shared CENTRAL inventory when calculating branch production yield', async () => {
        const findMany = jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([] as never);

        await ReportProductionService.getProductionYield(1, { branchId: 4 });

        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            include: expect.objectContaining({
                recipes: expect.objectContaining({
                    include: expect.objectContaining({
                        product: expect.objectContaining({
                            select: expect.objectContaining({
                                stocks: {
                                    where: {
                                        companyId: 1,
                                        warehouse: { OR: [{ branchId: 4 }, { branchId: null }] }
                                    },
                                    select: { quantity: true }
                                }
                            })
                        })
                    })
                })
            })
        }));
    });

    it('rejects invalid horizons before publishing a purchase projection', async () => {
        const findMany = jest.spyOn(prisma.orderItem, 'findMany');

        await expect(ReportProductionService.getPurchaseProjection(1, { days: -2 }))
            .rejects.toThrow(/entero entre 1 y 365/i);

        expect(findMany).not.toHaveBeenCalled();
    });

    it('reports branch plus CENTRAL stock in the configured base unit', async () => {
        jest.spyOn(prisma.orderItem, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.recipe, 'findMany').mockResolvedValue([] as never);
        const products = jest.spyOn(prisma.product, 'findMany').mockResolvedValue([] as never);

        await ReportProductionService.getPurchaseProjection(1, { branchId: 4, days: 14 });

        expect(products).toHaveBeenCalledWith(expect.objectContaining({
            include: expect.objectContaining({
                stocks: {
                    where: {
                        companyId: 1,
                        warehouse: { OR: [{ branchId: 4 }, { branchId: null }] }
                    },
                    select: { quantity: true }
                },
                baseUnit: { select: { abbreviation: true } }
            })
        }));
    });

    it('subtracts credited quantities and gross sales from menu engineering', async () => {
        jest.spyOn(prisma.orderItem, 'findMany').mockResolvedValue([{
            id: 1,
            menuItemId: 10,
            quantity: 2,
            price: 100,
            subtotal: 200,
            fiscalCreditNoteLines: [{ quantity: 1, grossSubtotal: 100 }]
        }] as never);
        jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([{
            id: 10, name: 'Pizza', price: 100, category: { name: 'Menú' }, recipes: []
        }] as never);

        const result = await ReportProductionService.getMenuEngineering(1);

        expect(result.items).toEqual([expect.objectContaining({ qtySold: 1, revenue: 100 })]);
        expect(result.summary.totalRevenue).toBe(100);
    });

    it('subtracts credited quantities from purchase demand projection', async () => {
        jest.spyOn(prisma.orderItem, 'findMany').mockResolvedValue([{
            menuItemId: 10,
            quantity: 4,
            fiscalCreditNoteLines: [{ quantity: 1 }]
        }] as never);
        jest.spyOn(prisma.recipe, 'findMany').mockResolvedValue([{
            menuItemId: 10, productId: 20, quantity: 2, unit: 'unit', product: { unit: 'unit' }
        }] as never);
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            originalQuantity: 2, originalUnit: 'unit', baseQuantity: 2, baseUnit: 'unit', conversionFactor: 1
        });
        jest.spyOn(prisma.product, 'findMany').mockResolvedValue([{
            id: 20, name: 'Ingrediente', unit: 'unit', stocks: [], category: { name: 'Insumos' }, baseUnit: null
        }] as never);
        jest.spyOn(ProductionRecipeService, 'resolveProductUnitCost').mockResolvedValue(10);

        const result = await ReportProductionService.getPurchaseProjection(1, { days: 7 });

        expect(result.items).toEqual([expect.objectContaining({
            productId: 20,
            dailyUsage: 0.2,
            projectedNeed: 1.4,
            suggestedPurchase: 2
        })]);
    });

    it('publishes no depletion estimate instead of a fabricated 999-day horizon', async () => {
        jest.spyOn(prisma.orderItem, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.recipe, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.product, 'findMany').mockResolvedValue([{
            id: 20, name: 'Ingrediente', unit: 'unit', stocks: [{ quantity: 5 }],
            category: { name: 'Insumos' }, baseUnit: null
        }] as never);
        jest.spyOn(ProductionRecipeService, 'resolveProductUnitCost').mockResolvedValue(10);

        const result = await ReportProductionService.getPurchaseProjection(1, { days: 7 });

        expect(result.items[0].daysUntilStockout).toBeNull();
        expect(result.summary.avgDaysUntilStockout).toBe('N/D');
        expect(result.summary.urgentItems).toBe(0);
    });
});
