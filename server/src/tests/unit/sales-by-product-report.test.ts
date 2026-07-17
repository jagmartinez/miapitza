import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { ReportExtendedService } from '../../services/report-extended.service';

describe('ReportExtendedService.getSalesByProduct', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('aggregates products and scopes the query by tenant, branch, date and category', async () => {
        const findMany = jest.spyOn(prisma.orderItem, 'findMany').mockResolvedValue([
            { orderId: 10, menuItemId: 7, quantity: 2, subtotal: 30, menuItem: { name: 'Pizza', category: { name: 'Comida' } } },
            { orderId: 11, menuItemId: 7, quantity: 1, subtotal: 15, menuItem: { name: 'Pizza', category: { name: 'Comida' } } },
            { orderId: 11, menuItemId: 8, quantity: 2, subtotal: 10, menuItem: { name: 'Soda', category: { name: 'Bebidas' } } },
        ] as never);
        jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
        const dateFrom = new Date('2026-07-01T00:00:00.000Z');
        const dateTo = new Date('2026-07-31T23:59:59.999Z');

        const result = await ReportExtendedService.getSalesByProduct(4, { branchId: 9, categoryIds: [3, 5], dateFrom, dateTo });

        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                order: expect.objectContaining({
                    companyId: 4,
                    branchId: 9,
                    OR: expect.arrayContaining([
                        { financialStatus: 'PAID', status: { not: 'CANCELLED' } },
                        { status: 'CANCELLED', invoiceFiscalStatus: 'CREDITED' }
                    ]),
                    closedAt: { not: null, gte: dateFrom, lte: dateTo },
                }),
                menuItem: { categoryId: { in: [3, 5] } },
            }),
        }));
        expect(result.items[0]).toEqual(expect.objectContaining({
            productName: 'Pizza', unitsSold: 3, orderCount: 2, lineCount: 2,
            averageUnitPrice: 15, totalSales: 45,
        }));
        expect(result.summary).toEqual({ totalProducts: 2, totalUnits: 5, totalOrders: 2, totalSales: 55, topProduct: 'Pizza' });
    });
});
