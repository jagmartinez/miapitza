import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { ReportExtendedService } from '../../services/report-extended.service';
import { UnitConversionService } from '../../services/unit-conversion.service';

describe('ReportExtendedService ledger-first COGS', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            baseQuantity: 1,
            baseUnit: 'kg'
        } as never);
        jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
    });

    it('getSalesByChannel prefers net ORD-* cost and falls back to recipe×WAC', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            {
                id: 1,
                total: 100,
                salesChannel: 'RESTAURANT',
                channelCommission: 0,
                channelMarkup: 0,
                items: [{
                    quantity: 1,
                    subtotal: 100,
                    menuItem: {
                        recipes: [{
                            quantity: 1,
                            unit: 'kg',
                            product: { id: 1, name: 'Harina', unit: 'kg', currentAverageCost: 40, cost: 40 }
                        }]
                    }
                }]
            },
            {
                id: 2,
                total: 50,
                salesChannel: 'DELIVERY',
                channelCommission: 5,
                channelMarkup: 0,
                items: [{
                    quantity: 1,
                    subtotal: 50,
                    menuItem: {
                        recipes: [{
                            quantity: 1,
                            unit: 'kg',
                            product: { id: 1, name: 'Harina', unit: 'kg', currentAverageCost: 40, cost: 40 }
                        }]
                    }
                }]
            }
        ] as never);

        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([
            { id: 1, reference: 'ORD-1', type: 'OUT', totalCost: 18, createdAt: new Date() },
            { id: 2, reference: 'ORD-1', type: 'IN', totalCost: 3, createdAt: new Date() },
            // Order 2 has no movements → recipe fallback 40
        ] as never);

        const result = await ReportExtendedService.getSalesByChannel(9);

        expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                companyId: 9,
                reference: { startsWith: 'ORD-' },
                type: { in: ['OUT', 'IN'] }
            })
        }));

        const restaurant = result.items.find((row) => row.channel === 'RESTAURANT');
        const delivery = result.items.find((row) => row.channel === 'DELIVERY');
        // ORD-1: 18 - 3 = 15 (not recipe 40)
        expect(restaurant?.estimatedCOGS).toBe(15);
        expect(delivery?.estimatedCOGS).toBe(40);
        expect(delivery?.netIncome).toBe(45);
    });

    it('getFoodCostByCategory allocates order ledger COGS across categories by recipe share', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            {
                id: 5,
                items: [
                    {
                        quantity: 1,
                        subtotal: 60,
                        menuItem: {
                            categoryId: 1,
                            category: { name: 'Platos' },
                            recipes: [{
                                quantity: 1,
                                unit: 'kg',
                                product: { id: 1, name: 'Carne', unit: 'kg', currentAverageCost: 30, cost: 30 }
                            }]
                        }
                    },
                    {
                        quantity: 1,
                        subtotal: 40,
                        menuItem: {
                            categoryId: 2,
                            category: { name: 'Bebidas' },
                            recipes: [{
                                quantity: 1,
                                unit: 'kg',
                                product: { id: 2, name: 'Azúcar', unit: 'kg', currentAverageCost: 10, cost: 10 }
                            }]
                        }
                    }
                ]
            }
        ] as never);

        // Recipe shares would be 30 : 10; ledger total 20 → 15 + 5
        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([
            { reference: 'ORD-5', type: 'OUT', totalCost: 20 }
        ] as never);

        const result = await ReportExtendedService.getFoodCostByCategory(1);
        const platos = result.items.find((row) => row.categoryName === 'Platos');
        const bebidas = result.items.find((row) => row.categoryName === 'Bebidas');

        expect(platos?.cogs).toBe(15);
        expect(bebidas?.cogs).toBe(5);
        expect(result.summary.totalCOGS).toBe(20);
    });

    it('does not leak another branch return movement into temporal food cost', async () => {
        jest.spyOn(prisma.order, 'findMany')
            .mockResolvedValueOnce([{
                id: 5,
                items: [{
                    quantity: 1,
                    subtotal: 50,
                    menuItem: {
                        categoryId: 1,
                        category: { name: 'Platos' },
                        recipes: [{
                            quantity: 1,
                            unit: 'kg',
                            product: { id: 1, name: 'Carne', unit: 'kg', currentAverageCost: 10, cost: 10 }
                        }]
                    }
                }]
            }] as never)
            // Branch ownership lookup for every ORD-* reference in the movement window.
            .mockResolvedValueOnce([{ id: 5 }] as never);
        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([
            { id: 1, reference: 'ORD-5', type: 'OUT', totalCost: 10, createdAt: new Date() },
            { id: 2, reference: 'ORD-6', type: 'IN', totalCost: 90, createdAt: new Date() }
        ] as never);

        const result = await ReportExtendedService.getFoodCostByCategory(1, { branchId: 3 });

        expect(result.summary.totalCOGS).toBe(10);
        expect(prisma.order.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: expect.objectContaining({ companyId: 1, branchId: 3, id: { in: [5, 6] } })
        }));
    });

    it('fails closed when an ORD ledger row has an unknown historical cost', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([{
            id: 7,
            total: 100,
            salesChannel: 'RESTAURANT',
            channelCommission: 0,
            channelMarkup: 0,
            items: [{
                quantity: 1,
                subtotal: 100,
                menuItem: {
                    recipes: [{
                        quantity: 1,
                        unit: 'kg',
                        product: { id: 1, name: 'Harina', unit: 'kg', currentAverageCost: 40, cost: 40 }
                    }]
                }
            }]
        }] as never);
        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([
            { id: 1, reference: 'ORD-7', type: 'OUT', totalCost: 10, createdAt: new Date() },
            { id: 2, reference: 'ORD-7', type: 'OUT', totalCost: null, createdAt: new Date() }
        ] as never);

        await expect(ReportExtendedService.getSalesByChannel(1)).rejects.toThrow(/costo hist/i);
    });
});
