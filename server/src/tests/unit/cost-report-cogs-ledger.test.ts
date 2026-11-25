import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { ReportService } from '../../services/report.service';

describe('ReportService.getCostReport COGS source of truth', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(prisma.purchaseOrder, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
    });

    it('prefers net ORD-* inventory movement cost over recipe × current average', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            {
                id: 10,
                total: 100,
                items: [{
                    quantity: 2,
                    menuItem: {
                        recipes: [{
                            quantity: 1,
                            unit: 'kg',
                            product: {
                                id: 1,
                                name: 'Harina',
                                unit: 'kg',
                                currentAverageCost: 50,
                                cost: 50
                            }
                        }]
                    }
                }]
            },
            {
                id: 11,
                total: 80,
                items: [{
                    quantity: 1,
                    menuItem: {
                        recipes: [{
                            quantity: 1,
                            unit: 'kg',
                            product: {
                                id: 1,
                                name: 'Harina',
                                unit: 'kg',
                                currentAverageCost: 50,
                                cost: 50
                            }
                        }]
                    }
                }]
            }
        ] as never);

        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([
            { id: 1, reference: 'ORD-10', type: 'OUT', totalCost: 12, createdAt: new Date('2026-01-05T00:00:00Z') },
            { id: 2, reference: 'ORD-10', type: 'OUT', totalCost: 3, createdAt: new Date('2026-01-05T00:00:00Z') },
            // Reversal nets against OUT for order 10
            { id: 3, reference: 'ORD-10', type: 'IN', totalCost: 2, createdAt: new Date('2026-01-20T00:00:00Z') },
            // Order 11 has no ledger rows → recipe fallback (mocked convert path unused if UnitConversion fails)
        ] as never);

        // Order 11 fallback: recipeQuantityInBase → UnitConversionService.convert
        const { UnitConversionService } = await import('../../services/unit-conversion.service');
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({
            baseQuantity: 1,
            baseUnit: 'kg'
        } as never);

        const result = await ReportService.getCostReport(1, {
            dateFrom: new Date('2026-01-01T00:00:00Z'),
            dateTo: new Date('2026-01-31T23:59:59Z')
        });

        expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                companyId: 1,
                reference: { startsWith: 'ORD-' },
                type: { in: ['OUT', 'IN'] }
            })
        }));

        // ORD-10 ledger: 12 + 3 - 2 = 13; ORD-11 fallback: 1 * 1 * 50 = 50
        expect(result.summary.estimatedCOGS).toBe(63);
        expect(result.summary.totalRevenue).toBe(180);
        expect(result.summary.grossMargin).toBe(
            Math.round(((180 - 63) / 180) * 10000) / 100
        );
    });

    it('uses ledger net-zero (after reversals) instead of recipe fallback', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            {
                id: 20,
                total: 40,
                items: [{
                    quantity: 1,
                    menuItem: {
                        recipes: [{
                            quantity: 1,
                            unit: 'kg',
                            product: {
                                id: 2,
                                name: 'Aceite',
                                unit: 'kg',
                                currentAverageCost: 99,
                                cost: 99
                            }
                        }]
                    }
                }]
            }
        ] as never);

        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([
            { reference: 'ORD-20', type: 'OUT', totalCost: 15 },
            { reference: 'ORD-20', type: 'IN', totalCost: 15 }
        ] as never);

        const result = await ReportService.getCostReport(1);

        expect(result.summary.estimatedCOGS).toBe(0);
        expect(result.summary.totalRevenue).toBe(40);
    });

    it('fails closed instead of treating a legacy ORD movement with null cost as zero or a live estimate', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([{
            id: 30,
            total: 90,
            items: [{
                quantity: 2,
                menuItem: {
                    recipes: [{
                        quantity: 0.5,
                        unit: 'kg',
                        product: {
                            id: 3, name: 'Queso', unit: 'kg',
                            currentAverageCost: 20, cost: 20
                        }
                    }]
                }
            }]
        }] as never);
        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([
            { id: 30, reference: 'ORD-30', type: 'OUT', totalCost: null, createdAt: new Date() }
        ] as never);
        const { UnitConversionService } = await import('../../services/unit-conversion.service');
        jest.spyOn(UnitConversionService, 'convert').mockResolvedValue({ baseQuantity: 0.5 } as never);

        await expect(ReportService.getCostReport(1)).rejects.toThrow(/costo hist/i);
    });

    it('shows a same-period NO_RETURN as zero revenue with retained inventory loss', async () => {
        const occurredAt = new Date('2026-04-10T10:00:00Z');
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([{
            id: 40,
            total: 100,
            items: []
        }] as never);
        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([{
            id: 40,
            reference: 'ORD-40',
            type: 'OUT',
            totalCost: 35,
            createdAt: occurredAt
        }] as never);
        jest.mocked(prisma.fiscalCreditNote.findMany).mockResolvedValue([{ total: 100 }] as never);

        const result = await ReportService.getCostReport(1, {
            dateFrom: new Date('2026-04-01T00:00:00Z'),
            dateTo: new Date('2026-04-30T23:59:59Z')
        });

        expect(result.summary).toEqual(expect.objectContaining({
            totalRevenue: 0,
            estimatedCOGS: 35,
            grossProfit: -35
        }));
    });

    it('books RETURN_TO_STOCK as negative COGS on the return date for an older sale', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.inventoryMovement, 'findMany').mockResolvedValue([{
            id: 50,
            reference: 'ORD-50',
            type: 'IN',
            totalCost: 35,
            createdAt: new Date('2026-05-10T10:00:00Z')
        }] as never);
        jest.mocked(prisma.fiscalCreditNote.findMany).mockResolvedValue([{ total: 100 }] as never);

        const result = await ReportService.getCostReport(1, {
            dateFrom: new Date('2026-05-01T00:00:00Z'),
            dateTo: new Date('2026-05-31T23:59:59Z')
        });

        expect(result.summary).toEqual(expect.objectContaining({
            totalRevenue: -100,
            estimatedCOGS: -35,
            grossProfit: -65
        }));
    });
});
