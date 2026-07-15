import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ReportProductionService } from '../../services/report-production.service';

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
});
