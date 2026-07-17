import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { ReportExtendedService } from '../../services/report-extended.service';
import { SettingService } from '../../services/setting.service';

describe('financial report timezone recognition', () => {
    beforeEach(() => {
        jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('groups a UTC instant under the tenant local sales day', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            {
                id: 1,
                closedAt: new Date('2026-07-13T02:00:00.000Z'),
                total: 100,
                discount: 0,
                salesChannel: 'RESTAURANT'
            }
        ] as never);

        const result = await ReportExtendedService.getSalesDaily(1, { salesChannel: 'DELIVERY' });

        expect(result.items).toEqual([
            expect.objectContaining({ date: '2026-07-12', totalSales: 100, orderCount: 1 })
        ]);
        expect(prisma.fiscalCreditNote.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                order: expect.objectContaining({ salesChannel: 'DELIVERY' })
            })
        }));
    });

    it('uses the month before the requested comparison month and tenant-local boundaries', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
        const findMany = jest.spyOn(prisma.order, 'findMany').mockResolvedValue([] as never);

        const result = await ReportExtendedService.getMonthComparison(1, { monthB: '2026-05' });

        expect(result.items.map((item) => item.month)).toEqual(['2026-04', '2026-05']);
        expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: expect.objectContaining({
                closedAt: expect.objectContaining({
                    not: null,
                    gte: new Date('2026-04-01T06:00:00.000Z'),
                    lte: new Date('2026-05-01T05:59:59.999Z')
                })
            })
        }));
    });

    it('counts distinct local service dates when averaging weekday performance', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            { id: 1, closedAt: new Date('2026-07-06T18:00:00.000Z'), total: 100 },
            { id: 2, closedAt: new Date('2026-08-03T18:00:00.000Z'), total: 300 }
        ] as never);

        const result = await ReportExtendedService.getDayAnalysis(1);
        const monday = result.items.find((item) => item.dayName === 'Lunes');

        expect(monday).toEqual(expect.objectContaining({
            totalSales: 400,
            orderCount: 2,
            avgDailySales: 200
        }));
    });

    it('reconciles a full same-day credit as gross sale plus negative fiscal event', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([{
            id: 9,
            closedAt: new Date('2026-07-12T16:00:00Z'),
            total: 115,
            discount: 0,
            salesChannel: 'RESTAURANT'
        }] as never);
        jest.mocked(prisma.fiscalCreditNote.findMany).mockResolvedValue([{
            issuedAt: new Date('2026-07-12T18:00:00Z'),
            total: 115
        }] as never);

        const result = await ReportExtendedService.getSalesDaily(1);

        expect(result.items).toEqual([
            expect.objectContaining({ date: '2026-07-12', totalSales: 0, orderCount: 1 })
        ]);
    });

    it('groups purchase events by the tenant local day and month', async () => {
        jest.spyOn(SettingService, 'getTimezone').mockResolvedValue('America/Managua');
        jest.spyOn(prisma.purchaseOrder, 'findMany').mockResolvedValue([{
            date: new Date('2026-07-01T02:00:00.000Z'),
            total: 80,
            supplier: { name: 'Proveedor' },
            items: []
        }] as never);

        const [daily, monthly] = await Promise.all([
            ReportExtendedService.getPurchasesByDay(1),
            ReportExtendedService.getPurchasesByMonth(1)
        ]);

        expect(daily.items).toEqual([
            { date: '2026-06-30', totalAmount: 80, orderCount: 1, itemCount: 0 }
        ]);
        expect(monthly.items).toEqual([
            { month: '2026-06', totalAmount: 80, orderCount: 1 }
        ]);
    });

    it('uses one canonical key for uncategorized gross sales and credit notes', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([{
            items: [{ quantity: 1, subtotal: 100, menuItem: { categoryId: null, category: null } }]
        }] as never);
        jest.mocked(prisma.fiscalCreditNote.findMany).mockResolvedValue([{
            issuedAt: new Date('2026-07-12T18:00:00Z'),
            total: 40,
            order: {},
            refunds: [],
            lines: [{
                quantity: 1,
                grossSubtotal: 40,
                orderItem: { menuItemId: 5, menuItem: { categoryId: null, category: null } }
            }]
        }] as never);

        const result = await ReportExtendedService.getSalesByCategory(1, {
            dateFrom: new Date('2026-07-01T00:00:00Z'),
            dateTo: new Date('2026-07-31T23:59:59Z')
        });

        expect(result.items).toEqual([
            expect.objectContaining({ categoryName: 'Sin categoría', totalSales: 60, unitsSold: 0 })
        ]);
        expect(result.summary.totalCategories).toBe(1);
    });
});
