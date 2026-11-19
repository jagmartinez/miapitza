import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { AutoPurchaseOrderService } from '../../services/auto-purchase-order.service';
import { StockAlertService } from '../../services/stock-alert.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('AutoPurchaseOrderService suggestions', () => {
    it('expresses the suggestion in the default purchase unit with an unrounded unit cost', async () => {
        jest.spyOn(StockAlertService, 'getLowStockProducts').mockResolvedValue([{
            productId: 7, productName: 'Harina', unit: 'g', currentStock: 1000, minStock: 30000,
            warehouseId: 1, warehouseName: 'Central'
        }] as never);
        jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({
            id: 7, name: 'Harina', unit: 'g', cost: 0.004, currentAverageCost: 0.004, minStock: 30000,
            averageCostKnown: true, referenceCostKnown: true, baseUnitId: 1,
            baseUnit: { abbreviation: 'g', measurementType: 'MASS' },
            allowedUnits: [{ unitId: 9, conversionFactor: 25000, unit: { abbreviation: 'saco', measurementType: 'PACKAGE' } }]
        } as never);
        jest.spyOn(prisma.productionRecipe, 'findMany').mockResolvedValue([] as never);

        const result = await AutoPurchaseOrderService.generateSuggestions(1);
        const [suggestion] = result.suggestions;

        // deficit = 60000 - 1000 = 59000 g -> 2.36 sacos -> 3 sacos (discrete)
        expect(suggestion.suggestedQuantity).toBe(59000);
        expect(suggestion.purchaseUnit).toBe('saco');
        expect(suggestion.purchaseQuantity).toBe(3);
        expect(suggestion.purchaseUnitCost).toBeCloseTo(100, 9);
        expect(suggestion.baseUnitCost).toBe(0.004);
        expect(suggestion.estimatedCost).toBe(300);
    });

    it('excludes products with an active production recipe and lists them under toProduce (D11)', async () => {
        jest.spyOn(StockAlertService, 'getLowStockProducts').mockResolvedValue([
            { productId: 7, productName: 'Harina', unit: 'g', currentStock: 0, minStock: 10, warehouseId: 1, warehouseName: 'Central' },
            { productId: 8, productName: 'Salsa base', unit: 'ml', currentStock: 100, minStock: 500, warehouseId: 1, warehouseName: 'Central' }
        ] as never);
        const recipes = jest.spyOn(prisma.productionRecipe, 'findMany').mockResolvedValue([{ productId: 8 }] as never);
        const details = jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({
            id: 7, name: 'Harina', unit: 'g', cost: 1, currentAverageCost: 1, minStock: 10,
            averageCostKnown: true, referenceCostKnown: true, baseUnitId: 1,
            baseUnit: { abbreviation: 'g', measurementType: 'MASS' }, allowedUnits: []
        } as never);

        const result = await AutoPurchaseOrderService.generateSuggestions(1);

        expect(recipes).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ companyId: 1, status: 'ACTIVE', productId: { in: [7, 8] } })
        }));
        expect(result.suggestions.map((s) => s.productId)).toEqual([7]);
        expect(details).toHaveBeenCalledTimes(1);
        expect(result.toProduce).toEqual([expect.objectContaining({ productId: 8, suggestedQuantity: 900 })]);
        expect(result.summary.toProduceProducts).toBe(1);
    });
});

describe('AutoPurchaseOrderService.createFromSuggestions', () => {
    function setup() {
        let orderData: Record<string, unknown> = {};
        const tx = {
            branch: { findFirst: jest.fn(async () => ({ id: 2 })) },
            supplier: { findFirst: jest.fn(async () => ({ id: 3 })) },
            product: {
                findMany: jest.fn(async () => [{
                    id: 7, unit: 'g', cost: 0.004, currentAverageCost: 0.004,
                    averageCostKnown: true, referenceCostKnown: true, baseUnit: { abbreviation: 'g' }
                }])
            },
            purchaseOrder: {
                create: jest.fn(async (args: { data: Record<string, unknown> }) => {
                    orderData = args.data;
                    return { id: 10 };
                })
            }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );
        return { tx, getOrder: () => orderData };
    }

    it('creates a DRAFT with pending payment instead of an automatically paid order', async () => {
        const { getOrder } = setup();
        jest.spyOn(UnitConversionService, 'convertWithCost').mockResolvedValue({
            baseQuantity: 50000, conversionFactor: 25000, originalQuantity: 2,
            originalUnit: 'saco', baseUnit: 'g', baseCost: 0, originalCost: 0
        });

        await AutoPurchaseOrderService.createFromSuggestions(1, 2, 3, [
            { productId: 7, quantity: 2, unit: 'saco', cost: 100 }
        ]);

        const order = getOrder();
        expect(order.status).toBe('DRAFT');
        expect(order.paymentStatus).toBe('PENDING');
        expect(order.paidAmount).toBe(0);
        expect(order.total).toBe(200);
        const line = (order.items as { create: Array<Record<string, unknown>> }).create[0];
        expect(line).toEqual(expect.objectContaining({
            quantity: 2, cost: 100, purchaseUnit: 'saco', conversionFactor: 25000, baseQuantity: 50000
        }));
        expect(line.baseCost).toBeCloseTo(0.004, 12);
    });

    it('derives the unit cost on the server when the client omits it (no cent rounding)', async () => {
        const { getOrder } = setup();
        jest.spyOn(UnitConversionService, 'convertWithCost').mockResolvedValue({
            baseQuantity: 750, conversionFactor: 1, originalQuantity: 750,
            originalUnit: 'g', baseUnit: 'g', baseCost: 0, originalCost: 0
        });

        await AutoPurchaseOrderService.createFromSuggestions(1, 2, 3, [{ productId: 7, quantity: 750 }]);

        const line = (getOrder().items as { create: Array<Record<string, unknown>> }).create[0];
        expect(line.cost).toBeCloseTo(0.004, 12);
        expect(getOrder().total).toBe(3);
    });
});
